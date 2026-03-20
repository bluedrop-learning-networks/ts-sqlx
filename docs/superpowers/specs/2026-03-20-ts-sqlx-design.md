# ts-sqlx Design Specification

A PostgreSQL SQL query and type checker for TypeScript, modeled on sqlx from the Rust ecosystem.

## Overview

ts-sqlx provides compile-time SQL validation and type inference for TypeScript projects using pg-promise or node-postgres. It validates SQL syntax, infers query result and parameter types from a live database, and ensures declared TypeScript types match inferred types.

### Goals

- Validate SQL queries at edit-time and in CI
- Infer result and parameter types from the database
- Generate type annotations via code actions
- Support pg-promise and node-postgres idiomatically (no forced wrappers)
- Full TypeScript project resolution (imports, type aliases, interfaces)

### Non-Goals (v1)

- Query builders (Knex, Kysely, Drizzle)
- Tagged template literals with interpolation
- Offline inference via PGLite (deferred to v2)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ts-sqlx                                     │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  @volar/language-server                                       │  │
│  │  - LSP protocol                                               │  │
│  │  - Document sync                                              │  │
│  │  - Embedded TypeScript language service                       │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  ts-sqlx Service Plugin                                       │  │
│  │                                                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌───────────────────────┐  │  │
│  │  │ Query       │  │ SQL Parser  │  │ DB Inferrer           │  │  │
│  │  │ Finder      │  │ (libpg-     │  │ (pg + PREPARE)        │  │  │
│  │  │             │  │  query-node)│  │                       │  │  │
│  │  └─────────────┘  └─────────────┘  └───────────────────────┘  │  │
│  │                                                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌───────────────────────┐  │  │
│  │  │ Param       │  │ Type        │  │ Diagnostics +         │  │  │
│  │  │ Extractor   │  │ Comparator  │  │ Code Actions          │  │  │
│  │  │             │  │             │  │                       │  │  │
│  │  └─────────────┘  └─────────────┘  └───────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Type Cache (better-sqlite3)                                  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌────────────────────────┐  ┌────────────────────────────────┐     │
│  │  LSP Binary            │  │  CLI Binary (cmd-ts)           │     │
│  │  (editors)             │  │  check / generate              │     │
│  └────────────────────────┘  └────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **All TypeScript** — No Rust. Simpler toolchain, direct TypeScript type system access, npm distribution.

2. **Separate LSP with @volar** — Not a TypeScript plugin. Allows async DB operations, embeds TypeScript language service for full project type resolution.

3. **libpg-query-node for SQL parsing** — Uses the actual Postgres parser extracted as a library. Accurate syntax validation and error positions.

4. **PREPARE for type inference** — Connects to a real Postgres database, uses PREPARE statements to infer parameter and result types without executing queries.

5. **Cache for CI** — SQLite cache stores inferred types. Development populates cache against live DB; CI uses cached types.

## Project Structure

```
ts-sqlx/
├── packages/
│   ├── language-server/
│   │   ├── src/
│   │   │   ├── index.ts           # LSP entry point
│   │   │   ├── plugin.ts          # @volar service plugin
│   │   │   ├── queryFinder.ts     # Find db.one(...) calls
│   │   │   ├── sqlAnalyzer.ts     # libpg-query + validation
│   │   │   ├── paramExtractor.ts  # Extract $1, $<name> params
│   │   │   ├── dbInferrer.ts      # PREPARE queries
│   │   │   ├── typeComparator.ts  # Compare inferred vs declared
│   │   │   ├── codeActions.ts     # Generate type action
│   │   │   └── cache.ts           # Type cache
│   │   └── package.json
│   ├── cli/
│   │   ├── src/
│   │   │   ├── index.ts           # CLI entry
│   │   │   └── commands/
│   │   │       ├── check.ts       # ts-sqlx check
│   │   │       └── generate.ts    # ts-sqlx generate
│   │   └── package.json           # depends on cmd-ts
│   └── shared/                    # Shared types, utilities
│       └── ...
├── ts-sqlx.toml                   # Example config
├── package.json                   # pnpm workspace
└── tsconfig.json
```

## Query Detection

### Supported Patterns

```typescript
// pg-promise
db.one("SELECT ...", [params])
db.oneOrNone("SELECT ...", [params])
db.many("SELECT ...", [params])
db.manyOrNone("SELECT ...", [params])
db.any("SELECT ...", [params])
db.none("SELECT ...", [params])
db.result("SELECT ...", [params])
db.query("SELECT ...", [params])
db.multi("SELECT ...", [params])

// node-postgres
client.query("SELECT ...", [params])
pool.query("SELECT ...", [params])

// Inside task/tx blocks
await db.tx(async t => {
  t.one("SELECT ...", [params])
})
```

### Query Method → Return Type Mapping

| Method | Return Type |
|--------|-------------|
| `one` | `T` |
| `oneOrNone` | `T \| null` |
| `many` | `T[]` |
| `manyOrNone` | `T[]` |
| `any` | `T[]` |
| `none` | `null` |
| `result` | `IResult<T>` |
| `query` | `T[]` |
| `multi` | `T[][]` |
| node-postgres `query` | `QueryResult<T>` |

### Variable Resolution

The embedded TypeScript language service provides full project resolution:

```typescript
// queries.ts
export const GET_USER = "SELECT id, name FROM users WHERE id = $1";

// types.ts
export interface User {
  id: number;
  name: string;
}

// handler.ts
import { GET_USER } from './queries';
import type { User } from './types';

db.one<User>(GET_USER, [id]);  // Both resolved via TypeChecker
```

## SQL Parsing

### Parser

Use `libpg-query-node` — Node.js bindings to the Postgres parser extracted from Postgres source. Provides:

- Accurate SQL syntax validation
- Parse tree for analysis
- Error positions for diagnostics

### Parameter Extraction

Support both indexed and named parameters:

| Style | Example | Supported |
|-------|---------|-----------|
| Indexed | `$1`, `$2` | v1 |
| Named (pg-promise) | `$<name>`, `$(name)`, `${name}`, `$/name/` | v1 |
| Modifiers | `$<name:raw>`, `$<name:csv>`, `$<name:json>` | v1 |
| Tagged template | `` sql`...${expr}` `` | v1.1 |

Named parameters are normalized to `$N` before parsing with libpg_query:

```
Original:  SELECT * FROM users WHERE id = $<userId> AND name = $<name>
Normalized: SELECT * FROM users WHERE id = $1       AND name = $2
```

### Param Extractor Trait

```typescript
interface ParamExtractor {
  extract(sql: string): { normalized: string; params: ParamRef[] };
}

interface ParamRef {
  position: TextRange;
  kind: 'indexed' | 'named';
  number: number;           // assigned $N
  name?: string;            // for named params
  modifier?: 'raw' | 'csv' | 'json' | 'value';
}
```

## Type Inference

### Method

Connect to Postgres, use PREPARE to infer types without executing:

```sql
PREPARE _ts_sqlx_stmt AS SELECT id, name, created_at FROM users WHERE id = $1;
SELECT parameter_types FROM pg_prepared_statements WHERE name = '_ts_sqlx_stmt';
-- → {int4}
DEALLOCATE _ts_sqlx_stmt;
```

### Type Mapping

| Postgres | TypeScript |
|----------|------------|
| `int2`, `int4`, `int8` | `number` |
| `float4`, `float8`, `numeric` | `number` |
| `text`, `varchar`, `char` | `string` |
| `bool` | `boolean` |
| `date`, `timestamp`, `timestamptz` | `Date` |
| `json`, `jsonb` | `unknown` |
| `uuid` | `string` |
| `bytea` | `Buffer` |
| `T[]` | `T[]` |

Nullability derived from column constraints and query structure (e.g., LEFT JOIN makes columns nullable).

### Inferrer Interface

```typescript
interface TypeInferrer {
  infer(sql: string): Promise<QueryType>;
}

interface QueryType {
  params: PgType[];
  columns: ColumnType[];
}

interface ColumnType {
  name: string;
  pgType: PgType;
  tsType: string;
  nullable: boolean;
}
```

### Fallback Chain

1. Check type cache (fast path)
2. If miss + DATABASE_URL set → infer from live DB, update cache
3. If miss + no DB → diagnostic "cannot infer, no database connection"

## Caching

### Incremental Index (in-memory)

Track which files have which queries to avoid re-parsing unchanged files:

```typescript
interface IncrementalIndex {
  files: Map<string, FileState>;
}

interface FileState {
  contentHash: string;
  mtime: number;
  queries: IndexedQuery[];
}
```

### Type Cache (persistent)

SQLite database in `.ts-sqlx/cache.db`:

```sql
CREATE TABLE query_types (
    sql_hash     INTEGER PRIMARY KEY,
    sql_text     TEXT NOT NULL,
    params       TEXT NOT NULL,    -- JSON
    columns      TEXT NOT NULL,    -- JSON
    schema_hash  INTEGER NOT NULL,
    inferred_at  INTEGER NOT NULL
);

CREATE TABLE schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
```

### Cache Invalidation

| Trigger | Action |
|---------|--------|
| SQL text changes | New hash → cache miss → re-infer |
| Schema changes | schema_hash mismatch → invalidate all |
| Manual | `ts-sqlx cache clear` |

## Diagnostics

| Code | Severity | Description |
|------|----------|-------------|
| `TS001` | Error | SQL syntax error |
| `TS002` | Error | Unknown table |
| `TS003` | Error | Unknown column |
| `TS004` | Error | Type mismatch in expression |
| `TS005` | Error | Wrong parameter count |
| `TS006` | Error | Missing property in params object |
| `TS007` | Warning | Query has no type annotation |
| `TS008` | Info | Unable to analyze (dynamic SQL) |
| `TS009` | Warning | No database connection |
| `TS010` | Error | Declared type doesn't match inferred |

## Code Actions

### Generate Type Annotation

Triggered by `TS007` (untyped query):

```typescript
// Before
const user = await db.oneOrNone("SELECT id, name FROM users WHERE id = $1", [id]);

// After (code action applied)
const user = await db.oneOrNone<{ id: number; name: string }>("SELECT ...", [id]);
```

For node-postgres:

```typescript
// Before
const result = await client.query("SELECT id, name FROM users", []);

// After
const result = await client.query<{ id: number; name: string }>("SELECT ...", []);
```

## CLI

### Commands

```bash
# Check all queries for errors
ts-sqlx check

# Check specific files
ts-sqlx check "src/**/*.ts"

# Check only changed files
ts-sqlx check --staged    # staged only
ts-sqlx check --changed   # staged + unstaged

# Generate/update type annotations
ts-sqlx generate
ts-sqlx generate "src/**/*.ts" --staged

# Cache management
ts-sqlx cache status
ts-sqlx cache clear
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No errors |
| 1 | SQL/type errors found |
| 2 | Configuration error |

### lint-staged Integration

```json
{
  "*.ts": "ts-sqlx check"
}
```

## Configuration

### ts-sqlx.toml

```toml
[database]
url = "$DATABASE_URL"

[paths]
include = ["src/**/*.ts"]
exclude = ["**/*.test.ts", "**/*.spec.ts"]

[queries]
methods = [
  "one", "oneOrNone", "many", "manyOrNone", "any",
  "none", "result", "query", "multi"
]
objects = ["db", "client", "pool", "t", "tx", "task"]

[cache]
path = ".ts-sqlx/cache.db"

[diagnostics]
untyped = "warning"
unable_to_analyze = "info"
```

### Resolution Order

1. CLI flags
2. `ts-sqlx.toml` in current directory
3. `ts-sqlx.toml` in parent directories
4. Built-in defaults

### Zero Config

If no config file exists:
- Use `DATABASE_URL` env var
- Scan all `.ts` files
- Use default method/object patterns
- Cache in `.ts-sqlx/cache.db`

## Future Work

### v1.1

- Tagged template literals with interpolation
- `@sql` annotation for variable hints (if needed)

### v2

- PGLite offline mode (WASM-based Postgres for offline inference)
- Query completions (table/column names)
- Refactoring support (rename column across queries)
