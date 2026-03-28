import type {
  CodeAction,
} from 'vscode-languageserver/node.js';
import { CodeActionKind } from 'vscode-languageserver/node.js';

export function createAddTypeAnnotationAction(
  uri: string,
  generatedType: string,
  insertPosition: { line: number; character: number },
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
        ],
      },
    },
  };
}

export function createUpdateTypeAnnotationAction(
  uri: string,
  generatedType: string,
  replaceRange: { start: { line: number; character: number }; end: { line: number; character: number } },
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
        ],
      },
    },
  };
}
