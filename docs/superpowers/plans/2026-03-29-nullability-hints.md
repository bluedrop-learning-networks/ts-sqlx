# Nullability Hints Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to override inferred column nullability via SQL comment annotations (`@nullable`, `@not-null`) in a leading block comment.

**Architecture:** A new `hintExtractor` module parses a leading `/* ... */` comment from SQL text, extracts `@nullable` and `@not-null` column name lists, strips the comment, and returns cleaned SQL + hint map. Hint extraction happens in `DiagnosticsEngine.analyzeQuery()` — the earliest point where SQL text is available — so that clean SQL flows through both `extractParams()` and `DbInferrer.infer()`. The hint map is passed to `DbInferrer.infer(sql, hints?)` as an explicit argument, then overlaid onto inferred columns. Columns not mentioned in hints keep their database-inferred nullability. Column names in hints are lowercased to match PostgreSQL's identifier folding.

**Tech Stack:** TypeScript, Vitest, PGLite (for integration tests)

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/core/src/hintExtractor.ts` | Parse leading block comment for `@nullable`/`@not-null` hints, return cleaned SQL + hint map |
| Create | `tests/integration/hintExtractor.test.ts` | Unit tests for hint extraction (pure function, no DB needed) |
| Modify | `packages/core/src/dbInferrer.ts` | Accept optional hints map, overlay onto inferred columns |
| Modify | `packages/core/src/diagnostics.ts:~100-147` | Extract hints from `query.sqlText` before param extraction, pass cleaned SQL through pipeline, pass hints to inferrer |
| Create | `tests/integration/dbInferrerHints.test.ts` | Integration tests: hints override PGLite-inferred nullability |
| Modify | `packages/core/src/index.ts` | Re-export `extractNullabilityHints` and `NullabilityHints` type |

---

## Chunk 1: Hint Extraction

### Task 1: hintExtractor — core parsing

**Files:**
- Create: `packages/core/src/hintExtractor.ts`
- Create: `tests/integration/hintExtractor.test.ts`

- [ ] **Step 1: Write failing tests for basic hint extraction**

Create `tests/integration/hintExtractor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractNullabilityHints } from '@ts-sqlx/core';

describe('extractNullabilityHints', () => {
  it('returns empty hints and unchanged SQL when no comment present', () => {
    const sql = 'SELECT id, name FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.cleanedSql).toBe(sql);
    expect(result.hints.size).toBe(0);
  });

  it('extracts @not-null hints', () => {
    const sql = '/* @not-null bar */ SELECT foo AS bar FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.hints.get('bar')).toBe('not-null');
    expect(result.cleanedSql).toBe('SELECT foo AS bar FROM users');
  });

  it('extracts @nullable hints', () => {
    const sql = '/* @nullable bar */ SELECT foo AS bar FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.hints.get('bar')).toBe('nullable');
    expect(result.cleanedSql).toBe('SELECT foo AS bar FROM users');
  });

  it('extracts multiple column names per annotation', () => {
    const sql = '/* @not-null bar, baz */ SELECT foo AS bar, qux AS baz FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.hints.get('bar')).toBe('not-null');
    expect(result.hints.get('baz')).toBe('not-null');
  });

  it('handles both @nullable and @not-null in same comment', () => {
    const sql = '/* @nullable a @not-null b */ SELECT x AS a, y AS b FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.hints.get('a')).toBe('nullable');
    expect(result.hints.get('b')).toBe('not-null');
  });

  it('trims leading/trailing whitespace from cleaned SQL', () => {
    const sql = '  /* @not-null bar */  SELECT foo AS bar FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.cleanedSql).toBe('SELECT foo AS bar FROM users');
  });

  it('ignores block comments that are not leading', () => {
    const sql = 'SELECT foo /* @not-null bar */ AS bar FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.hints.size).toBe(0);
    expect(result.cleanedSql).toBe(sql);
  });

  it('ignores comments without hint annotations', () => {
    const sql = '/* just a regular comment */ SELECT id FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.hints.size).toBe(0);
    expect(result.cleanedSql).toBe(sql);
  });

  it('handles multiline hint comments', () => {
    const sql = `/*
  @not-null id, email
  @nullable name
*/ SELECT id, email, name FROM users`;
    const result = extractNullabilityHints(sql);
    expect(result.hints.get('id')).toBe('not-null');
    expect(result.hints.get('email')).toBe('not-null');
    expect(result.hints.get('name')).toBe('nullable');
    expect(result.cleanedSql).toBe('SELECT id, email, name FROM users');
  });

  it('lowercases column names to match PG identifier folding', () => {
    const sql = '/* @not-null Name, EMAIL */ SELECT name, email FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.hints.get('name')).toBe('not-null');
    expect(result.hints.get('email')).toBe('not-null');
    expect(result.hints.has('Name')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/hintExtractor.test.ts`
Expected: FAIL — `extractNullabilityHints` does not exist

- [ ] **Step 3: Implement hintExtractor**

Create `packages/core/src/hintExtractor.ts`:

```typescript
export type NullabilityHint = 'nullable' | 'not-null';

export interface HintExtractionResult {
  cleanedSql: string;
  hints: Map<string, NullabilityHint>;
}

const LEADING_BLOCK_COMMENT = /^\s*\/\*([\s\S]*?)\*\//;
const HINT_ANNOTATION = /@(nullable|not-null)\s+([^@]*)/g;

export function extractNullabilityHints(sql: string): HintExtractionResult {
  const hints = new Map<string, NullabilityHint>();

  const match = LEADING_BLOCK_COMMENT.exec(sql);
  if (!match) return { cleanedSql: sql, hints };

  const commentBody = match[1];
  let foundHint = false;

  for (const m of commentBody.matchAll(HINT_ANNOTATION)) {
    foundHint = true;
    const hint = m[1] as NullabilityHint;
    const names = m[2]
      .split(',')
      .map((n) => n.trim().toLowerCase())
      .filter((n) => n.length > 0 && /^\w+$/.test(n));
    for (const name of names) {
      hints.set(name, hint);
    }
  }

  if (!foundHint) return { cleanedSql: sql, hints };

  const cleanedSql = sql.slice(match[0].length).trim();
  return { cleanedSql, hints };
}
```

- [ ] **Step 4: Export from core index**

Add to `packages/core/src/index.ts`:

```typescript
export { extractNullabilityHints } from './hintExtractor.js';
export type { NullabilityHint, HintExtractionResult } from './hintExtractor.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/integration/hintExtractor.test.ts`
Expected: All 10 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/hintExtractor.ts tests/integration/hintExtractor.test.ts packages/core/src/index.ts
git commit -m "feat: add nullability hint extraction from SQL leading block comments"
```

---

## Chunk 2: DbInferrer Integration

### Task 2: Wire hints into DbInferrer

**Files:**
- Modify: `packages/core/src/dbInferrer.ts`
- Create: `tests/integration/dbInferrerHints.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create `tests/integration/dbInferrerHints.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@ts-sqlx/core/dbInferrer.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import type { NullabilityHint } from '@ts-sqlx/core/hintExtractor.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('DbInferrer with nullability hints', () => {
  let adapter: PGLiteAdapter;
  let inferrer: DbInferrer;

  beforeAll(async () => {
    adapter = await PGLiteAdapter.create();
    const schema = fs.readFileSync(
      path.join(__dirname, '../fixtures/schema.sql'),
      'utf8',
    );
    await adapter.executeSchema(schema);
    inferrer = new DbInferrer(adapter);
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  it('overrides inferred nullability with @not-null hint', async () => {
    // PGLite defaults all columns to nullable: true
    // @not-null hint passed explicitly should override that
    const hints = new Map<string, NullabilityHint>([['name', 'not-null']]);
    const result = await inferrer.infer('SELECT name FROM users', hints);
    const col = result.columns.find((c) => c.name === 'name')!;
    expect(col.nullable).toBe(false);
  });

  it('overrides inferred nullability with @nullable hint', async () => {
    const hints = new Map<string, NullabilityHint>([['email', 'nullable']]);
    const result = await inferrer.infer('SELECT email FROM users', hints);
    const col = result.columns.find((c) => c.name === 'email')!;
    expect(col.nullable).toBe(true);
  });

  it('leaves unhinted columns unchanged', async () => {
    const hints = new Map<string, NullabilityHint>([['name', 'not-null']]);
    const result = await inferrer.infer('SELECT name, age FROM users', hints);
    const name = result.columns.find((c) => c.name === 'name')!;
    const age = result.columns.find((c) => c.name === 'age')!;
    expect(name.nullable).toBe(false);
    expect(age.nullable).toBe(true); // PGLite default
  });

  it('silently ignores hints for columns not in the result set', async () => {
    const hints = new Map<string, NullabilityHint>([['nonexistent', 'not-null']]);
    const result = await inferrer.infer('SELECT id FROM users', hints);
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].name).toBe('id');
  });

  it('works with parameterized queries', async () => {
    const hints = new Map<string, NullabilityHint>([['name', 'not-null']]);
    const result = await inferrer.infer(
      'SELECT name FROM users WHERE id = $1',
      hints,
    );
    const col = result.columns.find((c) => c.name === 'name')!;
    expect(col.nullable).toBe(false);
  });

  it('works with no hints (backward compatible)', async () => {
    const result = await inferrer.infer('SELECT id, email FROM users');
    expect(result.columns).toHaveLength(2);
    // PGLite defaults to nullable: true
    expect(result.columns[0].nullable).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/dbInferrerHints.test.ts`
Expected: FAIL — `infer()` does not accept a second argument / hints have no effect

- [ ] **Step 3: Modify DbInferrer to accept and apply hints**

Edit `packages/core/src/dbInferrer.ts` — add optional `hints` parameter:

```typescript
import type { DatabaseAdapter, QueryTypeInfo } from './adapters/database/types.js';
import type { InferredQueryType, InferredParam, InferredColumn } from './types.js';
import { tsTypeFromPgType } from './adapters/database/oidMap.js';
import type { NullabilityHint } from './hintExtractor.js';

export class DbInferrer {
  constructor(private adapter: DatabaseAdapter) {}

  async infer(
    sql: string,
    hints?: Map<string, NullabilityHint>,
  ): Promise<InferredQueryType> {
    const info: QueryTypeInfo = await this.adapter.describeQuery(sql);

    const params: InferredParam[] = info.params.map((p, i) => {
      const isArr = p.isArray;
      const baseTsType = tsTypeFromPgType(p.name);
      return {
        index: i + 1,
        pgType: p.name,
        tsType: isArr ? `${baseTsType}[]` : baseTsType,
        nullable: false,
      };
    });

    const columns: InferredColumn[] = info.columns.map((c) => {
      const isArr = c.type.isArray;
      const baseTsType = tsTypeFromPgType(c.type.name);
      const hinted = hints?.get(c.name);
      return {
        name: c.name,
        pgType: c.type.name,
        tsType: isArr ? `${baseTsType}[]` : baseTsType,
        nullable: hinted ? hinted === 'nullable' : c.nullable,
      };
    });

    return { params, columns };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/dbInferrerHints.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests still pass (no hints = same behavior)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/dbInferrer.ts tests/integration/dbInferrerHints.test.ts
git commit -m "feat: accept nullability hints in DbInferrer.infer()"
```

---

## Chunk 3: DiagnosticsEngine Wiring

### Task 3: Extract hints in DiagnosticsEngine and pass through pipeline

**Files:**
- Modify: `packages/core/src/diagnostics.ts:~100-147`

Hint extraction must happen at the `DiagnosticsEngine` level — the earliest point where `query.sqlText` is available — so that:
1. Clean SQL (without hint comment) flows through `extractParams()` and `parseSqlAsync()`
2. The hint map is passed explicitly to `inferrer.infer(sql, hints)`
3. No implicit dependency on `paramExtractor` preserving comments

- [ ] **Step 1: Identify the insertion point**

In `packages/core/src/diagnostics.ts`, find the `analyzeQuery()` method. The flow is:

```
query.sqlText → extractParams() → extracted.normalized → inferrer.infer()
```

We need to insert hint extraction before `extractParams()`:

```
query.sqlText → extractNullabilityHints() → cleanedSql → extractParams() → ... → inferrer.infer(normalized, hints)
```

- [ ] **Step 2: Add import and wire hint extraction**

Add to the imports in `packages/core/src/diagnostics.ts`:

```typescript
import { extractNullabilityHints } from './hintExtractor.js';
```

Then in `analyzeQuery()`, before the `extractParams()` call, add:

```typescript
const { cleanedSql, hints } = extractNullabilityHints(query.sqlText);
```

Change the `extractParams()` call to use `cleanedSql` instead of `query.sqlText`:

```typescript
const extracted = extractParams(cleanedSql);
```

And change the `inferrer.infer()` call to pass hints:

```typescript
const inferred = await this.inferrer!.infer(extracted.normalized, hints);
```

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS — existing tests don't use hint comments, so `hints` is always empty

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/diagnostics.ts
git commit -m "feat: wire nullability hint extraction into DiagnosticsEngine pipeline"
```

---

## Chunk 4: Edge Cases

### Task 4: Edge case coverage for hint extraction

**Files:**
- Modify: `tests/integration/hintExtractor.test.ts`

- [ ] **Step 1: Add edge case tests**

Add to `tests/integration/hintExtractor.test.ts`:

```typescript
  it('handles extra whitespace and newlines in column lists', () => {
    const sql = '/* @not-null   bar ,  baz  */ SELECT foo AS bar, qux AS baz FROM t';
    const result = extractNullabilityHints(sql);
    expect(result.hints.get('bar')).toBe('not-null');
    expect(result.hints.get('baz')).toBe('not-null');
  });

  it('handles empty SQL', () => {
    const result = extractNullabilityHints('');
    expect(result.cleanedSql).toBe('');
    expect(result.hints.size).toBe(0);
  });

  it('last annotation wins when column appears in both @nullable and @not-null', () => {
    const sql = '/* @nullable x @not-null x */ SELECT 1 AS x';
    const result = extractNullabilityHints(sql);
    // Map.set overwrites — last annotation wins
    expect(result.hints.get('x')).toBe('not-null');
  });

  it('preserves non-hint leading comment (passes through to database)', () => {
    const sql = '/* TODO: optimize */ SELECT id FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.cleanedSql).toBe(sql);
  });

  it('rejects column names with invalid characters', () => {
    const sql = '/* @not-null foo bar, baz */ SELECT 1 AS baz';
    const result = extractNullabilityHints(sql);
    // "foo bar" has a space — not a valid identifier, should be filtered out
    expect(result.hints.has('foo bar')).toBe(false);
    expect(result.hints.get('baz')).toBe('not-null');
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/integration/hintExtractor.test.ts`
Expected: All tests PASS (these should work with the existing implementation)

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/integration/hintExtractor.test.ts
git commit -m "test: add edge case coverage for nullability hint extraction"
```
