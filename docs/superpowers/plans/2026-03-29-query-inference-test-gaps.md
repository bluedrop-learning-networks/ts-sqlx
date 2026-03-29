# Query Inference Test Gaps Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add comprehensive integration tests for SQL query patterns not currently covered — JOINs with nullability, CTEs, set operations, window functions, aggregation edge cases, JSON operators, UPDATE/DELETE/UPSERT, and expression type inference.

**Architecture:** All new tests use the existing `DbInferrer` + `PGLiteAdapter` pattern from `returnTypes.test.ts` and `dbInferrer.test.ts`. Each test group lives in a focused test file. Where PGLite cannot test nullability (it always returns `nullable: true`), we add corresponding `PgAdapter`-only tests gated by a real PostgreSQL connection. The test schema is extended with additional tables/columns needed by new test cases.

**Tech Stack:** Vitest, PGLiteAdapter, PgAdapter, DbInferrer, existing `tests/fixtures/schema.sql`

---

## File Structure

| File | Purpose |
|------|---------|
| `tests/fixtures/schema.sql` | **Modify** — add `orders`, `categories`, `order_items` tables for JOIN/CTE/set-op tests |
| `tests/integration/joins.test.ts` | **Create** — INNER/LEFT/RIGHT/FULL/CROSS/self-join type inference |
| `tests/integration/ctes.test.ts` | **Create** — simple, multi-CTE, recursive CTE inference |
| `tests/integration/setOperations.test.ts` | **Create** — UNION/UNION ALL/INTERSECT/EXCEPT |
| `tests/integration/windowFunctions.test.ts` | **Create** — ROW_NUMBER, RANK, LAG/LEAD, SUM OVER |
| `tests/integration/aggregationEdgeCases.test.ts` | **Create** — COALESCE+agg, STRING_AGG, FILTER, GROUP BY+HAVING |
| `tests/integration/jsonOperators.test.ts` | **Create** — `->`, `->>`, `#>`, `#>>`, jsonb_agg, jsonb_build_object |
| `tests/integration/mutations.test.ts` | **Create** — UPDATE/DELETE RETURNING, INSERT ON CONFLICT |
| `tests/integration/expressions.test.ts` | **Create** — string concat, CASE, BETWEEN, LIKE, math ops, subquery varieties |
| `tests/integration/joinNullability.test.ts` | **Create** — PgAdapter-only tests verifying JOIN nullability semantics |

---

## Chunk 1: Schema Extension + JOIN Tests

### Task 1: Extend test schema with new tables

**Files:**
- Modify: `tests/fixtures/schema.sql`

- [ ] **Step 1: Add new tables to schema.sql**

Append to the end of `tests/fixtures/schema.sql`:

```sql
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    parent_id INTEGER REFERENCES categories(id)
);

CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    status status_enum NOT NULL DEFAULT 'draft',
    total NUMERIC(10, 2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(10, 2) NOT NULL
);
```

- [ ] **Step 2: Verify schema loads in PGLite**

Run: `npx vitest run tests/integration/pgliteAdapter.test.ts`
Expected: All existing tests still PASS (schema is backwards-compatible)

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/schema.sql
git commit -m "test: add categories, orders, order_items tables to test schema"
```

---

### Task 2: JOIN type inference tests

**Files:**
- Create: `tests/integration/joins.test.ts`

- [ ] **Step 1: Write JOIN tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@ts-sqlx/core/dbInferrer.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('JOIN type inference', () => {
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

  describe('INNER JOIN', () => {
    it('infers columns from both tables', async () => {
      const r = await inferrer.infer(
        'SELECT u.id, u.email, p.title FROM users u INNER JOIN posts p ON p.author_id = u.id'
      );
      expect(r.columns).toHaveLength(3);
      expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[2]).toMatchObject({ name: 'title', tsType: 'string' });
    });

    it('infers three-table join', async () => {
      const r = await inferrer.infer(`
        SELECT u.email, p.title, c.content
        FROM users u
        INNER JOIN posts p ON p.author_id = u.id
        INNER JOIN comments c ON c.post_id = p.id
      `);
      expect(r.columns).toHaveLength(3);
      expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'title', tsType: 'string' });
      expect(r.columns[2]).toMatchObject({ name: 'content', tsType: 'string' });
    });
  });

  describe('LEFT JOIN', () => {
    it('infers columns from left-joined table', async () => {
      const r = await inferrer.infer(
        'SELECT u.id, u.email, p.title FROM users u LEFT JOIN posts p ON p.author_id = u.id'
      );
      expect(r.columns).toHaveLength(3);
      // p.title comes from the optional side — type should still be string
      // (nullability is a separate concern tested in joinNullability.test.ts)
      expect(r.columns[2]).toMatchObject({ name: 'title', tsType: 'string' });
    });
  });

  describe('RIGHT JOIN', () => {
    it('infers columns from right-joined table', async () => {
      const r = await inferrer.infer(
        'SELECT u.email, p.title FROM users u RIGHT JOIN posts p ON p.author_id = u.id'
      );
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'title', tsType: 'string' });
    });
  });

  describe('FULL OUTER JOIN', () => {
    it('infers columns from full outer join', async () => {
      const r = await inferrer.infer(
        'SELECT u.email, p.title FROM users u FULL OUTER JOIN posts p ON p.author_id = u.id'
      );
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'title', tsType: 'string' });
    });
  });

  describe('CROSS JOIN', () => {
    it('infers columns from cross join', async () => {
      const r = await inferrer.infer(
        'SELECT u.email, c.name FROM users u CROSS JOIN categories c'
      );
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'name', tsType: 'string' });
    });
  });

  describe('self-join', () => {
    it('infers self-join on categories', async () => {
      const r = await inferrer.infer(
        'SELECT c.name AS child, p.name AS parent FROM categories c LEFT JOIN categories p ON p.id = c.parent_id'
      );
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'child', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'parent', tsType: 'string' });
    });
  });

  describe('JOIN with aggregation', () => {
    it('infers join with COUNT', async () => {
      const r = await inferrer.infer(`
        SELECT u.email, COUNT(p.id) AS post_count
        FROM users u
        LEFT JOIN posts p ON p.author_id = u.id
        GROUP BY u.email
      `);
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'post_count', tsType: 'string' }); // COUNT returns bigint → string
    });
  });

  describe('JOIN with parameters', () => {
    it('infers param types across joins', async () => {
      const r = await inferrer.infer(`
        SELECT u.email, p.title
        FROM users u
        INNER JOIN posts p ON p.author_id = u.id
        WHERE u.is_active = $1 AND p.view_count > $2
      `);
      expect(r.params).toHaveLength(2);
      expect(r.params[0].tsType).toBe('boolean');
      expect(r.params[1].tsType).toBe('string'); // bigint → string
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/integration/joins.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/joins.test.ts
git commit -m "test: add JOIN type inference tests (inner, left, right, full, cross, self)"
```

---

### Task 3: JOIN nullability tests (PgAdapter only)

**Files:**
- Create: `tests/integration/joinNullability.test.ts`

- [ ] **Step 1: Write nullability tests for JOINs**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PgAdapter } from '@ts-sqlx/core/adapters/database/pgAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:54320/ts_sqlx_test';

describe('JOIN nullability (PgAdapter)', () => {
  let adapter: PgAdapter;

  beforeAll(async () => {
    adapter = new PgAdapter(TEST_URL);
    await adapter.connect();
    await adapter.executeSchema('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const schema = fs.readFileSync(
      path.join(__dirname, '../fixtures/schema.sql'),
      'utf8'
    );
    await adapter.executeSchema(schema);
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  it('INNER JOIN preserves NOT NULL from both sides', async () => {
    const info = await adapter.describeQuery(
      'SELECT u.email, p.title FROM users u INNER JOIN posts p ON p.author_id = u.id'
    );
    const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));
    expect(byName.email.nullable).toBe(false);
    expect(byName.title.nullable).toBe(false);
  });

  it('LEFT JOIN makes right-side NOT NULL columns nullable', async () => {
    const info = await adapter.describeQuery(
      'SELECT u.email, p.title FROM users u LEFT JOIN posts p ON p.author_id = u.id'
    );
    const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));
    expect(byName.email.nullable).toBe(false);
    // p.title is NOT NULL in schema, but LEFT JOIN makes it nullable
    expect(byName.title.nullable).toBe(true);
  });

  it('RIGHT JOIN makes left-side NOT NULL columns nullable', async () => {
    const info = await adapter.describeQuery(
      'SELECT u.email, p.title FROM users u RIGHT JOIN posts p ON p.author_id = u.id'
    );
    const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));
    // u.email is NOT NULL in schema, but RIGHT JOIN makes it nullable
    expect(byName.email.nullable).toBe(true);
    expect(byName.title.nullable).toBe(false);
  });

  it('FULL OUTER JOIN makes both sides nullable', async () => {
    const info = await adapter.describeQuery(
      'SELECT u.email, p.title FROM users u FULL OUTER JOIN posts p ON p.author_id = u.id'
    );
    const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));
    expect(byName.email.nullable).toBe(true);
    expect(byName.title.nullable).toBe(true);
  });

  it('CROSS JOIN preserves original nullability', async () => {
    const info = await adapter.describeQuery(
      'SELECT u.email, u.name FROM users u CROSS JOIN categories c'
    );
    const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));
    expect(byName.email.nullable).toBe(false); // NOT NULL
    expect(byName.name.nullable).toBe(true);   // nullable
  });

  it('multi-level LEFT JOIN propagates nullability', async () => {
    const info = await adapter.describeQuery(`
      SELECT u.email, p.title, c.content
      FROM users u
      LEFT JOIN posts p ON p.author_id = u.id
      LEFT JOIN comments c ON c.post_id = p.id
    `);
    const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));
    expect(byName.email.nullable).toBe(false);
    expect(byName.title.nullable).toBe(true);
    expect(byName.content.nullable).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests (requires Docker PostgreSQL)**

Run: `npm run test:pg` or `npx vitest run tests/integration/joinNullability.test.ts`
Expected: All PASS (or skip if no PG connection)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/joinNullability.test.ts
git commit -m "test: add JOIN nullability tests for PgAdapter (left/right/full outer)"
```

---

## Chunk 2: CTEs + Set Operations

### Task 4: CTE type inference tests

**Files:**
- Create: `tests/integration/ctes.test.ts`

- [ ] **Step 1: Write CTE tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@ts-sqlx/core/dbInferrer.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('CTE type inference', () => {
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

  it('infers simple CTE', async () => {
    const r = await inferrer.infer(`
      WITH active_users AS (
        SELECT id, email FROM users WHERE is_active = true
      )
      SELECT id, email FROM active_users
    `);
    expect(r.columns).toHaveLength(2);
    expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });
    expect(r.columns[1]).toMatchObject({ name: 'email', tsType: 'string' });
  });

  it('infers CTE with aggregation', async () => {
    const r = await inferrer.infer(`
      WITH user_stats AS (
        SELECT author_id, COUNT(*) AS post_count, SUM(view_count) AS total_views
        FROM posts
        GROUP BY author_id
      )
      SELECT u.email, s.post_count, s.total_views
      FROM users u
      INNER JOIN user_stats s ON s.author_id = u.id
    `);
    expect(r.columns).toHaveLength(3);
    expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
    expect(r.columns[1]).toMatchObject({ name: 'post_count', tsType: 'string' }); // bigint
    expect(r.columns[2]).toMatchObject({ name: 'total_views', tsType: 'string' }); // bigint
  });

  it('infers multiple CTEs', async () => {
    const r = await inferrer.infer(`
      WITH
        active AS (SELECT id, email FROM users WHERE is_active = true),
        recent_posts AS (SELECT author_id, title FROM posts ORDER BY published_at DESC LIMIT 10)
      SELECT a.email, rp.title
      FROM active a
      INNER JOIN recent_posts rp ON rp.author_id = a.id
    `);
    expect(r.columns).toHaveLength(2);
    expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
    expect(r.columns[1]).toMatchObject({ name: 'title', tsType: 'string' });
  });

  it('infers CTE referencing another CTE', async () => {
    const r = await inferrer.infer(`
      WITH
        post_stats AS (
          SELECT author_id, COUNT(*) AS cnt FROM posts GROUP BY author_id
        ),
        top_authors AS (
          SELECT author_id, cnt FROM post_stats WHERE cnt > 5
        )
      SELECT u.email, t.cnt
      FROM users u
      INNER JOIN top_authors t ON t.author_id = u.id
    `);
    expect(r.columns).toHaveLength(2);
    expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
    expect(r.columns[1]).toMatchObject({ name: 'cnt', tsType: 'string' }); // bigint
  });

  it('infers recursive CTE', async () => {
    const r = await inferrer.infer(`
      WITH RECURSIVE cat_tree AS (
        SELECT id, name, parent_id, 1 AS depth
        FROM categories
        WHERE parent_id IS NULL
        UNION ALL
        SELECT c.id, c.name, c.parent_id, ct.depth + 1
        FROM categories c
        INNER JOIN cat_tree ct ON ct.id = c.parent_id
      )
      SELECT id, name, depth FROM cat_tree
    `);
    expect(r.columns).toHaveLength(3);
    expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'number' });
    expect(r.columns[1]).toMatchObject({ name: 'name', tsType: 'string' });
    expect(r.columns[2]).toMatchObject({ name: 'depth', tsType: 'number' });
  });

  it('infers CTE with parameters', async () => {
    const r = await inferrer.infer(`
      WITH user_posts AS (
        SELECT title, view_count FROM posts WHERE author_id = $1
      )
      SELECT title, view_count FROM user_posts WHERE view_count > $2
    `);
    expect(r.params).toHaveLength(2);
    expect(r.params[0].tsType).toBe('string'); // uuid
    expect(r.params[1].tsType).toBe('string'); // bigint
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/integration/ctes.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/ctes.test.ts
git commit -m "test: add CTE type inference tests (simple, multi, recursive, params)"
```

---

### Task 5: Set operation tests

**Files:**
- Create: `tests/integration/setOperations.test.ts`

- [ ] **Step 1: Write set operation tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@ts-sqlx/core/dbInferrer.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('set operation type inference', () => {
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

  it('infers UNION column types', async () => {
    const r = await inferrer.infer(`
      SELECT id, email AS contact FROM users
      UNION
      SELECT id, email AS contact FROM users WHERE is_active = true
    `);
    expect(r.columns).toHaveLength(2);
    expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });
    expect(r.columns[1]).toMatchObject({ name: 'contact', tsType: 'string' });
  });

  it('infers UNION ALL preserves types', async () => {
    const r = await inferrer.infer(`
      SELECT id, title FROM posts WHERE view_count > 100
      UNION ALL
      SELECT id, title FROM posts WHERE view_count <= 100
    `);
    expect(r.columns).toHaveLength(2);
    expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'number' });
    expect(r.columns[1]).toMatchObject({ name: 'title', tsType: 'string' });
  });

  it('infers INTERSECT', async () => {
    const r = await inferrer.infer(`
      SELECT id FROM users WHERE is_active = true
      INTERSECT
      SELECT user_id AS id FROM comments
    `);
    expect(r.columns).toHaveLength(1);
    expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'string' }); // uuid
  });

  it('infers EXCEPT', async () => {
    const r = await inferrer.infer(`
      SELECT id FROM users
      EXCEPT
      SELECT author_id AS id FROM posts
    `);
    expect(r.columns).toHaveLength(1);
    expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });
  });

  it('infers UNION with different column counts fails gracefully', async () => {
    // PostgreSQL rejects this at parse time — should produce an error
    await expect(
      inferrer.infer('SELECT id, email FROM users UNION SELECT id FROM users')
    ).rejects.toThrow();
  });

  it('infers UNION with parameters', async () => {
    const r = await inferrer.infer(`
      SELECT id, email FROM users WHERE age > $1
      UNION
      SELECT id, email FROM users WHERE is_active = $2
    `);
    expect(r.params).toHaveLength(2);
    expect(r.params[0].tsType).toBe('number');  // integer
    expect(r.params[1].tsType).toBe('boolean');
  });

  it('infers multi-branch UNION', async () => {
    const r = await inferrer.infer(`
      SELECT 'user' AS entity_type, id::text AS entity_id FROM users
      UNION ALL
      SELECT 'post' AS entity_type, id::text AS entity_id FROM posts
      UNION ALL
      SELECT 'comment' AS entity_type, id::text AS entity_id FROM comments
    `);
    expect(r.columns).toHaveLength(2);
    expect(r.columns[0]).toMatchObject({ name: 'entity_type', tsType: 'string' });
    expect(r.columns[1]).toMatchObject({ name: 'entity_id', tsType: 'string' });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/integration/setOperations.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/setOperations.test.ts
git commit -m "test: add set operation type inference tests (UNION, INTERSECT, EXCEPT)"
```

---

## Chunk 3: Window Functions + Aggregation Edge Cases

### Task 6: Window function tests

**Files:**
- Create: `tests/integration/windowFunctions.test.ts`

- [ ] **Step 1: Write window function tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@ts-sqlx/core/dbInferrer.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('window function type inference', () => {
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

  it('infers ROW_NUMBER()', async () => {
    const r = await inferrer.infer(
      'SELECT id, email, ROW_NUMBER() OVER (ORDER BY created_at) AS rn FROM users'
    );
    expect(r.columns).toHaveLength(3);
    expect(r.columns[2]).toMatchObject({ name: 'rn', tsType: 'string' }); // bigint
  });

  it('infers RANK() and DENSE_RANK()', async () => {
    const r = await inferrer.infer(`
      SELECT id,
        RANK() OVER (ORDER BY view_count DESC) AS rnk,
        DENSE_RANK() OVER (ORDER BY view_count DESC) AS drnk
      FROM posts
    `);
    expect(r.columns).toHaveLength(3);
    expect(r.columns[1]).toMatchObject({ name: 'rnk', tsType: 'string' });  // bigint
    expect(r.columns[2]).toMatchObject({ name: 'drnk', tsType: 'string' }); // bigint
  });

  it('infers LAG() and LEAD()', async () => {
    const r = await inferrer.infer(`
      SELECT id, title,
        LAG(title) OVER (ORDER BY id) AS prev_title,
        LEAD(title) OVER (ORDER BY id) AS next_title
      FROM posts
    `);
    expect(r.columns).toHaveLength(4);
    expect(r.columns[2]).toMatchObject({ name: 'prev_title', tsType: 'string' });
    expect(r.columns[3]).toMatchObject({ name: 'next_title', tsType: 'string' });
  });

  it('infers SUM() OVER window', async () => {
    const r = await inferrer.infer(`
      SELECT id, view_count,
        SUM(view_count) OVER (ORDER BY id) AS running_total
      FROM posts
    `);
    expect(r.columns).toHaveLength(3);
    expect(r.columns[2]).toMatchObject({ name: 'running_total', tsType: 'string' }); // bigint SUM
  });

  it('infers window with PARTITION BY', async () => {
    const r = await inferrer.infer(`
      SELECT author_id, title,
        ROW_NUMBER() OVER (PARTITION BY author_id ORDER BY view_count DESC) AS author_rank
      FROM posts
    `);
    expect(r.columns).toHaveLength(3);
    expect(r.columns[2]).toMatchObject({ name: 'author_rank', tsType: 'string' }); // bigint
  });

  it('infers window alongside regular columns', async () => {
    const r = await inferrer.infer(`
      SELECT u.email, p.title,
        COUNT(*) OVER () AS total_posts
      FROM users u
      INNER JOIN posts p ON p.author_id = u.id
    `);
    expect(r.columns).toHaveLength(3);
    expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
    expect(r.columns[1]).toMatchObject({ name: 'title', tsType: 'string' });
    expect(r.columns[2]).toMatchObject({ name: 'total_posts', tsType: 'string' }); // bigint
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/integration/windowFunctions.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/windowFunctions.test.ts
git commit -m "test: add window function type inference tests"
```

---

### Task 7: Aggregation edge case tests

**Files:**
- Create: `tests/integration/aggregationEdgeCases.test.ts`

- [ ] **Step 1: Write aggregation edge case tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@ts-sqlx/core/dbInferrer.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('aggregation edge cases', () => {
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

  describe('aggregate return types', () => {
    it('infers SUM of integer returns bigint (string)', async () => {
      const r = await inferrer.infer(
        'SELECT SUM(regular_int) AS total FROM type_showcase'
      );
      expect(r.columns[0]).toMatchObject({ name: 'total', tsType: 'string' }); // SUM(int) → bigint
    });

    it('infers AVG returns string (numeric)', async () => {
      const r = await inferrer.infer(
        'SELECT AVG(regular_int) AS avg_val FROM type_showcase'
      );
      expect(r.columns[0]).toMatchObject({ name: 'avg_val', tsType: 'string' }); // AVG → numeric
    });

    it('infers MIN/MAX preserve input type', async () => {
      const r = await inferrer.infer(
        'SELECT MIN(regular_int) AS min_val, MAX(regular_int) AS max_val FROM type_showcase'
      );
      expect(r.columns[0]).toMatchObject({ name: 'min_val', tsType: 'number' }); // int → int
      expect(r.columns[1]).toMatchObject({ name: 'max_val', tsType: 'number' });
    });

    it('infers BOOL_AND/BOOL_OR return boolean', async () => {
      const r = await inferrer.infer(
        'SELECT BOOL_AND(is_active) AS all_active, BOOL_OR(is_active) AS any_active FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'all_active', tsType: 'boolean' });
      expect(r.columns[1]).toMatchObject({ name: 'any_active', tsType: 'boolean' });
    });
  });

  describe('STRING_AGG and ARRAY_AGG', () => {
    it('infers STRING_AGG returns string', async () => {
      const r = await inferrer.infer(
        "SELECT STRING_AGG(email, ', ') AS emails FROM users"
      );
      expect(r.columns[0]).toMatchObject({ name: 'emails', tsType: 'string' });
    });

    it('infers ARRAY_AGG returns array', async () => {
      const r = await inferrer.infer(
        'SELECT ARRAY_AGG(email) AS emails FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'emails', tsType: 'string[]' });
    });

    it('infers ARRAY_AGG with ORDER BY', async () => {
      const r = await inferrer.infer(
        'SELECT ARRAY_AGG(title ORDER BY view_count DESC) AS titles FROM posts'
      );
      expect(r.columns[0]).toMatchObject({ name: 'titles', tsType: 'string[]' });
    });
  });

  describe('COALESCE with aggregates', () => {
    it('infers COALESCE(COUNT(*), 0)', async () => {
      const r = await inferrer.infer(
        'SELECT COALESCE(COUNT(*), 0) AS cnt FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'cnt', tsType: 'string' }); // bigint
    });

    it('infers COALESCE(SUM(int), 0)', async () => {
      const r = await inferrer.infer(
        'SELECT COALESCE(SUM(regular_int), 0) AS total FROM type_showcase'
      );
      // SUM(int) returns bigint → string; COALESCE preserves that
      expect(r.columns[0]).toMatchObject({ name: 'total', tsType: 'string' });
    });

    it('infers COALESCE on nullable column with fallback', async () => {
      const r = await inferrer.infer(
        "SELECT COALESCE(name, 'Anonymous') AS display_name FROM users"
      );
      expect(r.columns[0]).toMatchObject({ name: 'display_name', tsType: 'string' });
    });
  });

  describe('FILTER clause', () => {
    it('infers COUNT with FILTER', async () => {
      const r = await inferrer.infer(
        'SELECT COUNT(*) FILTER (WHERE is_active) AS active_count FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'active_count', tsType: 'string' }); // bigint
    });

    it('infers SUM with FILTER', async () => {
      const r = await inferrer.infer(
        'SELECT SUM(view_count) FILTER (WHERE view_count > 0) AS total FROM posts'
      );
      expect(r.columns[0]).toMatchObject({ name: 'total', tsType: 'string' }); // bigint
    });
  });

  describe('GROUP BY + HAVING', () => {
    it('infers GROUP BY with multiple columns', async () => {
      const r = await inferrer.infer(`
        SELECT author_id, COUNT(*) AS cnt
        FROM posts
        GROUP BY author_id
        HAVING COUNT(*) > 1
      `);
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'author_id', tsType: 'string' }); // uuid
      expect(r.columns[1]).toMatchObject({ name: 'cnt', tsType: 'string' }); // bigint
    });

    it('infers GROUP BY with CASE', async () => {
      const r = await inferrer.infer(`
        SELECT
          CASE WHEN view_count > 100 THEN 'popular' ELSE 'normal' END AS category,
          COUNT(*) AS cnt
        FROM posts
        GROUP BY 1
      `);
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'category', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'cnt', tsType: 'string' });
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/integration/aggregationEdgeCases.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/aggregationEdgeCases.test.ts
git commit -m "test: add aggregation edge case tests (STRING_AGG, FILTER, COALESCE, GROUP BY)"
```

---

## Chunk 4: JSON Operators + Mutation Queries

### Task 8: JSON operator tests

**Files:**
- Create: `tests/integration/jsonOperators.test.ts`

- [ ] **Step 1: Write JSON operator tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@ts-sqlx/core/dbInferrer.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('JSON operator type inference', () => {
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

  describe('arrow operators', () => {
    it('infers -> returns json/jsonb', async () => {
      const r = await inferrer.infer(
        "SELECT jsonb_col->'key' AS val FROM type_showcase"
      );
      expect(r.columns).toHaveLength(1);
      expect(r.columns[0]).toMatchObject({ name: 'val', tsType: 'unknown' }); // jsonb
    });

    it('infers ->> returns text', async () => {
      const r = await inferrer.infer(
        "SELECT jsonb_col->>'key' AS val FROM type_showcase"
      );
      expect(r.columns).toHaveLength(1);
      expect(r.columns[0]).toMatchObject({ name: 'val', tsType: 'string' }); // text
    });

    it('infers #> returns json/jsonb', async () => {
      const r = await inferrer.infer(
        "SELECT jsonb_col #> '{key,nested}' AS val FROM type_showcase"
      );
      expect(r.columns[0]).toMatchObject({ name: 'val', tsType: 'unknown' });
    });

    it('infers #>> returns text', async () => {
      const r = await inferrer.infer(
        "SELECT jsonb_col #>> '{key,nested}' AS val FROM type_showcase"
      );
      expect(r.columns[0]).toMatchObject({ name: 'val', tsType: 'string' });
    });
  });

  describe('JSON functions', () => {
    it('infers jsonb_agg returns jsonb', async () => {
      const r = await inferrer.infer(
        'SELECT jsonb_agg(email) AS emails FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'emails', tsType: 'unknown' }); // jsonb
    });

    it('infers jsonb_build_object returns jsonb', async () => {
      const r = await inferrer.infer(
        "SELECT jsonb_build_object('id', id, 'email', email) AS obj FROM users"
      );
      expect(r.columns[0]).toMatchObject({ name: 'obj', tsType: 'unknown' });
    });

    it('infers json_build_array returns json', async () => {
      const r = await inferrer.infer(
        'SELECT json_build_array(id, email, name) AS arr FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'arr', tsType: 'unknown' });
    });

    it('infers to_jsonb returns jsonb', async () => {
      const r = await inferrer.infer(
        'SELECT to_jsonb(u) AS user_json FROM users u'
      );
      expect(r.columns[0]).toMatchObject({ name: 'user_json', tsType: 'unknown' });
    });
  });

  describe('JSON in WHERE clause', () => {
    it('supports jsonb containment in WHERE', async () => {
      const r = await inferrer.infer(
        "SELECT id FROM type_showcase WHERE jsonb_col @> '{\"key\": \"value\"}'::jsonb"
      );
      expect(r.columns).toHaveLength(1);
      expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'number' });
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/integration/jsonOperators.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/jsonOperators.test.ts
git commit -m "test: add JSON operator type inference tests (arrows, functions, containment)"
```

---

### Task 9: Mutation query tests (UPDATE, DELETE, UPSERT)

**Files:**
- Create: `tests/integration/mutations.test.ts`

- [ ] **Step 1: Write mutation tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@ts-sqlx/core/dbInferrer.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('mutation type inference', () => {
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

  describe('UPDATE', () => {
    it('infers UPDATE without RETURNING (no columns)', async () => {
      const r = await inferrer.infer(
        'UPDATE users SET name = $1 WHERE id = $2'
      );
      expect(r.columns).toHaveLength(0);
      expect(r.params).toHaveLength(2);
      expect(r.params[0].tsType).toBe('string'); // text
      expect(r.params[1].tsType).toBe('string'); // uuid
    });

    it('infers UPDATE with RETURNING', async () => {
      const r = await inferrer.infer(
        'UPDATE users SET name = $1 WHERE id = $2 RETURNING id, email, name'
      );
      expect(r.columns).toHaveLength(3);
      expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[2]).toMatchObject({ name: 'name', tsType: 'string' });
    });

    it('infers UPDATE with FROM clause', async () => {
      const r = await inferrer.infer(`
        UPDATE posts SET title = $1
        FROM users
        WHERE posts.author_id = users.id AND users.email = $2
        RETURNING posts.id, posts.title
      `);
      expect(r.params).toHaveLength(2);
      expect(r.params[0].tsType).toBe('string'); // text
      expect(r.params[1].tsType).toBe('string'); // text
      expect(r.columns).toHaveLength(2);
    });

    it('infers UPDATE RETURNING *', async () => {
      const r = await inferrer.infer(
        'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING *'
      );
      expect(r.params).toHaveLength(2);
      // Should return all columns from users table
      expect(r.columns.length).toBeGreaterThanOrEqual(7);
    });
  });

  describe('DELETE', () => {
    it('infers DELETE without RETURNING (no columns)', async () => {
      const r = await inferrer.infer('DELETE FROM users WHERE id = $1');
      expect(r.columns).toHaveLength(0);
      expect(r.params).toHaveLength(1);
      expect(r.params[0].tsType).toBe('string'); // uuid
    });

    it('infers DELETE with RETURNING', async () => {
      const r = await inferrer.infer(
        'DELETE FROM users WHERE id = $1 RETURNING id, email'
      );
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'email', tsType: 'string' });
    });

    it('infers DELETE with complex WHERE', async () => {
      const r = await inferrer.infer(`
        DELETE FROM posts
        WHERE author_id = $1 AND view_count < $2
        RETURNING id, title
      `);
      expect(r.params).toHaveLength(2);
      expect(r.params[0].tsType).toBe('string'); // uuid
      expect(r.params[1].tsType).toBe('string'); // bigint
    });
  });

  describe('INSERT ON CONFLICT (UPSERT)', () => {
    it('infers INSERT ON CONFLICT DO NOTHING', async () => {
      const r = await inferrer.infer(`
        INSERT INTO users (id, email, name)
        VALUES ($1, $2, $3)
        ON CONFLICT (email) DO NOTHING
        RETURNING id
      `);
      expect(r.params).toHaveLength(3);
      expect(r.columns).toHaveLength(1);
      expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });
    });

    it('infers INSERT ON CONFLICT DO UPDATE', async () => {
      const r = await inferrer.infer(`
        INSERT INTO users (id, email, name)
        VALUES ($1, $2, $3)
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
        RETURNING id, email, name
      `);
      expect(r.params).toHaveLength(3);
      expect(r.columns).toHaveLength(3);
      expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[2]).toMatchObject({ name: 'name', tsType: 'string' });
    });

    it('infers INSERT ON CONFLICT with WHERE clause', async () => {
      const r = await inferrer.infer(`
        INSERT INTO posts (author_id, title, body)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title
        WHERE posts.view_count < 100
        RETURNING id, title
      `);
      expect(r.params).toHaveLength(3);
      expect(r.columns).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/integration/mutations.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/mutations.test.ts
git commit -m "test: add mutation type inference tests (UPDATE, DELETE, INSERT ON CONFLICT)"
```

---

## Chunk 5: Expression Type Inference

### Task 10: Expression edge case tests

**Files:**
- Create: `tests/integration/expressions.test.ts`

- [ ] **Step 1: Write expression tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@ts-sqlx/core/dbInferrer.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('expression type inference', () => {
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

  describe('CASE expressions', () => {
    it('infers CASE with string branches', async () => {
      const r = await inferrer.infer(`
        SELECT CASE
          WHEN is_active THEN 'active'
          ELSE 'inactive'
        END AS status
        FROM users
      `);
      expect(r.columns[0]).toMatchObject({ name: 'status', tsType: 'string' });
    });

    it('infers CASE with numeric branches', async () => {
      const r = await inferrer.infer(`
        SELECT CASE
          WHEN view_count > 100 THEN 1
          WHEN view_count > 10 THEN 2
          ELSE 3
        END AS tier
        FROM posts
      `);
      expect(r.columns[0]).toMatchObject({ name: 'tier', tsType: 'number' });
    });

    it('infers CASE returning column value', async () => {
      const r = await inferrer.infer(`
        SELECT CASE
          WHEN is_active THEN age
          ELSE NULL
        END AS maybe_age
        FROM users
      `);
      expect(r.columns[0]).toMatchObject({ name: 'maybe_age', tsType: 'number' });
    });
  });

  describe('string operations', () => {
    it('infers string concatenation with ||', async () => {
      const r = await inferrer.infer(
        "SELECT name || ' <' || email || '>' AS display FROM users"
      );
      expect(r.columns[0]).toMatchObject({ name: 'display', tsType: 'string' });
    });

    it('infers CONCAT function', async () => {
      const r = await inferrer.infer(
        "SELECT CONCAT(name, ' ', email) AS display FROM users"
      );
      expect(r.columns[0]).toMatchObject({ name: 'display', tsType: 'string' });
    });

    it('infers UPPER/LOWER', async () => {
      const r = await inferrer.infer(
        'SELECT UPPER(email) AS upper_email, LOWER(name) AS lower_name FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'upper_email', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'lower_name', tsType: 'string' });
    });

    it('infers LENGTH returns integer', async () => {
      const r = await inferrer.infer(
        'SELECT LENGTH(email) AS len FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'len', tsType: 'number' });
    });

    it('infers SUBSTRING', async () => {
      const r = await inferrer.infer(
        'SELECT SUBSTRING(email FROM 1 FOR 5) AS prefix FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'prefix', tsType: 'string' });
    });
  });

  describe('math operations', () => {
    it('infers arithmetic on integers', async () => {
      const r = await inferrer.infer(
        'SELECT regular_int + 1 AS plus_one, regular_int * 2 AS doubled FROM type_showcase'
      );
      expect(r.columns[0]).toMatchObject({ name: 'plus_one', tsType: 'number' });
      expect(r.columns[1]).toMatchObject({ name: 'doubled', tsType: 'number' });
    });

    it('infers ROUND/FLOOR/CEIL', async () => {
      const r = await inferrer.infer(
        'SELECT ROUND(numeric_val) AS rounded, FLOOR(real_num) AS floored, CEIL(double_num) AS ceiled FROM type_showcase'
      );
      expect(r.columns[0]).toMatchObject({ name: 'rounded', tsType: 'string' }); // numeric
      expect(r.columns[1]).toMatchObject({ name: 'floored', tsType: 'number' });  // real
      expect(r.columns[2]).toMatchObject({ name: 'ceiled', tsType: 'number' });   // double
    });

    it('infers ABS', async () => {
      const r = await inferrer.infer(
        'SELECT ABS(regular_int) AS abs_val FROM type_showcase'
      );
      expect(r.columns[0]).toMatchObject({ name: 'abs_val', tsType: 'number' });
    });
  });

  describe('date/time functions', () => {
    it('infers EXTRACT returns numeric', async () => {
      const r = await inferrer.infer(
        'SELECT EXTRACT(YEAR FROM created_at) AS yr FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'yr', tsType: 'string' }); // numeric
    });

    it('infers DATE_TRUNC returns timestamp', async () => {
      const r = await inferrer.infer(
        "SELECT DATE_TRUNC('month', created_at) AS month_start FROM users"
      );
      expect(r.columns[0]).toMatchObject({ name: 'month_start', tsType: 'Date' });
    });

    it('infers AGE returns interval', async () => {
      const r = await inferrer.infer(
        'SELECT AGE(created_at) AS account_age FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'account_age', tsType: 'string' }); // interval
    });

    it('infers NOW()', async () => {
      const r = await inferrer.infer('SELECT NOW() AS current_time');
      expect(r.columns[0]).toMatchObject({ name: 'current_time', tsType: 'Date' });
    });
  });

  describe('boolean expressions', () => {
    it('infers comparison operators return boolean', async () => {
      const r = await inferrer.infer(
        'SELECT (age > 18) AS is_adult, (name IS NOT NULL) AS has_name FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'is_adult', tsType: 'boolean' });
      expect(r.columns[1]).toMatchObject({ name: 'has_name', tsType: 'boolean' });
    });

    it('infers EXISTS returns boolean', async () => {
      const r = await inferrer.infer(`
        SELECT u.email,
          EXISTS(SELECT 1 FROM posts p WHERE p.author_id = u.id) AS has_posts
        FROM users u
      `);
      expect(r.columns).toHaveLength(2);
      expect(r.columns[1]).toMatchObject({ name: 'has_posts', tsType: 'boolean' });
    });

    it('infers IN returns boolean', async () => {
      const r = await inferrer.infer(
        "SELECT email, (age IN (18, 21, 25)) AS is_special_age FROM users"
      );
      expect(r.columns[1]).toMatchObject({ name: 'is_special_age', tsType: 'boolean' });
    });
  });

  describe('subquery varieties', () => {
    it('infers scalar subquery in SELECT', async () => {
      const r = await inferrer.infer(`
        SELECT u.email,
          (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id) AS post_count
        FROM users u
      `);
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'post_count', tsType: 'string' }); // bigint
    });

    it('infers derived table (subquery in FROM)', async () => {
      const r = await inferrer.infer(`
        SELECT sq.email, sq.cnt
        FROM (
          SELECT u.email, COUNT(p.id) AS cnt
          FROM users u
          LEFT JOIN posts p ON p.author_id = u.id
          GROUP BY u.email
        ) sq
      `);
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'cnt', tsType: 'string' }); // bigint
    });

    it('infers subquery with IN', async () => {
      const r = await inferrer.infer(`
        SELECT id, email FROM users
        WHERE id IN (SELECT author_id FROM posts WHERE view_count > $1)
      `);
      expect(r.columns).toHaveLength(2);
      expect(r.params).toHaveLength(1);
      expect(r.params[0].tsType).toBe('string'); // bigint
    });
  });

  describe('type casting', () => {
    it('infers ::text cast', async () => {
      const r = await inferrer.infer('SELECT id::text AS id_text FROM posts');
      expect(r.columns[0]).toMatchObject({ name: 'id_text', tsType: 'string' });
    });

    it('infers CAST(x AS type)', async () => {
      const r = await inferrer.infer(
        'SELECT CAST(view_count AS INTEGER) AS vc FROM posts'
      );
      expect(r.columns[0]).toMatchObject({ name: 'vc', tsType: 'number' });
    });

    it('infers ::integer cast', async () => {
      const r = await inferrer.infer(
        "SELECT '42'::integer AS num"
      );
      expect(r.columns[0]).toMatchObject({ name: 'num', tsType: 'number' });
    });
  });

  describe('GREATEST / LEAST', () => {
    it('infers GREATEST with integers', async () => {
      const r = await inferrer.infer(
        'SELECT GREATEST(regular_int, small_int, 0) AS max_val FROM type_showcase'
      );
      expect(r.columns[0]).toMatchObject({ name: 'max_val', tsType: 'number' });
    });

    it('infers LEAST with timestamps', async () => {
      const r = await inferrer.infer(
        'SELECT LEAST(created_at, updated_at) AS earliest FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'earliest', tsType: 'Date' });
    });
  });

  describe('BETWEEN and LIKE', () => {
    it('infers query with BETWEEN parameter', async () => {
      const r = await inferrer.infer(
        'SELECT id, email FROM users WHERE age BETWEEN $1 AND $2'
      );
      expect(r.params).toHaveLength(2);
      expect(r.params[0].tsType).toBe('number'); // integer
      expect(r.params[1].tsType).toBe('number');
    });

    it('infers query with LIKE parameter', async () => {
      const r = await inferrer.infer(
        'SELECT id, email FROM users WHERE email LIKE $1'
      );
      expect(r.params).toHaveLength(1);
      expect(r.params[0].tsType).toBe('string');
    });

    it('infers query with ILIKE', async () => {
      const r = await inferrer.infer(
        'SELECT id, name FROM users WHERE name ILIKE $1'
      );
      expect(r.params).toHaveLength(1);
      expect(r.params[0].tsType).toBe('string');
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/integration/expressions.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/expressions.test.ts
git commit -m "test: add expression type inference tests (CASE, string ops, math, dates, subqueries)"
```

---

## Execution Notes

**Test run order:** Tasks are independent — each test file has its own PGLite instance with the shared schema. They can be implemented in any order or in parallel.

**PGLite vs PgAdapter:** Most tests use `PGLiteAdapter` since they only validate type mapping (not nullability). The one exception is `joinNullability.test.ts` which requires a real PostgreSQL connection via Docker.

**Expected failures:** Some tests may fail if PGLite doesn't support certain PostgreSQL features (e.g., recursive CTEs, FILTER clause, some JSON operators). If a test fails due to PGLite limitations:
1. Verify the query works in real PostgreSQL
2. Add a `.skip` with a comment explaining the PGLite limitation
3. Optionally create a PgAdapter-only version of the test

**What this does NOT cover (intentionally):** This plan focuses on type inference correctness via `DbInferrer`. It does not add new diagnostic fixture tests (`@expect` annotation tests) — those would be a separate effort to verify end-to-end diagnostics for these query patterns.
