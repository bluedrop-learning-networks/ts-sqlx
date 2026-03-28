---
id: ts-luyx
status: closed
deps: [ts-ux5n]
links: []
created: 2026-03-28T14:48:18Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [lsp, code-actions]
---
# Task 19: Code Actions

Code Actions - LSP code actions for adding and updating type annotations on query calls.

### Task 19: Code Actions

**Files:**
- Create: `packages/language-server/src/codeActions.ts`
- Modify: `packages/language-server/src/server.ts` (add code action handler)

- [ ] **Step 1: Implement code actions**

```typescript
// packages/language-server/src/codeActions.ts
import type {
  CodeAction,
  CodeActionParams,
  TextEdit,
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
            newText: generatedType,
          },
        ],
      },
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/language-server/src/codeActions.ts
git commit -m "feat: add code actions for type annotation generation"
```

## Design

Quick fixes for TS007 (add type annotation) and TS010 (update type annotation). Registered as CodeActionKind.QuickFix.

## Acceptance Criteria

createAddTypeAnnotationAction and createUpdateTypeAnnotationAction produce correct CodeAction objects with QuickFix kind and text edits; commit created

