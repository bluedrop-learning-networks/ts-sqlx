---
id: ts-zk8i
status: closed
deps: [ts-78uo]
links: []
created: 2026-03-28T14:47:34Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [core, inference]
---
# Task 10: DB Inferrer

Implement the database type inferrer that uses PREPARE-based query description to map PG types to TypeScript types.

### Task 10: DB Inferrer

**Files:**
- Create: `packages/core/src/dbInferrer.ts`
- Create: `tests/integration/dbInferrer.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/dbInferrer.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@ts-sqlx/core/src/dbInferrer.js';
import { PGLiteAdapter } from '@ts-sqlx/core/src/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('DbInferrer', () => {
  let adapter: PGLiteAdapter;
  let inferrer: DbInferrer;

  beforeAll(async () => {
    adapter = await PGLiteAdapter.create();
    const schema = fs.readFileSync(
      path.join(__dirname, '../fixtures/schema.sql'),
      'utf8'
    );
    await adapter.executeSchema(schema);
    inferrer = new DbInferrer(adapter);
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  it('infers simple SELECT columns', async () => {
    const result = await inferrer.infer('SELECT id, email, name FROM users');
    expect(result.columns).toHaveLength(3);
    expect(result.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });   // uuid
    expect(result.columns[1]).toMatchObject({ name: 'email', tsType: 'string' }); // text
    expect(result.columns[2]).toMatchObject({ name: 'name', tsType: 'string' });  // text
  });

  it('infers parameter types', async () => {
    const result = await inferrer.infer('SELECT * FROM users WHERE id = $1');
    expect(result.params).toHaveLength(1);
    expect(result.params[0].tsType).toBe('string'); // uuid
  });

  it('infers numeric types correctly', async () => {
    const result = await inferrer.infer(
      'SELECT regular_int, big_int, numeric_val FROM type_showcase'
    );
    expect(result.columns[0].tsType).toBe('number');  // int4
    expect(result.columns[1].tsType).toBe('string');   // int8/bigint
    expect(result.columns[2].tsType).toBe('string');   // numeric
  });

  it('infers boolean type', async () => {
    const result = await inferrer.infer('SELECT bool_col FROM type_showcase');
    expect(result.columns[0].tsType).toBe('boolean');
  });

  it('infers date/time types', async () => {
    const result = await inferrer.infer(
      'SELECT date_col, timestamptz_col, time_col, interval_col FROM type_showcase'
    );
    expect(result.columns[0].tsType).toBe('Date');
    expect(result.columns[1].tsType).toBe('Date');
    expect(result.columns[2].tsType).toBe('string');
    expect(result.columns[3].tsType).toBe('string');
  });

  it('infers json as unknown', async () => {
    const result = await inferrer.infer('SELECT json_col, jsonb_col FROM type_showcase');
    expect(result.columns[0].tsType).toBe('unknown');
    expect(result.columns[1].tsType).toBe('unknown');
  });

  it('infers array types', async () => {
    const result = await inferrer.infer('SELECT int_array, text_array FROM type_showcase');
    expect(result.columns[0].tsType).toBe('number[]');
    expect(result.columns[1].tsType).toBe('string[]');
  });

  it('infers INSERT RETURNING', async () => {
    const result = await inferrer.infer(
      'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id, created_at'
    );
    expect(result.params).toHaveLength(2);
    expect(result.columns).toHaveLength(2);
    expect(result.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });
    expect(result.columns[1]).toMatchObject({ name: 'created_at', tsType: 'Date' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/dbInferrer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement DB inferrer**

```typescript
// packages/core/src/dbInferrer.ts
import type { DatabaseAdapter, QueryTypeInfo } from './adapters/database/types.js';
import type { InferredQueryType, InferredParam, InferredColumn } from './types.js';
import { tsTypeFromPgType } from './adapters/database/oidMap.js';

export class DbInferrer {
  constructor(private adapter: DatabaseAdapter) {}

  async infer(sql: string): Promise<InferredQueryType> {
    const info: QueryTypeInfo = await this.adapter.describeQuery(sql);

    const params: InferredParam[] = info.params.map((p, i) => {
      const isArr = p.isArray;
      const baseTsType = tsTypeFromPgType(p.name);
      return {
        index: i + 1,
        pgType: p.name,
        tsType: isArr ? `${baseTsType}[]` : baseTsType,
        nullable: false, // Parameters are typically not nullable
      };
    });

    const columns: InferredColumn[] = info.columns.map((c) => {
      const isArr = c.type.isArray;
      const baseTsType = tsTypeFromPgType(c.type.name);
      return {
        name: c.name,
        pgType: c.type.name,
        tsType: isArr ? `${baseTsType}[]` : baseTsType,
        nullable: c.nullable,
      };
    });

    return { params, columns };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/dbInferrer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/dbInferrer.ts tests/integration/dbInferrer.test.ts
git commit -m "feat: add database type inferrer using PREPARE-based approach"
```

## Design

Uses DatabaseAdapter.describeQuery then maps PG types to TS types via tsTypeFromPgType. Arrays detected via isArray flag.

## Acceptance Criteria

DbInferrer.infer returns correct TypeScript types for all PG types (int→number, bigint→string, json→unknown, etc.); array types mapped; INSERT RETURNING works; tests pass; commit created

