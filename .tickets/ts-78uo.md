---
id: ts-78uo
status: closed
deps: [ts-cffs, ts-7nij]
links: []
created: 2026-03-28T14:46:49Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [core, database]
---
# Task 4: PGLite Adapter

Implement the PGLite database adapter with query description, enum/composite introspection, and integration tests.

### Task 4: PGLite Adapter

**Files:**
- Create: `packages/core/src/adapters/database/pgliteAdapter.ts`
- Create: `tests/integration/pgliteAdapter.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/pgliteAdapter.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGLiteAdapter } from '@ts-sqlx/core/src/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('PGLiteAdapter', () => {
  let adapter: PGLiteAdapter;

  beforeAll(async () => {
    adapter = await PGLiteAdapter.create();
    const schema = fs.readFileSync(
      path.join(__dirname, '../fixtures/schema.sql'),
      'utf8'
    );
    await adapter.executeSchema(schema);
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  it('reports connected after create', () => {
    expect(adapter.isConnected()).toBe(true);
  });

  it('describes a simple SELECT', async () => {
    const info = await adapter.describeQuery(
      'SELECT id, email, name FROM users WHERE id = $1'
    );
    expect(info.params).toHaveLength(1);
    expect(info.params[0].name).toBe('uuid');

    expect(info.columns).toHaveLength(3);
    expect(info.columns[0].name).toBe('id');
    expect(info.columns[1].name).toBe('email');
    expect(info.columns[2].name).toBe('name');
  });

  it('describes INSERT with multiple params', async () => {
    const info = await adapter.describeQuery(
      'INSERT INTO users (id, email, name) VALUES ($1, $2, $3) RETURNING id'
    );
    expect(info.params).toHaveLength(3);
    expect(info.columns).toHaveLength(1);
    expect(info.columns[0].name).toBe('id');
  });

  it('returns enum values', async () => {
    const values = await adapter.getEnumValues('status_enum');
    expect(values).toEqual(['draft', 'published', 'archived']);
  });

  it('reports not connected after disconnect', async () => {
    const temp = await PGLiteAdapter.create();
    await temp.disconnect();
    expect(temp.isConnected()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/pgliteAdapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement PGLiteAdapter**

```typescript
// packages/core/src/adapters/database/pgliteAdapter.ts
import { PGlite } from '@electric-sql/pglite';
import type {
  DatabaseAdapter,
  QueryTypeInfo,
  CompositeField,
} from './types.js';
import { oidToTypeName, isArrayOid, arrayElementTypeName } from './oidMap.js';

export class PGLiteAdapter implements DatabaseAdapter {
  private db: PGlite | null = null;

  private constructor() {}

  static async create(): Promise<PGLiteAdapter> {
    const adapter = new PGLiteAdapter();
    adapter.db = new PGlite();
    await adapter.db.waitReady;
    return adapter;
  }

  async connect(): Promise<void> {
    // Already connected via create()
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  isConnected(): boolean {
    return this.db !== null;
  }

  async executeSchema(sql: string): Promise<void> {
    if (!this.db) throw new Error('Not connected');
    await this.db.exec(sql);
  }

  async describeQuery(sql: string): Promise<QueryTypeInfo> {
    if (!this.db) throw new Error('Not connected');

    const result = await this.db.describeQuery(sql);

    return {
      params: (result.queryParams ?? []).map((p) => {
        const isArr = isArrayOid(p.dataTypeID);
        const typeName = oidToTypeName(p.dataTypeID);
        return {
          oid: p.dataTypeID,
          name: isArr ? arrayElementTypeName(typeName) : typeName,
          isArray: isArr,
        };
      }),
      columns: (result.resultFields ?? []).map((f) => {
        const isArr = isArrayOid(f.dataTypeID);
        const typeName = oidToTypeName(f.dataTypeID);
        return {
          name: f.name,
          type: {
            oid: f.dataTypeID,
            name: isArr ? arrayElementTypeName(typeName) : typeName,
            isArray: isArr,
          },
          nullable: true, // PGLite limitation: always assume nullable
        };
      }),
    };
  }

  async getEnumValues(typeName: string): Promise<string[]> {
    if (!this.db) throw new Error('Not connected');
    const result = await this.db.query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum
       JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
       WHERE pg_type.typname = $1
       ORDER BY pg_enum.enumsortorder`,
      [typeName]
    );
    return result.rows.map((r) => r.enumlabel);
  }

  async getCompositeFields(typeName: string): Promise<CompositeField[]> {
    if (!this.db) throw new Error('Not connected');
    const result = await this.db.query<{
      attname: string;
      atttypid: number;
    }>(
      `SELECT a.attname, a.atttypid
       FROM pg_attribute a
       JOIN pg_type t ON a.attrelid = t.typrelid
       WHERE t.typname = $1 AND a.attnum > 0
       ORDER BY a.attnum`,
      [typeName]
    );
    return result.rows.map((r) => ({
      name: r.attname,
      type: {
        oid: r.atttypid,
        name: oidToTypeName(r.atttypid),
        isArray: isArrayOid(r.atttypid),
      },
    }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/pgliteAdapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/adapters/database/pgliteAdapter.ts tests/integration/pgliteAdapter.test.ts
git commit -m "feat: add PGLite database adapter"
```

## Design

PGLite WASM adapter using describeQuery() for type inference. Nullable always true (PGLite limitation). Uses oidMap for type resolution.

## Acceptance Criteria

PGLiteAdapter implements DatabaseAdapter; describeQuery returns correct types for fixture schema; enum values retrieved; tests pass; commit created

