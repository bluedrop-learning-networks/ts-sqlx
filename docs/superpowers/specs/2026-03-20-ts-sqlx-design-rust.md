# ts-sqlx Design Specification (Rust + tsgo)

A PostgreSQL SQL query and type checker for TypeScript, modeled on sqlx from the Rust ecosystem. Implemented in Rust with bundled tsgo for TypeScript type resolution.

## Overview

ts-sqlx provides compile-time SQL validation and type inference for TypeScript projects using pg-promise or node-postgres. It validates SQL syntax, infers query result and parameter types from a live database, and ensures declared TypeScript types match inferred types.

### Goals

- Validate SQL queries at edit-time and in CI
- Infer result and parameter types from the database
- Generate type annotations via code actions
- Support pg-promise and node-postgres idiomatically (no forced wrappers)
- Full TypeScript project resolution (imports, type aliases, interfaces)
- Single binary distribution (no Node.js dependency)

### Non-Goals (v1)

- Query builders (Knex, Kysely, Drizzle)
- Tagged template literals with interpolation
- Offline inference via PGLite (deferred to v2)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  ts-sqlx (Rust binary)                                              │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  LSP Server (tower-lsp)                                       │  │
│  │  - LSP protocol handling                                      │  │
│  │  - Document synchronization                                   │  │
│  │  - Diagnostics, code actions, hover                           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Core Analysis Engine                                         │  │
│  │                                                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌───────────────────────┐  │  │
│  │  │ Query       │  │ SQL Parser  │  │ DB Inferrer           │  │  │
│  │  │ Finder      │  │ (libpg_query│  │ (tokio-postgres)      │  │  │
│  │  │             │  │  native)    │  │                       │  │  │
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
│  │  Type Cache (rusqlite)                                        │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│                         │ JSON-RPC (stdin/stdout)                   │
│  ┌──────────────────────▼────────────────────────────────────────┐  │
│  │  tsgo --api (bundled subprocess)                              │  │
│  │  - TypeScript type resolution                                 │  │
│  │  - Project management, imports                                │  │
│  │  - Pinned version, binary compatible                          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌────────────────────────┐  ┌────────────────────────────────┐     │
│  │  LSP Binary            │  │  CLI Binary                    │     │
│  │  (ts-sqlx lsp)         │  │  (ts-sqlx check/generate)      │     │
│  └────────────────────────┘  └────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Rust core** — Single binary, no runtime dependencies, excellent async (tokio), mature LSP framework (tower-lsp).

2. **Bundled tsgo for TypeScript** — Ships pinned version of tsgo binary. Guarantees binary compatibility regardless of user's TypeScript version. No Node.js dependency.

3. **IPC to tsgo** — Communicates via JSON-RPC over stdin/stdout. Clean boundary, stable interface, language-agnostic protocol.

4. **Native libpg_query** — Rust bindings to the Postgres parser. Fast, accurate, no FFI overhead to Node.js.

5. **PREPARE for type inference** — Connects to a real Postgres database, uses PREPARE statements to infer parameter and result types without executing queries.

6. **Cache for CI** — SQLite cache (rusqlite) stores inferred types. Development populates cache against live DB; CI uses cached types.

### Why Bundled tsgo?

The user's editor may run any TypeScript language server (tsserver, tsgo, etc.). By bundling our own tsgo:

| Concern | Solution |
|---------|----------|
| User has different TS version | Doesn't matter — we bundle our own |
| tsgo API changes | We pin the version we ship |
| User doesn't have Node.js | tsgo is a static Go binary |
| Type resolution differs across versions | Deterministic — same bundled tsgo everywhere |
| CI needs different setup than dev | Same bundled binary in both |

## Project Structure

```
ts-sqlx/
├── crates/
│   ├── ts-sqlx-core/           # Core analysis library
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── query_finder.rs     # Find db.one(...) calls via tsgo
│   │   │   ├── sql_parser.rs       # libpg_query wrapper
│   │   │   ├── param_extractor.rs  # Extract $1, $<name> params
│   │   │   ├── db_inferrer.rs      # PREPARE queries
│   │   │   ├── type_comparator.rs  # Compare inferred vs declared
│   │   │   ├── diagnostics.rs      # Diagnostic types
│   │   │   ├── code_actions.rs     # Code action generation
│   │   │   └── cache.rs            # Type cache (rusqlite)
│   │   └── Cargo.toml
│   ├── ts-sqlx-tsgo/           # tsgo IPC client
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── client.rs           # JSON-RPC client
│   │   │   ├── protocol.rs         # Request/response types
│   │   │   └── embedded.rs         # Extract bundled tsgo binary
│   │   └── Cargo.toml
│   ├── ts-sqlx-lsp/            # LSP server binary
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   └── server.rs           # tower-lsp implementation
│   │   └── Cargo.toml
│   └── ts-sqlx-cli/            # CLI binary
│       ├── src/
│       │   ├── main.rs
│       │   └── commands/
│       │       ├── check.rs
│       │       └── generate.rs
│       └── Cargo.toml
├── bundled/
│   └── tsgo/                   # Bundled tsgo binaries per platform
│       ├── tsgo-darwin-arm64
│       ├── tsgo-darwin-x64
│       ├── tsgo-linux-x64
│       └── tsgo-windows-x64.exe
├── ts-sqlx.toml                # Example config
└── Cargo.toml                  # Workspace
```

## tsgo Integration

### IPC Protocol

Communication with tsgo via JSON-RPC over stdin/stdout:

```rust
// ts-sqlx-tsgo/src/client.rs

pub struct TsgoClient {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: AtomicU64,
}

impl TsgoClient {
    pub async fn spawn() -> Result<Self> {
        let tsgo_path = embedded::extract_tsgo()?;
        let child = Command::new(tsgo_path)
            .arg("--api")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()?;
        // ...
    }

    pub async fn get_type_at_location(
        &self,
        file: &Path,
        position: u32
    ) -> Result<ResolvedType> {
        self.request("getTypeAtLocation", json!({
            "file": file,
            "position": position
        })).await
    }

    pub async fn get_symbol_at_location(
        &self,
        file: &Path,
        position: u32
    ) -> Result<Symbol> {
        // Follow variable to definition, get string literal value
    }

    pub async fn sync_file(&self, file: &Path, content: &str) -> Result<()> {
        self.request("updateFile", json!({
            "file": file,
            "content": content
        })).await
    }
}
```

### Bundled Binary Extraction

```rust
// ts-sqlx-tsgo/src/embedded.rs

use include_bytes_aligned::include_bytes_aligned;

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
static TSGO_BINARY: &[u8] = include_bytes_aligned!(16, "../bundled/tsgo/tsgo-darwin-arm64");

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
static TSGO_BINARY: &[u8] = include_bytes_aligned!(16, "../bundled/tsgo/tsgo-linux-x64");

// ... other platforms

pub fn extract_tsgo() -> Result<PathBuf> {
    let cache_dir = dirs::cache_dir()?.join("ts-sqlx");
    let tsgo_path = cache_dir.join("tsgo");

    if !tsgo_path.exists() || needs_update(&tsgo_path)? {
        fs::create_dir_all(&cache_dir)?;
        fs::write(&tsgo_path, TSGO_BINARY)?;
        #[cfg(unix)]
        fs::set_permissions(&tsgo_path, Permissions::from_mode(0o755))?;
    }

    Ok(tsgo_path)
}
```

### Type Resolution Flow

```
1. LSP receives textDocument/didChange
2. Sync file content to tsgo via IPC
3. Query Finder asks tsgo for call expressions matching db.one(), etc.
4. For each query site:
   a. Get SQL string (resolve variable via tsgo if needed)
   b. Get declared type parameter (resolve via tsgo TypeChecker)
   c. Parse SQL with libpg_query
   d. Infer types from DB (or cache)
   e. Compare inferred vs declared
   f. Generate diagnostics
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

Full project resolution via tsgo:

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

db.one<User>(GET_USER, [id]);  // Both resolved via tsgo TypeChecker
```

tsgo handles:
- Import resolution across files
- Type alias expansion
- Interface property enumeration
- Generic type resolution
- Utility types (Pick, Omit, etc.)

## SQL Parsing

### Parser

Native Rust bindings to libpg_query via `pg_query` crate:

```rust
use pg_query::{parse, NodeRef};

pub fn parse_sql(sql: &str) -> Result<ParsedQuery, SqlParseError> {
    match parse(sql) {
        Ok(result) => {
            let stmt = extract_statement(&result)?;
            let params = extract_params(&result)?;
            Ok(ParsedQuery { stmt, params })
        }
        Err(e) => Err(SqlParseError {
            message: e.message,
            position: e.cursorpos,
        })
    }
}
```

### Parameter Extraction

Support both indexed and named parameters:

| Style | Example | Supported |
|-------|---------|-----------|
| Indexed | `$1`, `$2` | v1 |
| Named (pg-promise) | `$<name>`, `$(name)`, `${name}`, `$/name/` | v1 |
| Modifiers | `$<name:raw>`, `$<name:csv>`, `$<name:json>` | v1 |
| Tagged template | `` sql`...${expr}` `` | v1.1 |

Named parameters are normalized to `$N` before parsing:

```rust
pub trait ParamExtractor: Send + Sync {
    fn extract(&self, sql: &str) -> (String, Vec<ParamRef>);
}

pub struct PgPromiseExtractor;

impl ParamExtractor for PgPromiseExtractor {
    fn extract(&self, sql: &str) -> (String, Vec<ParamRef>) {
        // $<userId> → $1, $<name> → $2, etc.
        // Returns normalized SQL and parameter mapping
    }
}
```

## Type Inference

### Method

Connect to Postgres via tokio-postgres, use PREPARE to infer types:

```rust
pub struct LiveInferrer {
    pool: Pool<PostgresConnectionManager>,
}

impl TypeInferrer for LiveInferrer {
    async fn infer(&self, sql: &str) -> Result<QueryType> {
        let conn = self.pool.get().await?;

        // PREPARE and introspect
        let stmt = conn.prepare(sql).await?;

        let params: Vec<PgType> = stmt.params()
            .iter()
            .map(|t| t.into())
            .collect();

        let columns: Vec<ColumnType> = stmt.columns()
            .iter()
            .map(|c| ColumnType {
                name: c.name().to_string(),
                pg_type: c.type_().into(),
                nullable: infer_nullability(c),
            })
            .collect();

        Ok(QueryType { params, columns })
    }
}
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

### Fallback Chain

1. Check type cache (fast path)
2. If miss + DATABASE_URL set → infer from live DB, update cache
3. If miss + no DB → diagnostic "cannot infer, no database connection"

## Caching

### Incremental Index (in-memory)

```rust
pub struct IncrementalIndex {
    files: DashMap<PathBuf, FileState>,
}

pub struct FileState {
    content_hash: u64,
    queries: Vec<IndexedQuery>,
}
```

### Type Cache (persistent)

SQLite via rusqlite in `.ts-sqlx/cache.db`:

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

```typescript
// Before
const user = await db.oneOrNone("SELECT id, name FROM users WHERE id = $1", [id]);

// After (code action applied)
const user = await db.oneOrNone<{ id: number; name: string }>("SELECT ...", [id]);
```

## LSP Server

### tower-lsp Implementation

```rust
use tower_lsp::{LspService, Server, LanguageServer};

#[derive(Debug)]
struct TsSqlxServer {
    client: Client,
    tsgo: TsgoClient,
    index: IncrementalIndex,
    inferrer: Box<dyn TypeInferrer>,
    cache: TypeCache,
}

#[tower_lsp::async_trait]
impl LanguageServer for TsSqlxServer {
    async fn initialize(&self, _: InitializeParams) -> Result<InitializeResult> {
        Ok(InitializeResult {
            capabilities: ServerCapabilities {
                text_document_sync: Some(TextDocumentSyncCapability::Kind(
                    TextDocumentSyncKind::INCREMENTAL,
                )),
                code_action_provider: Some(CodeActionProviderCapability::Simple(true)),
                diagnostic_provider: Some(DiagnosticServerCapabilities::Options(
                    DiagnosticOptions::default(),
                )),
                ..Default::default()
            },
            ..Default::default()
        })
    }

    async fn did_change(&self, params: DidChangeTextDocumentParams) {
        let uri = params.text_document.uri;
        self.tsgo.sync_file(&uri, &content).await;
        self.analyze_and_publish_diagnostics(&uri).await;
    }

    async fn code_action(&self, params: CodeActionParams) -> Result<Option<CodeActionResponse>> {
        // Return "Generate type" action for untyped queries
    }
}

#[tokio::main]
async fn main() {
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();

    let (service, socket) = LspService::new(|client| TsSqlxServer::new(client));
    Server::new(stdin, stdout, socket).serve(service).await;
}
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

# Start LSP server (for editor integration)
ts-sqlx lsp
```

### Implementation with clap

```rust
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "ts-sqlx")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Check {
        #[arg(value_name = "FILES")]
        files: Vec<String>,
        #[arg(long)]
        staged: bool,
        #[arg(long)]
        changed: bool,
    },
    Generate {
        #[arg(value_name = "FILES")]
        files: Vec<String>,
        #[arg(long)]
        staged: bool,
    },
    Cache {
        #[command(subcommand)]
        command: CacheCommands,
    },
    Lsp,
}
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

## Build & Distribution

### Cross-Platform Builds

```yaml
# .github/workflows/release.yml
jobs:
  build:
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
            tsgo: tsgo-linux-x64
          - os: macos-latest
            target: aarch64-apple-darwin
            tsgo: tsgo-darwin-arm64
          - os: macos-latest
            target: x86_64-apple-darwin
            tsgo: tsgo-darwin-x64
          - os: windows-latest
            target: x86_64-pc-windows-msvc
            tsgo: tsgo-windows-x64.exe
    steps:
      - name: Download tsgo
        run: |
          curl -L -o bundled/tsgo/${{ matrix.tsgo }} \
            https://github.com/microsoft/typescript-go/releases/download/v$TSGO_VERSION/${{ matrix.tsgo }}
      - name: Build
        run: cargo build --release --target ${{ matrix.target }}
```

### Binary Size Estimate

| Component | Size (approx) |
|-----------|---------------|
| ts-sqlx (Rust) | ~10 MB |
| tsgo (bundled) | ~25 MB |
| **Total** | ~35 MB |

Acceptable for a development tool. Could compress tsgo and extract on first run to reduce download size.

## Future Work

### v1.1

- Tagged template literals with interpolation
- `@sql` annotation for variable hints (if needed)

### v2

- PGLite offline mode (WASM-based Postgres for offline inference)
- Query completions (table/column names)
- Refactoring support (rename column across queries)
- Consider tsgo API stabilization — may allow tighter integration
