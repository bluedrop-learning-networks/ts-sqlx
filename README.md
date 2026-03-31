# ts-sqlx

Compile-time SQL validation and type checking for TypeScript.

Validates your SQL queries against your actual database schema at build time — catching syntax errors, unknown tables and columns, parameter type mismatches, and incorrect result set types before your code runs. Generates correct type annotations for query results and parameters via LSP code actions. Ships as a CLI (`ts-sqlx check`) and a language server for editor integration.

Inspired by Rust's [sqlx](https://github.com/launchbadge/sqlx), but fundamentally different because TypeScript has no procedural macros — instead, ts-sqlx works by analyzing your TypeScript source, extracting SQL query strings, and comparing inferred types against your declared types.

## Supported libraries

- **node-postgres** (`pg`) — `pool.query()`, `client.query()`
- **pg-promise** — `db.one()`, `db.oneOrNone()`, `db.many()`, `db.manyOrNone()`, `db.any()`, `db.none()`, `db.result()`, `db.query()`

## Why

There's prior art in this space:

- **[pgtyped](https://github.com/adelsz/pgtyped)** — a mature, well-established tool that generates TypeScript types from SQL files. pgtyped works well, but the codegen-heavy approach wasn't for us — generated files add noise to diffs, and the separate query file format adds friction. ts-sqlx takes a different approach: check your queries inline where you already write them, no codegen step required.

- **[safeql](https://github.com/ts-safeql/safeql)** — most similar in scope to ts-sqlx. However, safeql is implemented as an ESLint plugin, and we've moved away from ESLint and rather not hold on to that dependency.

ts-sqlx checks your queries inline where you write them — no codegen files, no ESLint dependency, no special query syntax.

### PGLite: zero-setup SQL checking

Experimental, but also the main reason this project exists: getting database-aware SQL and type checking up and running with nothing more than `npm install`.

ts-sqlx can run your `schema.sql` against an embedded [PGLite](https://pglite.dev/) instance — a WebAssembly build of PostgreSQL — so you get full compile-time checking without starting a dev database. Point it at your schema file and go:

```toml
# ts-sqlx.toml
[database]
pglite = true
schema = "schema.sql"
```

PGLite mode is experimental. It doesn't support all PostgreSQL extensions, custom types from extensions (e.g. PostGIS), or certain features. The schema loader sanitizes `pg_dump` output on a best-effort basis — stripping extension management, ownership statements, and unsupported `SET` commands — and retries failed statements to handle forward references. This is usually good enough for checking your queries.

For full fidelity, connect to a real PostgreSQL instance instead.

## Quick start

Install:

```bash
npm install -D @ts-sqlx/cli @ts-sqlx/core
```

Create `ts-sqlx.toml` in your project root:

```toml
[database]
pglite = true
schema = "schema.sql"
```

Or connect to a real database:

```toml
[database]
url = "$DATABASE_URL"
```

Run the checker:

```bash
npx ts-sqlx check
```

### Example

Given this code:

```typescript
// No type annotation — ts-sqlx warns (TS007)
const user = await db.one(
  "SELECT id, email, name FROM users WHERE id = $1",
  [userId]
);
```

ts-sqlx produces:

```
src/queries.ts
  ⚠ TS007  Query returns results but has no type annotation  3:28

1 warning
```

The LSP code action generates the correct type:

```typescript
const user = await db.one<{ id: string; email: string; name: string | null }>(
  "SELECT id, email, name FROM users WHERE id = $1",
  [userId]
);
```

With the type annotation in place, ts-sqlx now validates it. If the schema changes or the type drifts, you get a TS010 error.

## Diagnostics

| Code | Severity | Description |
|------|----------|-------------|
| TS001 | error | SQL syntax error |
| TS002 | error | Unknown table (relation does not exist) |
| TS003 | error | Unknown column |
| TS004 | error | Parameter type mismatch (TypeScript type vs inferred SQL type) |
| TS005 | error | Wrong parameter count |
| TS006 | error | Missing parameter property in arguments object |
| TS007 | warning | Query returns results but has no type annotation |
| TS008 | info | Unable to analyze (dynamic/non-literal SQL string) |
| TS009 | warning | No database connection configured |
| TS010 | error | Declared result type does not match inferred columns |

### Examples

**TS004 — type mismatch:**

```typescript
// age is INTEGER, but we're passing a string
const users = await db.many<{ name: string }>(
  "SELECT name FROM users WHERE age > $1",
  ["not a number"]  // TS004: expected number, got string
);
```

**TS010 — declared type doesn't match:**

```typescript
interface User { userId: string; email: string; }

// Column is "id", not "userId"
const user = await db.one<User>(
  "SELECT id, email FROM users WHERE id = $1",  // TS010
  [id]
);
```

## Configuration

Full `ts-sqlx.toml` reference:

```toml
[database]
# Connect to a real PostgreSQL instance.
# Supports environment variable interpolation.
url = "$DATABASE_URL"

# Or use PGLite (in-memory, no external database).
# pglite takes precedence over url if both are set.
pglite = true
schema = "schema.sql"   # path to schema file, relative to this config

[paths]
include = ["**/*.ts"]
exclude = ["**/node_modules/**", "**/*.test.ts", "**/*.spec.ts"]

[diagnostics]
# Control severity for specific diagnostics: "error", "warning", "info", or "off"
untyped = "warning"            # TS007
unable_to_analyze = "info"     # TS008
no_connection = "warning"      # TS009

[types]
# Override default PostgreSQL → TypeScript type mappings.
numeric = "number"
jsonb = "Record<string, unknown>"

# Import a type from a module:
timestamptz = "dayjs#Dayjs"        # import { Dayjs } from "dayjs"
```

The config file is discovered by walking up from the current directory. If no config file is found, ts-sqlx falls back to the `DATABASE_URL` environment variable, or auto-detects PGLite mode if a `schema.sql` file exists.

## Database adapters

### PostgreSQL

Connect via a standard connection URL. ts-sqlx uses the wire protocol's PARSE + DESCRIBE sequence to infer parameter and column types without executing queries.

```toml
[database]
url = "postgres://user:pass@localhost:5432/mydb"
```

### PGLite (experimental)

Runs an embedded PostgreSQL instance in WebAssembly. Your `schema.sql` is loaded at startup.

```toml
[database]
pglite = true
schema = "schema.sql"
```

**Limitations:**

- No support for PostgreSQL extensions (PostGIS, pg_trgm, etc.)
- Extension-specific types and functions are stripped from the schema
- `pg_dump` output is sanitized: `SET` commands, `GRANT`/`REVOKE`, `ALTER ... OWNER TO`, and `CREATE EXTENSION` statements are removed
- Forward references in schemas are handled by a deferred retry pass, but complex circular dependencies may fail silently
- Some edge-case type behaviors may differ from a real PostgreSQL instance

For production-critical checking, use a real PostgreSQL connection.

## Nullability

ts-sqlx infers column nullability from `pg_attribute` — columns declared `NOT NULL` are typed as non-nullable, everything else is `T | null`.

For computed expressions, aggregates, and other cases where the database can't determine nullability, ts-sqlx defaults to nullable. You can override this with nullability hints in a leading block comment:

```typescript
const result = await db.one<{ total: number; user_count: number }>(
  /* @not-null total, user_count */
  `SELECT SUM(amount) as total, COUNT(*) as user_count
   FROM orders
   WHERE status = $1`,
  ["completed"]
);
```

### Hint syntax

```sql
/* @nullable col1, col2 */    -- force columns to be T | null
/* @not-null col1, col2 */    -- force columns to be T (non-null)
```

Hints are placed in a block comment immediately before the SQL string. Multiple hints can appear in the same comment. Column names are matched case-insensitively.

## Type mappings

Default PostgreSQL to TypeScript mappings:

| PostgreSQL | TypeScript |
|------------|------------|
| `int2`, `int4` | `number` |
| `int8` | `string` |
| `float4`, `float8` | `number` |
| `numeric`, `money` | `string` |
| `text`, `varchar`, `char` | `string` |
| `bool` | `boolean` |
| `date`, `timestamp`, `timestamptz` | `Date` |
| `time`, `timetz`, `interval` | `string` |
| `json`, `jsonb` | `unknown` |
| `bytea` | `Buffer` |
| `uuid` | `string` |
| `inet`, `cidr`, `macaddr` | `string` |
| `xml` | `string` |

Array columns (e.g. `TEXT[]`) are mapped to `T[]` (e.g. `string[]`).

Override any mapping in `ts-sqlx.toml`:

```toml
[types]
# Simple override
numeric = "number"
jsonb = "Record<string, unknown>"

# With import — use "module#TypeName" syntax
timestamptz = "dayjs#Dayjs"
# Generates: import { Dayjs } from "dayjs"
```

## CLI

```bash
npm install -D @ts-sqlx/cli @ts-sqlx/core
```

### Commands

```bash
ts-sqlx check                   # Check all files matching paths.include
ts-sqlx check "src/**/*.ts"     # Check specific glob pattern
ts-sqlx check --staged          # Check only git-staged files
ts-sqlx check --changed         # Check only changed files
ts-sqlx check --verbose         # Show source snippets with diagnostics

ts-sqlx cache status            # Show cache location and entry count
ts-sqlx cache clear             # Clear the type cache
```

Exit code is `1` if any errors are found, `0` otherwise.

## Editor integration

The language server provides real-time diagnostics and code actions (generate/update type annotations). It ships as `ts-sqlx-lsp` in the `@ts-sqlx/language-server` package.

```bash
npm install -D @ts-sqlx/language-server
```

### VS Code / Cursor

Install the extension from the `.vsix` file:

```bash
cd packages/vscode-extension
pnpm package             # produces ts-sqlx-0.1.0.vsix
code --install-extension ts-sqlx-0.1.0.vsix
```

### Neovim

Using [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig):

```lua
local lspconfig = require("lspconfig")
local configs = require("lspconfig.configs")

configs.ts_sqlx = {
  default_config = {
    cmd = { "npx", "ts-sqlx-lsp", "--stdio" },
    filetypes = { "typescript" },
    root_dir = lspconfig.util.root_pattern("ts-sqlx.toml", "tsconfig.json"),
  },
}

lspconfig.ts_sqlx.setup({})
```

### coc.nvim

In `coc-settings.json`:

```json
{
  "languageserver": {
    "ts-sqlx": {
      "command": "npx",
      "args": ["ts-sqlx-lsp", "--stdio"],
      "filetypes": ["typescript"],
      "rootPatterns": ["ts-sqlx.toml", "tsconfig.json"]
    }
  }
}
```

### Other editors

Any editor that supports LSP can use ts-sqlx. The server communicates over stdio:

```bash
npx ts-sqlx-lsp --stdio
```

## Roadmap

- Generate TypeScript types from database tables, functions, and custom types
- Schema REPL for interactive query exploration
- Test and run migrations against the embedded PGLite database
- Watch mode with auto-fix on the CLI

## License

MIT
