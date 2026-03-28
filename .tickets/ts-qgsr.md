---
id: ts-qgsr
status: closed
deps: [ts-cffs]
links: []
created: 2026-03-28T14:48:17Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [core, cache]
---
# Task 17: Type Cache (SQLite)

Type Cache (SQLite) - SQLite-backed cache for inferred query types with get/set/clear/stats operations.

### Task 17: Type Cache (SQLite)

**Files:**
- Create: `packages/core/src/cache.ts`
- Create: `tests/integration/cache.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/cache.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TypeCache } from '@ts-sqlx/core/src/cache.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('TypeCache', () => {
  let cache: TypeCache;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `ts-sqlx-test-${Date.now()}.db`);
    cache = new TypeCache(dbPath);
  });

  afterEach(() => {
    cache.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('returns undefined for cache miss', () => {
    const result = cache.get('SELECT 1');
    expect(result).toBeUndefined();
  });

  it('stores and retrieves query types', () => {
    const queryType = {
      params: [{ index: 1, pgType: 'uuid', tsType: 'string', nullable: false }],
      columns: [{ name: 'id', pgType: 'uuid', tsType: 'string', nullable: false }],
    };
    cache.set('SELECT id FROM users WHERE id = $1', queryType);

    const result = cache.get('SELECT id FROM users WHERE id = $1');
    expect(result).toBeDefined();
    expect(result!.columns[0].name).toBe('id');
    expect(result!.params[0].tsType).toBe('string');
  });

  it('clears all entries', () => {
    cache.set('SELECT 1', { params: [], columns: [] });
    cache.clear();
    expect(cache.get('SELECT 1')).toBeUndefined();
  });

  it('returns cache stats', () => {
    cache.set('SELECT 1', { params: [], columns: [] });
    cache.set('SELECT 2', { params: [], columns: [] });
    const stats = cache.stats();
    expect(stats.entries).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/cache.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement type cache**

```typescript
// packages/core/src/cache.ts
import Database from 'better-sqlite3';
import type { InferredQueryType } from './types.js';
import * as crypto from 'crypto';

export class TypeCache {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS query_types (
        sql_hash TEXT PRIMARY KEY,
        sql_text TEXT NOT NULL,
        params TEXT NOT NULL,
        columns TEXT NOT NULL,
        schema_hash TEXT NOT NULL DEFAULT '',
        inferred_at INTEGER NOT NULL
      );
    `);
  }

  get(sql: string): InferredQueryType | undefined {
    const hash = this.hash(sql);
    const row = this.db
      .prepare('SELECT params, columns FROM query_types WHERE sql_hash = ?')
      .get(hash) as { params: string; columns: string } | undefined;

    if (!row) return undefined;

    return {
      params: JSON.parse(row.params),
      columns: JSON.parse(row.columns),
    };
  }

  set(sql: string, types: InferredQueryType): void {
    const hash = this.hash(sql);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO query_types (sql_hash, sql_text, params, columns, inferred_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        hash,
        sql,
        JSON.stringify(types.params),
        JSON.stringify(types.columns),
        Date.now(),
      );
  }

  clear(): void {
    this.db.exec('DELETE FROM query_types');
  }

  stats(): { entries: number } {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM query_types')
      .get() as { count: number };
    return { entries: row.count };
  }

  close(): void {
    this.db.close();
  }

  private hash(sql: string): string {
    return crypto.createHash('sha256').update(sql).digest('hex');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/cache.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cache.ts tests/integration/cache.test.ts
git commit -m "feat: add SQLite type cache with get/set/clear/stats"
```

## Design

Chunk 5: Cache + Language Server + CLI. Uses better-sqlite3 for persistent type cache in .ts-sqlx/cache.db.

## Acceptance Criteria

TypeCache get/set/clear/stats work with SQLite; SHA-256 hash keys; WAL journal mode; tests pass with temp DB; commit created

