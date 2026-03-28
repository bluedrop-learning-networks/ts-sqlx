---
id: ts-whoq
status: open
deps: []
links: []
created: 2026-03-28T17:02:35Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [lsp, code-actions]
---
# Wire code actions into LSP onCodeAction handler

The code action helper functions exist in `packages/language-server/src/codeActions.ts` but the LSP server's `onCodeAction` handler at `packages/language-server/src/server.ts:114` returns an empty array. The server advertises `CodeActionKind.QuickFix` capability but never produces any actions.

Per the spec (docs/superpowers/specs/2026-03-20-ts-sqlx-design.md, "Code Actions" section), these are core v1 features:

**TS007 — "Add inferred type annotation"**
When a query has no generic type parameter, insert one with the DB-inferred type. Nullable columns produce `T | null`, NOT NULL columns produce `T`.

```typescript
// Before — TS007
const user = await db.oneOrNone("SELECT id, name FROM users WHERE id = $1", [id]);
// After quick fix
const user = await db.oneOrNone<{ id: string; name: string | null }>("SELECT ...", [id]);
```

**TS010 — "Update type annotation to match query"**
When a generic type parameter exists but doesn't match the inferred type, replace it with the correct inferred inline type. For named types (interface/alias), replace the generic parameter reference with an inline type to avoid affecting other usages.

```typescript
// Before — TS010
const user = await db.one<User>("SELECT id, name FROM users WHERE id = $1", [1]);
// After quick fix
const user = await db.one<{ id: string; name: string | null }>("SELECT id, name FROM users WHERE id = $1", [1]);
```

## What needs to happen

### 1. Store analysis results per file

`onDidChangeContent` currently runs `engine.analyze()` and sends LSP diagnostics, but discards the core `Diagnostic[]` and the inferred types. The `onCodeAction` handler needs access to:
- The core diagnostics (with their codes and byte-offset ranges)
- The inferred column types for each query (to generate the type annotation via `generateTypeAnnotation()` from `packages/core/src/typeComparator.ts`)
- The query call positions (to know where to insert/replace the generic type parameter)

Store a `Map<string, AnalysisResult>` keyed by document URI, populated during `onDidChangeContent`.

### 2. Wire `onCodeAction` to match diagnostics

When the LSP client requests code actions for a range:
- Look up stored analysis results for the document URI
- Find diagnostics that overlap the requested range
- For TS007 diagnostics: call `createAddTypeAnnotationAction()` with the insert position (after the method name, before the opening parenthesis of the call)
- For TS010 diagnostics: call `createUpdateTypeAnnotationAction()` with the range of the existing generic type parameter

### 3. Compute correct insert/replace positions

This is the tricky part. The current `QueryCallInfo` has the overall call `position` (start/end) but not the specific position of the generic type parameter or where to insert one. Options:
- Extend `QueryCallInfo` or the diagnostics to carry the method name end position (where `<...>` would be inserted)
- Use the TypeScript adapter to locate the call expression and compute the insert point from the AST
- For TS010, need the range of the existing `<...>` type argument to replace it

### 4. Generate type text

Use `generateTypeAnnotation()` from `packages/core/src/typeComparator.ts` which already produces `{ name: type; ... }` strings from `InferredColumn[]`.

## Existing code

- Helper functions: `packages/language-server/src/codeActions.ts` (createAddTypeAnnotationAction, createUpdateTypeAnnotationAction)
- Stub handler: `packages/language-server/src/server.ts:114` (`connection.onCodeAction(() => [])`)
- Type generation: `packages/core/src/typeComparator.ts` (`generateTypeAnnotation`)
- Diagnostics engine: `packages/core/src/diagnostics.ts` (produces TS007/TS010)
- Query detector: `packages/core/src/queryDetector.ts` (has call expression positions)

## Acceptance criteria

- [ ] TS007 diagnostics offer "Add inferred type annotation" quick fix that inserts `<{ ... }>` at the correct position
- [ ] TS010 diagnostics offer "Update type annotation to match query" quick fix that replaces the existing generic type parameter
- [ ] Generated types reflect column nullability (nullable → `T | null`, NOT NULL → `T`)
- [ ] Named types (interface/alias) are replaced with inline types, not modified at their declaration
- [ ] Language server builds with no errors


## Notes

**2026-03-28T17:03:45Z**

## Design spec (from docs/superpowers/specs/2026-03-20-ts-sqlx-design.md lines 933-984)

All code actions are registered as **quick fixes** (`CodeActionKind.QuickFix`) so they appear in the editor's lightbulb menu and can be applied with the standard quick-fix keybinding (Ctrl+. / Cmd+.).

### Add Type Annotation

Triggered by `TS007` (query has no type annotation). Inserts the inferred type as a generic parameter:

Generated types reflect column nullability: nullable columns produce `T | null`, NOT NULL columns produce `T`.

```typescript
// Before — TS007: query has no type annotation
const user = await db.oneOrNone("SELECT id, name FROM users WHERE id = $1", [id]);

// After (quick fix: "Add inferred type annotation")
// `id` is UUID NOT NULL → string; `name` is TEXT (nullable) → string | null
const user = await db.oneOrNone<{ id: string; name: string | null }>("SELECT ...", [id]);
```

For node-postgres:

```typescript
// Before — TS007
const result = await client.query("SELECT id, name FROM users", []);

// After (quick fix: "Add inferred type annotation")
const result = await client.query<{ id: string; name: string | null }>("SELECT ...", []);
```

### Update Type Annotation

Triggered by `TS010` (declared type doesn't match inferred). When a generic type parameter already exists, ts-sqlx resolves it through the TypeScript type system (including aliases, utility types, imports) and checks assignability against the inferred type. If they don't match, it reports TS010 and offers a quick fix to replace the existing type:

```typescript
interface User { userId: string; name: string }

// Before — TS010: property 'userId' not in query result; missing property 'id' in declared type
const user = await db.one<User>("SELECT id, name FROM users WHERE id = $1", [1]);

// Quick fix: "Update type annotation to match query"
// Replaces the generic parameter with the inferred type (with correct nullability):
const user = await db.one<{ id: string; name: string | null }>("SELECT id, name FROM users WHERE id = $1", [1]);
```

When the declared type is an inline object literal, the quick fix replaces it directly. When it's a named type (interface/alias), the quick fix replaces the generic parameter reference with an inline type, since modifying the type declaration could affect other usages.

### Code Action Summary

| Diagnostic | Code Action | Description |
|------------|-------------|-------------|
| `TS007` | Add inferred type annotation | Insert generic type parameter |
| `TS010` | Update type annotation to match query | Replace mismatched generic type parameter with inferred type |
