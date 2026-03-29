import {
  Project,
  Node,
} from 'ts-morph';
import type {
  TypeScriptAdapter,
  CallExpressionInfo,
  ArgumentInfo,
  PropertyInfo,
  ResolvedImport,
} from './types.js';

export class TsMorphAdapter implements TypeScriptAdapter {
  private project!: Project;

  loadProject(tsConfigPath: string): void {
    this.project = new Project({ tsConfigFilePath: tsConfigPath });
  }

  updateFile(filePath: string, content: string): void {
    const sourceFile = this.project.getSourceFile(filePath);
    if (sourceFile) {
      sourceFile.replaceWithText(content);
    } else {
      this.project.createSourceFile(filePath, content, { overwrite: true });
    }
  }

  getProjectFiles(): string[] {
    return this.project.getSourceFiles().map((sf) => sf.getFilePath());
  }

  getTypeText(filePath: string, position: number): string | undefined {
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return undefined;
    const node = sourceFile.getDescendantAtPos(position);
    if (!node) return undefined;
    return node.getType().getText();
  }

  resolveStringLiteral(filePath: string, position: number): string | undefined {
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return undefined;

    const node = sourceFile.getDescendantAtPos(position);
    if (!node) return undefined;

    if (Node.isStringLiteral(node)) {
      return node.getLiteralValue();
    }

    if (Node.isNoSubstitutionTemplateLiteral(node)) {
      return node.getLiteralValue();
    }

    if (Node.isIdentifier(node)) {
      const defs = node.getDefinitionNodes();
      for (const def of defs) {
        if (Node.isVariableDeclaration(def)) {
          const init = def.getInitializer();
          if (init && Node.isStringLiteral(init)) {
            return init.getLiteralValue();
          }
          if (init && Node.isNoSubstitutionTemplateLiteral(init)) {
            return init.getLiteralValue();
          }
        }
      }
    }

    return undefined;
  }

  getCallExpressions(filePath: string): CallExpressionInfo[] {
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return [];

    const results: CallExpressionInfo[] = [];

    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;

      const expr = node.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) return;

      const receiver = expr.getExpression();
      const methodName = expr.getName();

      const typeArgs = node.getTypeArguments().map((t) => t.getText());

      // Resolve the first type argument (result type) using the type checker
      let resolvedTypeProperties: PropertyInfo[] | undefined;
      if (typeArgs.length > 0) {
        const firstTypeArg = node.getTypeArguments()[0];
        const resolvedType = firstTypeArg.getType();
        const props = resolvedType.getProperties();
        if (props.length > 0) {
          resolvedTypeProperties = props.map((prop) => {
            const decl = prop.getDeclarations()[0];
            return {
              name: prop.getName(),
              type: prop.getTypeAtLocation(firstTypeArg).getText(),
              optional: decl ? Node.isPropertySignature(decl) && decl.hasQuestionToken() : false,
            };
          });
        }
      }

      const args: ArgumentInfo[] = node.getArguments().map((arg) => ({
        position: arg.getStart(),
        type: arg.getType().getText(),
        text: arg.getText(),
      }));

      const insertTypePosition = expr.getNameNode().getEnd();

      let typeArgumentRange: { start: number; end: number } | undefined;
      if (typeArgs.length > 0) {
        const typeArgNodes = node.getTypeArguments();
        const first = typeArgNodes[0];
        const last = typeArgNodes[typeArgNodes.length - 1];
        typeArgumentRange = { start: first.getStart() - 1, end: last.getEnd() + 1 };
      }

      results.push({
        receiverType: receiver.getType().getText(),
        methodName,
        typeArguments: typeArgs,
        arguments: args,
        position: { start: node.getStart(), end: node.getEnd() },
        insertTypePosition,
        typeArgumentRange,
        resolvedTypeProperties,
      });
    });

    return results;
  }

  getTypeProperties(typeText: string, filePath: string): PropertyInfo[] {
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return [];

    // If typeText is a simple identifier, try to resolve it directly from the source file
    const isSimpleIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(typeText);

    if (isSimpleIdentifier) {
      // Look up the type alias or interface in the source file
      const typeAlias = sourceFile.getTypeAlias(typeText);
      const iface = sourceFile.getInterface(typeText);
      const target = typeAlias ?? iface;
      if (target) {
        const type = target.getType();
        return type.getProperties().map((prop) => {
          const decl = prop.getDeclarations()[0];
          return {
            name: prop.getName(),
            type: prop.getTypeAtLocation(sourceFile).getText(),
            optional: decl ? Node.isPropertySignature(decl) && decl.hasQuestionToken() : false,
          };
        });
      }
    }

    // For complex type expressions (e.g., inline `{ id: string }`), use a temp file
    // with a wildcard import so identifiers from the source file are accessible
    const tempFile = this.project.createSourceFile(
      '__ts_sqlx_temp__.ts',
      `import type * as __Source__ from '${filePath}';\ntype __Resolve__ = ${typeText};`,
      { overwrite: true }
    );

    try {
      const typeAlias = tempFile.getTypeAlias('__Resolve__');
      if (!typeAlias) return [];

      const type = typeAlias.getType();
      return type.getProperties().map((prop) => {
        const decl = prop.getDeclarations()[0];
        return {
          name: prop.getName(),
          type: prop.getTypeAtLocation(tempFile).getText(),
          optional: decl ? Node.isPropertySignature(decl) && decl.hasQuestionToken() : false,
        };
      });
    } finally {
      this.project.removeSourceFile(tempFile);
    }
  }

  followImport(filePath: string, importName: string): ResolvedImport | undefined {
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return undefined;

    for (const importDecl of sourceFile.getImportDeclarations()) {
      for (const named of importDecl.getNamedImports()) {
        if (named.getName() === importName) {
          const symbol = named.getNameNode().getSymbol();
          if (!symbol) continue;
          const decls = symbol.getDeclarations();
          if (decls.length === 0) continue;
          const decl = decls[0];
          return {
            filePath: decl.getSourceFile().getFilePath(),
            exportName: importName,
            type: decl.getType().getText(),
          };
        }
      }
    }

    return undefined;
  }
}
