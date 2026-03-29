# Node-Postgres Adapter Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a real PostgreSQL adapter using the `pg` package that connects via `database.url`, provides accurate nullability inference via `pg_attribute`, and integrates into the CLI and language server.

**Architecture:** New `PgAdapter` class implements the existing `DatabaseAdapter` interface using `pg.Pool`. For type inference, implements the `Submittable` interface to access `pg`'s low-level `Connection` object and send raw PostgreSQL wire protocol messages: `PARSE` (register prepared statement) → `DESCRIBE` (get `ParameterDescription` + `RowDescription` without executing the query). This gives us parameter OIDs, column OIDs, and crucially `tableID`/`columnID` on every result field — enabling accurate nullability via a batched `pg_attribute.attnotnull` lookup. No query execution, no LIMIT 0 tricks, no transaction rollback — works for SELECT and DML alike. Same pattern used by `pg-cursor`. Test infrastructure uses Docker. CLI and language server gain adapter selection logic based on config.

**Tech Stack:** `pg` (already in deps), Docker (test infra), vitest

**Spec:** `docs/superpowers/specs/2026-03-20-ts-sqlx-design.md` (lines 298-435)

**Deliberate spec deviations:**
- `createDatabaseAdapter()` returns `null` instead of throwing when no database is configured — this supports graceful degradation in the language server.
- When both `pglite` and `url` are set, PGLite takes priority — the spec implies mutual exclusivity but doesn't define behavior for both present.

---

## File Structure

```
packages/
├── core/src/adapters/database/
│   ├── pgAdapter.ts              # NEW: Real Postgres adapter via pg.Pool
│   └── adapterFactory.ts         # NEW: createDatabaseAdapter() factory
├── test-utils/src/
│   ├── pgFixture.ts              # NEW: Docker Postgres setup/teardown
│   └── index.ts                  # MODIFY: export new fixture
tests/
├── integration/
│   ├── pgAdapter.test.ts         # NEW: PgAdapter tests (mirrors pgliteAdapter.test.ts)
│   └── pgNullability.test.ts     # NEW: Nullability comparison tests
packages/
├── language-server/src/
│   └── server.ts                 # MODIFY: use adapter factory
├── cli/src/commands/
│   └── check.ts                  # MODIFY: use adapter factory
├── core/src/
│   └── index.ts                  # MODIFY: export PgAdapter + factory
docker-compose.test.yml           # NEW: Postgres for integration tests
```

---

## Chunk 1: PgAdapter Implementation + Docker Test Infra

### Task 1: Docker Compose for Test PostgreSQL

**Files:**
- Create: `docker-compose.test.yml`

- [ ] **Step 1: Create docker-compose.test.yml**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: ts_sqlx_test
    ports:
      - "54320:5432"
    tmpfs:
      - /var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U test"]
      interval: 1s
      timeout: 3s
      retries: 10
```

Uses port 54320 to avoid conflicts with any local Postgres. `tmpfs` mount makes it fast and ephemeral.

- [ ] **Step 2: Verify Docker container starts**

Run: `docker compose -f docker-compose.test.yml up -d --wait`
Expected: Container starts and health check passes.

- [ ] **Step 3: Verify connectivity and tear down**

Run: `PGPASSWORD=test psql -h localhost -p 54320 -U test -d ts_sqlx_test -c 'SELECT 1'`
Expected: Returns `1`.
Then: `docker compose -f docker-compose.test.yml down`

- [ ] **Step 4: Commit**

```bash
git add docker-compose.test.yml
git commit -m "chore: add docker-compose for test PostgreSQL"
```

---

### Task 2: PgAdapter Core Implementation

**Files:**
- Create: `packages/core/src/adapters/database/pgAdapter.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/pgAdapter.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PgAdapter } from '@ts-sqlx/core/adapters/database/pgAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:54320/ts_sqlx_test';

describe('PgAdapter', () => {
  let adapter: PgAdapter;

  beforeAll(async () => {
    adapter = new PgAdapter(TEST_URL);
    await adapter.connect();
    const schema = fs.readFileSync(
      path.join(__dirname, '../fixtures/schema.sql'),
      'utf8'
    );
    await adapter.executeSchema(schema);
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  it('reports connected after connect', () => {
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

  it('describes INSERT without RETURNING (no columns)', async () => {
    const info = await adapter.describeQuery(
      'INSERT INTO users (id, email, name) VALUES ($1, $2, $3)'
    );
    expect(info.params).toHaveLength(3);
    expect(info.columns).toHaveLength(0);
  });

  it('returns enum values', async () => {
    const values = await adapter.getEnumValues('status_enum');
    expect(values).toEqual(['draft', 'published', 'archived']);
  });

  it('returns composite fields', async () => {
    const fields = await adapter.getCompositeFields('address');
    expect(fields).toHaveLength(3);
    expect(fields[0].name).toBe('street');
    expect(fields[1].name).toBe('city');
    expect(fields[2].name).toBe('zip');
  });

  it('throws when not connected', async () => {
    const disconnected = new PgAdapter(TEST_URL);
    await expect(disconnected.describeQuery('SELECT 1')).rejects.toThrow('Not connected');
  });

  it('reports not connected after disconnect', async () => {
    const temp = new PgAdapter(TEST_URL);
    await temp.connect();
    await temp.disconnect();
    expect(temp.isConnected()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/pgAdapter.test.ts`
Expected: FAIL — cannot resolve `pgAdapter.js` module.

- [ ] **Step 3: Write PgAdapter implementation**

Create `packages/core/src/adapters/database/pgAdapter.ts`.

The adapter has two layers:
1. **PgAdapter** — public class implementing `DatabaseAdapter`, uses `pg.Pool` for high-level operations and `QueryDescriber` for type inference.
2. **QueryDescriber** — internal class implementing `pg`'s `Submittable` interface to send raw PARSE/DESCRIBE wire protocol messages via the pool client's `Connection` object. This is the same extension pattern used by `pg-cursor`.

```typescript
import pg from 'pg';
import type {
  DatabaseAdapter,
  QueryTypeInfo,
  PgTypeInfo,
  ColumnInfo,
  CompositeField,
} from './types.js';
import { oidToTypeName, isArrayOid, arrayElementTypeName } from './oidMap.js';

const { Pool } = pg;

/**
 * Result from a PARSE + DESCRIBE sequence.
 * parameterOIDs come from ParameterDescription.
 * fields come from RowDescription (or empty for NoData).
 */
interface DescribeResult {
  parameterOIDs: number[];
  fields: Array<{
    name: string;
    tableID: number;
    columnID: number;
    dataTypeID: number;
  }>;
}

/**
 * Implements pg's Submittable interface to send raw PARSE + DESCRIBE
 * wire protocol messages. Passed to client.query() which calls submit()
 * with the underlying Connection object — same pattern as pg-cursor.
 *
 * This gets parameter types AND column metadata (including tableID/columnID
 * for nullability lookups) without executing the query at all.
 */
class QueryDescriber {
  // Required by pg's Submittable contract — Client may call these
  // for various protocol messages. No-ops for our use case.
  handleDataRow: (msg: any) => void = () => {};
  handlePortalSuspended: () => void = () => {};
  handleCommandComplete: (msg: any) => void = () => {};
  handleEmptyQuery: () => void = () => {};

  // These are set in submit() to resolve/reject the promise.
  // pg's Client delegates readyForQuery and error to these methods
  // on the active query, so we must NOT also use connection.once()
  // for these events (that would fire the promise twice).
  handleReadyForQuery: () => void = () => {};
  handleRowDescription: (msg: any) => void = () => {};
  handleError: (err: Error) => void = () => {};

  private result: DescribeResult = { parameterOIDs: [], fields: [] };
  private connection: any = null;
  private resolve!: (result: DescribeResult) => void;
  private reject!: (err: Error) => void;
  readonly promise: Promise<DescribeResult>;

  constructor(private sql: string, private stmtName: string) {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  /**
   * Clean up connection.once() listeners that may not have fired.
   * Prevents leaks if error occurs before all messages arrive.
   */
  private cleanup(): void {
    if (this.connection) {
      this.connection.removeAllListeners('parameterDescription');
      this.connection.removeAllListeners('noData');
    }
  }

  /**
   * Called by pg Client with the underlying Connection object.
   * Send PARSE → DESCRIBE(Statement) → SYNC via the wire protocol.
   */
  submit(connection: any): void {
    this.connection = connection;

    // Register listeners for events NOT delegated by pg's Client.
    // parameterDescription and noData have no handle* counterpart,
    // so we must listen on the connection directly.
    connection.once('parameterDescription', (msg: { dataTypeIDs: number[] }) => {
      this.result.parameterOIDs = msg.dataTypeIDs;
    });

    connection.once('noData', () => {
      // Query returns no columns (e.g. INSERT without RETURNING)
      this.result.fields = [];
    });

    // rowDescription IS delegated by Client via handleRowDescription,
    // but we use connection.once() for consistency with the above.
    // Our handleRowDescription is a no-op so there's no double-fire.
    connection.once('rowDescription', (msg: { fields: any[] }) => {
      this.result.fields = msg.fields.map((f: any) => ({
        name: f.name,
        tableID: f.tableID,
        columnID: f.columnID,
        dataTypeID: f.dataTypeID,
      }));
    });

    // Send wire protocol messages AFTER listeners are registered
    connection.parse({
      name: this.stmtName,
      text: this.sql,
      types: [],
    });
    connection.describe({
      type: 'S', // Statement (not Portal)
      name: this.stmtName,
    });
    connection.sync();

    // Use handle* methods for events delegated by pg's Client.
    // Client intercepts readyForQuery/error on the connection and
    // calls these on the active query — do NOT also connection.once()
    // these events or the promise resolves/rejects twice.
    this.handleReadyForQuery = () => {
      this.cleanup();
      this.resolve(this.result);
    };
    this.handleError = (err: Error) => {
      this.cleanup();
      this.reject(err);
    };
  }
}

export class PgAdapter implements DatabaseAdapter {
  private pool: pg.Pool;
  private connected = false;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async connect(): Promise<void> {
    await this.pool.query('SELECT 1');
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async executeSchema(sql: string): Promise<void> {
    if (!this.connected) throw new Error('Not connected');
    await this.pool.query(sql);
  }

  async describeQuery(sql: string): Promise<QueryTypeInfo> {
    if (!this.connected) throw new Error('Not connected');

    const stmtName = `_ts_sqlx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const client = await this.pool.connect();
    try {
      // Send PARSE + DESCRIBE via the Submittable interface.
      // This gets both parameter OIDs and column metadata (including
      // tableID/columnID) without executing the query.
      const describer = new QueryDescriber(sql, stmtName);
      client.query(describer);
      const desc = await describer.promise;

      // Map parameter OIDs to PgTypeInfo
      const params: PgTypeInfo[] = desc.parameterOIDs.map((oid) => {
        const typeName = oidToTypeName(oid);
        const isArr = isArrayOid(oid);
        return {
          oid,
          name: isArr ? arrayElementTypeName(typeName) : typeName,
          isArray: isArr,
        };
      });

      // Look up nullability from pg_attribute in a single batched query.
      // Fields with tableID/columnID reference real table columns;
      // fields without (computed expressions, aggregates) default to nullable.
      const tableColumns = desc.fields
        .filter((f) => f.tableID && f.columnID);

      const nullabilityMap = new Map<string, boolean>();
      if (tableColumns.length > 0) {
        const valuesList = tableColumns
          .map((tc) => `(${tc.tableID}, ${tc.columnID})`)
          .join(', ');
        const nullResult = await client.query(
          `SELECT attrelid, attnum, NOT attnotnull AS nullable
           FROM pg_attribute
           WHERE (attrelid, attnum) IN (${valuesList})`
        );
        for (const row of nullResult.rows) {
          nullabilityMap.set(`${row.attrelid}:${row.attnum}`, row.nullable);
        }
      }

      const columns: ColumnInfo[] = desc.fields.map((f) => {
        const isArr = isArrayOid(f.dataTypeID);
        const typeName = oidToTypeName(f.dataTypeID);
        const nullable = (f.tableID && f.columnID)
          ? nullabilityMap.get(`${f.tableID}:${f.columnID}`) ?? true
          : true;

        return {
          name: f.name,
          type: {
            oid: f.dataTypeID,
            name: isArr ? arrayElementTypeName(typeName) : typeName,
            isArray: isArr,
          },
          nullable,
        };
      });

      return { params, columns };
    } finally {
      // Clean up the prepared statement and release the client
      try {
        await client.query(`DEALLOCATE ${stmtName}`);
      } catch {
        // Ignore — statement may not exist if PARSE failed
      }
      client.release();
    }
  }

  async getEnumValues(typeName: string): Promise<string[]> {
    if (!this.connected) throw new Error('Not connected');
    const result = await this.pool.query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum
       JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
       WHERE pg_type.typname = $1
       ORDER BY pg_enum.enumsortorder`,
      [typeName]
    );
    return result.rows.map((r) => r.enumlabel);
  }

  async getCompositeFields(typeName: string): Promise<CompositeField[]> {
    if (!this.connected) throw new Error('Not connected');
    const result = await this.pool.query<{
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

Key design decisions:
- **Submittable interface for PARSE/DESCRIBE:** Uses `pg`'s official extension point (same as `pg-cursor`) to access the low-level `Connection` object. Sends raw PARSE → DESCRIBE → SYNC wire protocol messages. The query is **never executed** — works for SELECT, INSERT, UPDATE, DELETE, with or without RETURNING.
- **Correct event delegation:** pg's Client delegates `readyForQuery` and `error` to `handle*` methods on the active query. `parameterDescription`, `noData`, and `rowDescription` are NOT delegated and must use `connection.once()`. Mixing these up would fire the promise twice.
- **Listener cleanup:** `cleanup()` removes outstanding `connection.once()` listeners on both success and error paths, preventing leaks if the error fires before all protocol messages arrive.
- **Listeners before sync:** Event listeners are registered before `connection.sync()` sends the message — defensive ordering.
- **Parameter OIDs from ParameterDescription:** The DESCRIBE response includes `ParameterDescription` with OIDs directly — no need to query `pg_prepared_statements` or `pg_type` for parameter info.
- **tableID/columnID from RowDescription:** Every result field includes `tableID` (table OID) and `columnID` (attribute number), enabling direct `pg_attribute` lookups.
- **Batched pg_attribute lookup:** A single `WHERE (attrelid, attnum) IN (...)` query resolves nullability for all columns at once, instead of N+1 round trips.
- **DEALLOCATE in finally:** Ensures the prepared statement is always cleaned up, even if intermediate queries throw.
- **Not-connected guards:** Consistent with PGLiteAdapter pattern — every public method checks `this.connected`.
- **No query execution, no LIMIT 0, no ROLLBACK:** This never touches the data. Safe for any query shape, zero execution cost.

- [ ] **Step 4: Start Docker Postgres and run test**

Run:
```bash
docker compose -f docker-compose.test.yml up -d --wait
npx vitest run tests/integration/pgAdapter.test.ts
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/adapters/database/pgAdapter.ts tests/integration/pgAdapter.test.ts
git commit -m "feat: add PgAdapter using node-postgres with PREPARE-based type inference"
```

---

### Task 3: Nullability Tests — PgAdapter vs PGLite

This task verifies that PgAdapter returns accurate nullability (using `pg_attribute.attnotnull`) while PGLite always returns `nullable: true`. This is the key value-add of the real adapter.

**Files:**
- Create: `tests/integration/pgNullability.test.ts`

- [ ] **Step 1: Write the nullability comparison test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PgAdapter } from '@ts-sqlx/core/adapters/database/pgAdapter.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:54320/ts_sqlx_test';

describe('Nullability: PgAdapter vs PGLite', () => {
  let pgAdapter: PgAdapter;
  let pgliteAdapter: PGLiteAdapter;
  let schema: string;

  beforeAll(async () => {
    schema = fs.readFileSync(
      path.join(__dirname, '../fixtures/schema.sql'),
      'utf8'
    );

    pgAdapter = new PgAdapter(TEST_URL);
    await pgAdapter.connect();
    await pgAdapter.executeSchema(schema);

    pgliteAdapter = await PGLiteAdapter.create();
    await pgliteAdapter.executeSchema(schema);
  });

  afterAll(async () => {
    await pgAdapter.disconnect();
    await pgliteAdapter.disconnect();
  });

  describe('PgAdapter returns accurate nullability', () => {
    it('NOT NULL columns are non-nullable', async () => {
      const info = await pgAdapter.describeQuery(
        'SELECT id, email, is_active, created_at FROM users'
      );
      const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));

      // All of these are NOT NULL in schema
      expect(byName.id.nullable).toBe(false);
      expect(byName.email.nullable).toBe(false);
      expect(byName.is_active.nullable).toBe(false);
      expect(byName.created_at.nullable).toBe(false);
    });

    it('nullable columns are nullable', async () => {
      const info = await pgAdapter.describeQuery(
        'SELECT name, age, updated_at FROM users'
      );
      const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));

      // These have no NOT NULL constraint
      expect(byName.name.nullable).toBe(true);
      expect(byName.age.nullable).toBe(true);
      expect(byName.updated_at.nullable).toBe(true);
    });

    it('mixed nullability in one query', async () => {
      const info = await pgAdapter.describeQuery(
        'SELECT id, title, body, view_count FROM posts'
      );
      const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));

      expect(byName.id.nullable).toBe(false);        // PRIMARY KEY
      expect(byName.title.nullable).toBe(false);      // NOT NULL
      expect(byName.body.nullable).toBe(true);         // nullable
      expect(byName.view_count.nullable).toBe(false);  // NOT NULL
    });

    it('type_showcase NOT NULL vs nullable', async () => {
      const info = await pgAdapter.describeQuery(
        'SELECT regular_int, small_int, text_col, char_col, bool_col, json_col, jsonb_col, timestamptz_col FROM type_showcase'
      );
      const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));

      expect(byName.regular_int.nullable).toBe(false);
      expect(byName.small_int.nullable).toBe(true);
      expect(byName.text_col.nullable).toBe(false);
      expect(byName.char_col.nullable).toBe(true);
      expect(byName.bool_col.nullable).toBe(false);
      expect(byName.json_col.nullable).toBe(true);
      expect(byName.jsonb_col.nullable).toBe(false);
      expect(byName.timestamptz_col.nullable).toBe(false);
    });

    it('expressions default to nullable', async () => {
      const info = await pgAdapter.describeQuery(
        'SELECT COUNT(*) AS cnt, now() AS current_time FROM users'
      );
      const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));

      // Computed expressions have no tableID/columnID => nullable: true
      expect(byName.cnt.nullable).toBe(true);
      expect(byName.current_time.nullable).toBe(true);
    });

    it('INSERT RETURNING preserves nullability', async () => {
      const info = await pgAdapter.describeQuery(
        'INSERT INTO users (id, email, name) VALUES ($1, $2, $3) RETURNING id, email, name'
      );
      const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));

      expect(byName.id.nullable).toBe(false);
      expect(byName.email.nullable).toBe(false);
      expect(byName.name.nullable).toBe(true);
    });
  });

  describe('PGLite always returns nullable: true (limitation)', () => {
    it('even NOT NULL columns are reported as nullable', async () => {
      const info = await pgliteAdapter.describeQuery(
        'SELECT id, email, is_active FROM users'
      );
      // PGLite limitation: describeQuery() doesn't expose tableOID/columnNumber,
      // so we can't look up attnotnull. All columns default to nullable.
      for (const col of info.columns) {
        expect(col.nullable).toBe(true);
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run:
```bash
docker compose -f docker-compose.test.yml up -d --wait
npx vitest run tests/integration/pgNullability.test.ts
```
Expected: All tests PASS. (Depends on Task 2 being complete.)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/pgNullability.test.ts
git commit -m "test: add nullability comparison tests for PgAdapter vs PGLite"
```

---

### Task 4: Test Fixture Utility for Real PostgreSQL

**Files:**
- Create: `packages/test-utils/src/pgFixture.ts`
- Modify: `packages/test-utils/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/pgFixture.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPgFixture, type PgFixture } from '@ts-sqlx/test-utils';

describe('PgFixture', () => {
  let fixture: PgFixture;

  beforeAll(async () => {
    fixture = await createPgFixture();
    await fixture.setup();
  });

  afterAll(async () => {
    await fixture.teardown();
  });

  it('provides a connected adapter', () => {
    expect(fixture.adapter.isConnected()).toBe(true);
  });

  it('can describe queries against fixture schema', async () => {
    const info = await fixture.adapter.describeQuery(
      'SELECT id, email FROM users WHERE id = $1'
    );
    expect(info.columns).toHaveLength(2);
    expect(info.params).toHaveLength(1);
  });

  it('returns accurate nullability', async () => {
    const info = await fixture.adapter.describeQuery(
      'SELECT email, name FROM users'
    );
    const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));
    expect(byName.email.nullable).toBe(false);  // NOT NULL
    expect(byName.name.nullable).toBe(true);     // nullable
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/pgFixture.test.ts`
Expected: FAIL — `createPgFixture` does not exist in `@ts-sqlx/test-utils`.

- [ ] **Step 3: Write pgFixture.ts**

Create `packages/test-utils/src/pgFixture.ts`:

```typescript
import { PgAdapter } from '@ts-sqlx/core/adapters/database/pgAdapter.js';
import type { DatabaseAdapter } from '@ts-sqlx/core/adapters/database/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../tests/fixtures');

const DEFAULT_TEST_URL = 'postgresql://test:test@localhost:54320/ts_sqlx_test';

export interface PgFixture {
  adapter: DatabaseAdapter;
  connectionUrl: string;
  setup(): Promise<void>;
  teardown(): Promise<void>;
}

/**
 * Ensure the test Docker Postgres is running.
 * Starts it if not already up. Requires Docker.
 */
function ensurePostgresRunning(): void {
  try {
    execSync(
      'docker compose -f docker-compose.test.yml up -d --wait',
      { cwd: path.resolve(__dirname, '../../..'), stdio: 'pipe', timeout: 60000 }
    );
  } catch (e) {
    throw new Error(
      `Failed to start test PostgreSQL. Is Docker running?\n${(e as Error).message}`
    );
  }
}

export async function createPgFixture(
  schemaPath?: string,
  connectionUrl?: string
): Promise<PgFixture> {
  const resolvedSchema = schemaPath ?? path.join(FIXTURES_DIR, 'schema.sql');
  const url = connectionUrl ?? process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_URL;

  // Auto-start Docker Postgres if TEST_DATABASE_URL is not explicitly set
  if (!process.env.TEST_DATABASE_URL) {
    ensurePostgresRunning();
  }

  const adapter = new PgAdapter(url);

  return {
    adapter,
    connectionUrl: url,
    async setup() {
      await adapter.connect();
      // Drop and recreate public schema for isolation between test suites
      await adapter.executeSchema('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      const schema = fs.readFileSync(resolvedSchema, 'utf8');
      await adapter.executeSchema(schema);
    },
    async teardown() {
      await adapter.disconnect();
    },
  };
}
```

- [ ] **Step 4: Update test-utils index.ts**

Add to `packages/test-utils/src/index.ts`:

```typescript
export { createPgFixture } from './pgFixture.js';
export type { PgFixture } from './pgFixture.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/integration/pgFixture.test.ts`
Expected: All tests PASS. Docker auto-starts if needed.

- [ ] **Step 6: Commit**

```bash
git add packages/test-utils/src/pgFixture.ts packages/test-utils/src/index.ts tests/integration/pgFixture.test.ts
git commit -m "feat: add PgFixture test utility with Docker auto-start"
```

---

## Chunk 2: Adapter Factory + CLI/Server Integration + Exports

### Task 5: Adapter Factory

**Files:**
- Create: `packages/core/src/adapters/database/adapterFactory.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/adapterFactory.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createDatabaseAdapter } from '@ts-sqlx/core/adapters/database/adapterFactory.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import { PgAdapter } from '@ts-sqlx/core/adapters/database/pgAdapter.js';
import type { TsSqlxConfig } from '@ts-sqlx/core/config.js';

function makeConfig(db: TsSqlxConfig['database']): TsSqlxConfig {
  return {
    database: db,
    paths: { include: [], exclude: [] },
    cache: { path: '' },
    diagnostics: { untyped: 'warning', unable_to_analyze: 'info', no_connection: 'warning' },
  };
}

describe('createDatabaseAdapter', () => {
  it('returns PGLiteAdapter when pglite is true', async () => {
    const adapter = await createDatabaseAdapter(
      makeConfig({ pglite: true, schema: 'schema.sql' })
    );
    expect(adapter).toBeInstanceOf(PGLiteAdapter);
    await adapter!.disconnect();
  });

  it('returns PgAdapter when url is set', async () => {
    const url = process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:54320/ts_sqlx_test';
    const adapter = await createDatabaseAdapter(makeConfig({ url }));
    expect(adapter).toBeInstanceOf(PgAdapter);
    await adapter!.disconnect();
  });

  it('returns null when no database configured', async () => {
    const adapter = await createDatabaseAdapter(makeConfig({}));
    expect(adapter).toBeNull();
  });

  it('prefers pglite when both pglite and url are set', async () => {
    const adapter = await createDatabaseAdapter(
      makeConfig({ pglite: true, schema: 'schema.sql', url: 'postgresql://unused' })
    );
    expect(adapter).toBeInstanceOf(PGLiteAdapter);
    await adapter!.disconnect();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/adapterFactory.test.ts`
Expected: FAIL — `adapterFactory.js` does not exist.

- [ ] **Step 3: Write adapterFactory.ts**

Create `packages/core/src/adapters/database/adapterFactory.ts`:

```typescript
import type { TsSqlxConfig } from '../../config.js';
import type { DatabaseAdapter } from './types.js';
import { PGLiteAdapter } from './pgliteAdapter.js';
import { PgAdapter } from './pgAdapter.js';

export async function createDatabaseAdapter(
  config: TsSqlxConfig
): Promise<DatabaseAdapter | null> {
  if (config.database.pglite) {
    return PGLiteAdapter.create();
  }

  if (config.database.url) {
    const adapter = new PgAdapter(config.database.url);
    await adapter.connect();
    return adapter;
  }

  return null;
}
```

Note: The `./adapters/database/*` wildcard export in `packages/core/package.json` already covers this file, so no package.json changes are needed.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
docker compose -f docker-compose.test.yml up -d --wait
npx vitest run tests/integration/adapterFactory.test.ts
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/adapters/database/adapterFactory.ts tests/integration/adapterFactory.test.ts
git commit -m "feat: add createDatabaseAdapter factory for config-driven adapter selection"
```

---

### Task 6: Update Core Exports

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add PgAdapter and factory exports**

Add to `packages/core/src/index.ts`:

```typescript
export { PgAdapter } from './adapters/database/pgAdapter.js';
export { createDatabaseAdapter } from './adapters/database/adapterFactory.js';
```

- [ ] **Step 2: Verify build passes**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat: export PgAdapter and createDatabaseAdapter from core"
```

---

### Task 7: Update CLI Check Command

**Files:**
- Modify: `packages/cli/src/commands/check.ts`

- [ ] **Step 1: Replace hardcoded PGLite with adapter factory**

In `packages/cli/src/commands/check.ts`:

Replace the `PGLiteAdapter` import with:
```typescript
import { createDatabaseAdapter } from '@ts-sqlx/core/adapters/database/adapterFactory.js';
```

Replace the adapter creation block (the `let dbAdapter = null; if (config.database.pglite ...` block) with:

```typescript
    let dbAdapter = null;
    try {
      dbAdapter = await createDatabaseAdapter(config);
      if (dbAdapter && config.database.pglite && config.database.schema) {
        const schemaPath = path.resolve(cwd, config.database.schema);
        if (fs.existsSync(schemaPath)) {
          await dbAdapter.executeSchema(fs.readFileSync(schemaPath, 'utf8'));
        }
      }
    } catch (e) {
      console.error(`Failed to initialize database: ${(e as Error).message}`);
      process.exit(1);
    }
```

Schema loading only happens when `config.database.pglite` is true — a real Postgres database already has the schema.

- [ ] **Step 2: Verify build passes**

Run: `cd packages/cli && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/check.ts
git commit -m "refactor: use adapter factory in CLI check command"
```

---

### Task 8: Update Language Server

**Files:**
- Modify: `packages/language-server/src/server.ts`

- [ ] **Step 1: Replace hardcoded PGLite with adapter factory**

In `packages/language-server/src/server.ts`:

Replace the `PGLiteAdapter` import with:
```typescript
import { createDatabaseAdapter } from '@ts-sqlx/core/adapters/database/adapterFactory.js';
```

Replace the adapter creation block (the `let dbAdapter = null; if (config.database.pglite ...` block inside `onInitialize`) with:

```typescript
    let dbAdapter = null;
    try {
      dbAdapter = await createDatabaseAdapter(config);
      if (dbAdapter && config.database.pglite && config.database.schema) {
        const schemaPath = path.resolve(rootPath, config.database.schema);
        if (fs.existsSync(schemaPath)) {
          await dbAdapter.executeSchema(fs.readFileSync(schemaPath, 'utf8'));
        }
      }
    } catch (e) {
      connection.console.error(`Failed to initialize database adapter: ${(e as Error).message}`);
    }
```

- [ ] **Step 2: Verify build passes**

Run: `cd packages/language-server && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/language-server/src/server.ts
git commit -m "refactor: use adapter factory in language server"
```

---

### Task 9: Add npm Scripts for Test Postgres Lifecycle

**Files:**
- Modify: root `package.json`

- [ ] **Step 1: Add convenience scripts**

Add to root `package.json` scripts:

```json
"db:test:up": "docker compose -f docker-compose.test.yml up -d --wait",
"db:test:down": "docker compose -f docker-compose.test.yml down",
"test:pg": "docker compose -f docker-compose.test.yml up -d --wait && vitest run tests/integration/pgAdapter.test.ts tests/integration/pgNullability.test.ts tests/integration/pgFixture.test.ts tests/integration/adapterFactory.test.ts"
```

- [ ] **Step 2: Verify scripts work**

Run: `pnpm db:test:up && pnpm db:test:down`
Expected: Container starts and stops cleanly.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add npm scripts for test Postgres lifecycle"
```
