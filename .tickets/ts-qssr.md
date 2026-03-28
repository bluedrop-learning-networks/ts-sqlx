---
id: ts-qssr
status: closed
deps: [ts-w2b0]
links: []
created: 2026-03-28T14:47:34Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [core, typescript]
---
# Task 12: TypeScript Adapter (ts-morph)

Implement the TypeScript adapter interface and ts-morph-based implementation for project loading, type resolution, and call expression scanning.

### Task 12: TypeScript Adapter Interface + ts-morph Implementation

**Files:**
- Create: `packages/core/src/adapters/typescript/types.ts`
- Create: `packages/core/src/adapters/typescript/tsMorphAdapter.ts`
- Create: `tests/integration/tsMorphAdapter.test.ts`

- [ ] **Step 1: Create TypeScript adapter interface**

Note: This interface differs from the spec's `TypeScriptAdapter`. The spec uses position-based `getCallExpression` (singular) and `isAssignableTo` on a `TSType` wrapper. In practice, it's more efficient to scan all call expressions in a file at once and use string-based type checking in the detector. The adapter remains pluggable for future TSGo swap.

```typescript
// packages/core/src/adapters/typescript/types.ts

export interface PropertyInfo {
  name: string;
  type: string;
  optional: boolean;
}

export interface ArgumentInfo {
  position: number;
  type: string;
  text: string;
}

export interface CallExpressionInfo {
  receiverType: string;
  methodName: string;
  typeArguments: string[];
  arguments: ArgumentInfo[];
  position: { start: number; end: number };
}

export interface ResolvedImport {
  filePath: string;
  exportName: string;
  type: string;
}

export interface TypeScriptAdapter {
  loadProject(tsConfigPath: string): void;
  updateFile(filePath: string, content: string): void;
  getProjectFiles(): string[];
  getTypeText(filePath: string, position: number): string | undefined;
  resolveStringLiteral(filePath: string, position: number): string | undefined;
  getCallExpressions(filePath: string): CallExpressionInfo[];
  getTypeProperties(typeText: string, filePath: string): PropertyInfo[];
  followImport(filePath: string, importName: string): ResolvedImport | undefined;
}
```

- [ ] **Step 2: Write the test**

```typescript
// tests/integration/tsMorphAdapter.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { TsMorphAdapter } from '@ts-sqlx/core/src/adapters/typescript/tsMorphAdapter.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('TsMorphAdapter', () => {
  let adapter: TsMorphAdapter;
  const fixturesDir = path.join(__dirname, '../fixtures');

  beforeAll(() => {
    adapter = new TsMorphAdapter();
    adapter.loadProject(path.join(fixturesDir, 'tsconfig.json'));
  });

  it('lists project files', () => {
    const files = adapter.getProjectFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.some(f => f.includes('param-types.ts'))).toBe(true);
  });

  it('resolves string literal from source', () => {
    // Create an in-memory file with a known SQL string
    adapter.updateFile(
      path.join(fixturesDir, '_test_resolve.ts'),
      'const sql = "SELECT id FROM users";'
    );
    // We need to find the string literal — this tests the basic resolve capability
    const resolved = adapter.resolveStringLiteral(
      path.join(fixturesDir, '_test_resolve.ts'),
      13 // position inside the string literal
    );
    expect(resolved).toBe('SELECT id FROM users');
  });

  it('gets call expressions from fixture file', () => {
    const calls = adapter.getCallExpressions(
      path.join(fixturesDir, 'diagnostics/ts001-syntax-errors.ts')
    );
    expect(calls.length).toBeGreaterThan(0);
    // All calls should be on db object
    expect(calls.some(c => c.methodName === 'one' || c.methodName === 'many')).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/tsMorphAdapter.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement ts-morph adapter**

```typescript
// packages/core/src/adapters/typescript/tsMorphAdapter.ts
import {
  Project,
  Node,
  SyntaxKind,
  type SourceFile,
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

    // Direct string literal
    if (Node.isStringLiteral(node)) {
      return node.getLiteralValue();
    }

    // Template literal (no interpolation)
    if (Node.isNoSubstitutionTemplateLiteral(node)) {
      return node.getLiteralValue();
    }

    // Variable reference — try to resolve initializer
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
      const args: ArgumentInfo[] = node.getArguments().map((arg) => ({
        position: arg.getStart(),
        type: arg.getType().getText(),
        text: arg.getText(),
      }));

      results.push({
        receiverType: receiver.getType().getText(),
        methodName,
        typeArguments: typeArgs,
        arguments: args,
        position: { start: node.getStart(), end: node.getEnd() },
      });
    });

    return results;
  }

  getTypeProperties(typeText: string, filePath: string): PropertyInfo[] {
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return [];

    // Create a temporary variable with the type to resolve it
    const tempFile = this.project.createSourceFile(
      '__ts_sqlx_temp__.ts',
      `import type {} from '${filePath}';\ntype __Resolve__ = ${typeText};`,
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/tsMorphAdapter.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/adapters/typescript/types.ts packages/core/src/adapters/typescript/tsMorphAdapter.ts tests/integration/tsMorphAdapter.test.ts
git commit -m "feat: add TypeScript adapter interface and ts-morph implementation"
```

## Design

Interface diverges from spec: uses file-wide getCallExpressions instead of position-based, string-based type checking instead of TSType wrapper. Remains pluggable for TSGo.

## Acceptance Criteria

TsMorphAdapter loads project, lists files, resolves string literals (including const vars), extracts call expressions, resolves type properties, follows imports; tests pass; commit created

