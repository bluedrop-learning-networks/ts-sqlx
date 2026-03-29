import type {
  CodeAction,
  TextEdit,
} from 'vscode-languageserver/node.js';
import { CodeActionKind } from 'vscode-languageserver/node.js';

export interface TypeImportInfo {
  typeName: string;
  moduleSpecifier: string;
}

function importEdits(imports: TypeImportInfo[]): TextEdit[] {
  return imports.map((imp) => ({
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    },
    newText: `import type { ${imp.typeName} } from '${imp.moduleSpecifier}';\n`,
  }));
}

export function createAddTypeAnnotationAction(
  uri: string,
  generatedType: string,
  insertPosition: { line: number; character: number },
  imports: TypeImportInfo[] = [],
): CodeAction {
  return {
    title: 'Add inferred type annotation',
    kind: CodeActionKind.QuickFix,
    edit: {
      changes: {
        [uri]: [
          {
            range: {
              start: insertPosition,
              end: insertPosition,
            },
            newText: `<${generatedType}>`,
          },
          ...importEdits(imports),
        ],
      },
    },
  };
}

export function createUpdateTypeAnnotationAction(
  uri: string,
  generatedType: string,
  replaceRange: { start: { line: number; character: number }; end: { line: number; character: number } },
  imports: TypeImportInfo[] = [],
): CodeAction {
  return {
    title: 'Update type annotation to match query',
    kind: CodeActionKind.QuickFix,
    edit: {
      changes: {
        [uri]: [
          {
            range: replaceRange,
            newText: `<${generatedType}>`,
          },
          ...importEdits(imports),
        ],
      },
    },
  };
}
