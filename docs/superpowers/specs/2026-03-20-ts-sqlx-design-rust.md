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

Communication with tsgo via JSON-RPC over stdin/stdout. Use `--api --async` flags for JSON-RPC protocol (default is MessagePack):

```rust
// ts-sqlx-tsgo/src/client.rs

pub struct TsgoClient {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: AtomicU64,
}

impl TsgoClient {
    pub async fn spawn(project_root: &Path) -> Result<Self> {
        let tsgo_path = embedded::extract_tsgo()?;
        let child = Command::new(tsgo_path)
            .arg("--api")
            .arg("--async")  // Use JSON-RPC, not MessagePack
            .current_dir(project_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        // Initialize JSON-RPC client...
    }

    /// Get structural type at a position (e.g., type parameter)
    pub async fn get_type_at_position(
        &self,
        file: &Path,
        position: u32
    ) -> Result<ResolvedType> {
        // tsgo API method - pinned to bundled version
        // If API changes, update this when bumping BUNDLED_TSGO_VERSION
        self.request("getQuickInfoAtPosition", json!({
            "file": file.to_string_lossy(),
            "position": position
        })).await
    }

    /// Get definition of symbol at position (for variable resolution)
    pub async fn get_definition_at_position(
        &self,
        file: &Path,
        position: u32
    ) -> Result<Definition> {
        self.request("getDefinitionAtPosition", json!({
            "file": file.to_string_lossy(),
            "position": position
        })).await
    }

    /// Notify tsgo of file changes (virtual file system)
    pub async fn open_file(&self, file: &Path, content: &str) -> Result<()> {
        self.request("openFile", json!({
            "file": file.to_string_lossy(),
            "content": content
        })).await
    }

    pub async fn change_file(&self, file: &Path, content: &str) -> Result<()> {
        self.request("changeFile", json!({
            "file": file.to_string_lossy(),
            "content": content
        })).await
    }
}

/// Resolved TypeScript type in structural form
#[derive(Debug, Clone)]
pub struct ResolvedType {
    pub kind: TypeKind,
    pub properties: Vec<PropertyDef>,  // For object types
    pub element_type: Option<Box<ResolvedType>>,  // For arrays
}

#[derive(Debug, Clone)]
pub struct PropertyDef {
    pub name: String,
    pub type_name: String,  // "number", "string", etc.
    pub optional: bool,
}
```

**tsgo Version Pinning Strategy:**

The tsgo API is marked "not ready" — we handle this by:

1. **Pin exact version** — `BUNDLED_TSGO_VERSION` specifies the exact tsgo release
2. **Integration tests** — CI tests against the pinned version verify API compatibility
3. **Adapter layer** — `TsgoClient` methods abstract over raw API, allowing internal changes
4. **Upgrade process** — When bumping tsgo version:
   - Run integration tests
   - Update method names/signatures in `TsgoClient` if needed
   - Document breaking changes in CHANGELOG

This isolates the rest of the codebase from tsgo API churn.

### Bundled Binary Extraction

```rust
// ts-sqlx-tsgo/src/embedded.rs

use include_bytes_aligned::include_bytes_aligned;

// Bundled tsgo version - update this when upgrading
pub const BUNDLED_TSGO_VERSION: &str = "0.1.0";

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
static TSGO_BINARY: &[u8] = include_bytes_aligned!(16, "../bundled/tsgo/tsgo-darwin-arm64");

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
static TSGO_BINARY: &[u8] = include_bytes_aligned!(16, "../bundled/tsgo/tsgo-linux-x64");

// ... other platforms

pub fn extract_tsgo() -> Result<PathBuf> {
    let cache_dir = dirs::cache_dir()?.join("ts-sqlx");
    let version_file = cache_dir.join("tsgo.version");
    let tsgo_path = cache_dir.join(tsgo_binary_name());

    if needs_update(&tsgo_path, &version_file)? {
        fs::create_dir_all(&cache_dir)?;
        fs::write(&tsgo_path, TSGO_BINARY)?;
        fs::write(&version_file, BUNDLED_TSGO_VERSION)?;
        #[cfg(unix)]
        fs::set_permissions(&tsgo_path, Permissions::from_mode(0o755))?;
    }

    Ok(tsgo_path)
}

fn needs_update(tsgo_path: &Path, version_file: &Path) -> Result<bool> {
    if !tsgo_path.exists() {
        return Ok(true);
    }
    match fs::read_to_string(version_file) {
        Ok(version) => Ok(version.trim() != BUNDLED_TSGO_VERSION),
        Err(_) => Ok(true),  // No version file, needs update
    }
}

fn tsgo_binary_name() -> &'static str {
    #[cfg(windows)]
    { "tsgo.exe" }
    #[cfg(not(windows))]
    { "tsgo" }
}
```

### Query Finder Architecture

The Query Finder uses **tree-sitter for AST parsing** (fast, local) and **tsgo for type resolution** (full TypeChecker):

```rust
// ts-sqlx-core/src/query_finder.rs

use tree_sitter::{Parser, Query};

pub struct QueryFinder {
    parser: Parser,
    query: Query,  // Tree-sitter query for call expressions
    tsgo: Arc<TsgoClient>,
}

impl QueryFinder {
    pub async fn find_queries(&self, file: &Path, content: &str) -> Result<Vec<QuerySite>> {
        // 1. Parse with tree-sitter (fast, local)
        let tree = self.parser.parse(content, None)?;

        // 2. Find call expressions matching db.one(), client.query(), etc.
        let call_sites = self.find_call_expressions(&tree, content)?;

        // 3. For each call site, use tsgo to resolve types
        let mut queries = Vec::new();
        for site in call_sites {
            let query = self.resolve_query_site(file, content, site).await?;
            queries.push(query);
        }

        Ok(queries)
    }

    async fn resolve_query_site(
        &self,
        file: &Path,
        content: &str,
        site: CallSite
    ) -> Result<QuerySite> {
        // Get SQL string - may need to follow variable via tsgo
        let sql = match &site.sql_arg {
            SqlArg::Literal(s) => s.clone(),
            SqlArg::Identifier(pos) => {
                // Use tsgo to get definition and extract string value
                let def = self.tsgo.get_definition_at_position(file, *pos).await?;
                self.extract_string_from_definition(&def)?
            }
        };

        // Get declared type parameter via tsgo (if present)
        let declared_type = if let Some(type_pos) = site.type_param_position {
            Some(self.tsgo.get_type_at_position(file, type_pos).await?)
        } else {
            None
        };

        Ok(QuerySite {
            range: site.range,
            method: site.method,
            sql,
            declared_type,
            params_range: site.params_range,
        })
    }

    /// Extract string literal value from a variable definition
    fn extract_string_from_definition(&self, def: &Definition) -> Result<String> {
        // Definition contains the source file and range of the variable declaration
        // Read the initializer and extract string literal
        match &def.initializer {
            InitializerKind::StringLiteral(s) => Ok(s.clone()),
            InitializerKind::TemplateLiteral { .. } => {
                Err(QueryError::UnsupportedTemplateLiteral)
            }
            InitializerKind::Other => {
                Err(QueryError::CannotResolveVariable {
                    name: def.name.clone(),
                    reason: "initializer is not a string literal".to_string(),
                })
            }
        }
    }
}
```

### Type Resolution Flow

```
1. LSP receives textDocument/didChange
2. Update tree-sitter parse tree (incremental)
3. Notify tsgo of file change via IPC
4. Query Finder:
   a. tree-sitter finds call expressions (db.one, client.query, etc.)
   b. For variables: tsgo resolves definition → extract SQL string
   c. For type params: tsgo resolves to structural type
5. For each query site:
   a. Parse SQL with libpg_query
   b. Infer types from DB (or cache)
   c. Compare inferred vs declared (Type Comparator)
   d. Generate diagnostics
6. Publish diagnostics to LSP client
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

### Nullability Inference

Determining column nullability from PREPARE is non-trivial. tokio-postgres doesn't expose nullability directly. Strategies:

1. **Conservative default** — Assume all columns nullable unless proven otherwise
2. **pg_catalog lookup** — Query `pg_attribute.attnotnull` for base table columns
3. **Expression analysis** — `COALESCE`, `NOT NULL` constraints affect nullability

For v1, use conservative approach with pg_catalog enhancement:

```rust
async fn infer_nullability(
    conn: &Client,
    stmt: &Statement,
    col_idx: usize
) -> Result<bool> {
    // For simple column references, check pg_attribute
    // For expressions, default to nullable
    let col = &stmt.columns()[col_idx];

    // Try to resolve to base table column
    if let Some((table_oid, attnum)) = resolve_column_origin(stmt, col_idx) {
        let row = conn.query_one(
            "SELECT attnotnull FROM pg_attribute WHERE attrelid = $1 AND attnum = $2",
            &[&table_oid, &attnum]
        ).await?;
        return Ok(!row.get::<_, bool>(0));  // nullable = !attnotnull
    }

    // Expressions, aggregates, etc. — assume nullable
    Ok(true)
}
```

```rust
/// Resolve which base table column a result column originated from
/// Returns (table_oid, attribute_number) if resolvable
fn resolve_column_origin(
    conn: &Client,
    stmt: &Statement,
    col_idx: usize
) -> Option<(u32, i16)> {
    // tokio-postgres exposes column table OID and attribute number
    // via the underlying libpq PQftable / PQftablecol
    let col = &stmt.columns()[col_idx];

    // table_oid returns 0 if column is computed (expression, aggregate)
    let table_oid = col.table_oid()?;
    if table_oid == 0 {
        return None;
    }

    let attnum = col.table_column()?;
    Some((table_oid, attnum))
}
```

**Known limitations:**
- LEFT JOIN makes columns nullable even if source is NOT NULL (not detected in v1)
- COALESCE results are non-null (not detected in v1)
- May flag false positives; errs on the side of `| null`

### Fallback Chain

1. Check type cache (fast path)
2. If miss + DATABASE_URL set → infer from live DB, update cache
3. If miss + no DB → diagnostic "cannot infer, no database connection"

## Type Comparator

Compares inferred PostgreSQL types against declared TypeScript types.

### Structural Comparison

```rust
// ts-sqlx-core/src/type_comparator.rs

pub struct TypeComparator;

impl TypeComparator {
    /// Compare inferred (from DB) vs declared (from TypeScript)
    pub fn compare(
        &self,
        inferred: &QueryType,
        declared: &ResolvedType,
        method: QueryMethod
    ) -> CompareResult {
        // Wrap inferred type based on method (one vs many, etc.)
        let expected_ts = self.to_typescript_type(inferred, method);

        self.structural_compare(&expected_ts, declared)
    }

    /// Convert inferred PostgreSQL types to TypeScript type structure
    fn to_typescript_type(&self, inferred: &QueryType, method: QueryMethod) -> TsType {
        // Build row type from columns
        let row_props: Vec<TsProperty> = inferred.columns.iter().map(|col| {
            TsProperty {
                name: col.name.clone(),
                ts_type: self.pg_to_ts_type(&col.pg_type, col.nullable),
            }
        }).collect();

        let row_type = TsType::Object { properties: row_props };

        // Wrap based on query method
        match method {
            QueryMethod::One => row_type,
            QueryMethod::OneOrNone => TsType::Union(vec![row_type, TsType::Null]),
            QueryMethod::Many | QueryMethod::ManyOrNone |
            QueryMethod::Any | QueryMethod::Query => TsType::Array(Box::new(row_type)),
            QueryMethod::None => TsType::Null,
            QueryMethod::Result => TsType::Generic {
                name: "IResult".to_string(),
                args: vec![row_type],
            },
            QueryMethod::Multi => TsType::Array(Box::new(TsType::Array(Box::new(row_type)))),
            QueryMethod::NodePgQuery => TsType::Generic {
                name: "QueryResult".to_string(),
                args: vec![row_type],
            },
        }
    }

    /// Map PostgreSQL type to TypeScript type string
    fn pg_to_ts_type(&self, pg_type: &PgType, nullable: bool) -> String {
        let base = match pg_type {
            PgType::Int2 | PgType::Int4 | PgType::Int8 |
            PgType::Float4 | PgType::Float8 | PgType::Numeric => "number",
            PgType::Text | PgType::Varchar | PgType::Char | PgType::Uuid => "string",
            PgType::Bool => "boolean",
            PgType::Date | PgType::Timestamp | PgType::Timestamptz => "Date",
            PgType::Json | PgType::Jsonb => "unknown",
            PgType::Bytea => "Buffer",
            PgType::Array(inner) => {
                return format!("{}[]", self.pg_to_ts_type(inner, false));
            }
            PgType::Other(name) => name.as_str(),
        };

        if nullable {
            format!("{} | null", base)
        } else {
            base.to_string()
        }
    }

    fn structural_compare(
        &self,
        expected: &TsType,
        declared: &ResolvedType
    ) -> CompareResult {
        let mut mismatches = Vec::new();

        // Check each expected property exists in declared
        for prop in &expected.properties {
            match declared.properties.iter().find(|p| p.name == prop.name) {
                None => mismatches.push(Mismatch::MissingProperty(prop.name.clone())),
                Some(declared_prop) => {
                    if !self.types_compatible(&prop.ts_type, &declared_prop.type_name) {
                        mismatches.push(Mismatch::TypeMismatch {
                            property: prop.name.clone(),
                            expected: prop.ts_type.clone(),
                            actual: declared_prop.type_name.clone(),
                        });
                    }
                }
            }
        }

        // Check for extra properties in declared (warning, not error)
        for prop in &declared.properties {
            if !expected.properties.iter().any(|p| p.name == prop.name) {
                mismatches.push(Mismatch::ExtraProperty(prop.name.clone()));
            }
        }

        CompareResult { mismatches }
    }

    fn types_compatible(&self, pg_type: &str, ts_type: &str) -> bool {
        // Handle equivalences: "number" matches "number"
        // Handle nullability: "number | null" matches "number" with warning
        // Handle subtypes: "string" matches "string | null"
        match (pg_type, ts_type) {
            (a, b) if a == b => true,
            ("number", "number | null") => true,  // TS is more permissive
            ("string", "string | null") => true,
            // ... other rules
            _ => false,
        }
    }
}

#[derive(Debug)]
pub enum Mismatch {
    MissingProperty(String),
    ExtraProperty(String),  // Warning, not error
    TypeMismatch { property: String, expected: String, actual: String },
    NullabilityMismatch { property: String, expected_nullable: bool },
}
```

### Comparison Rules

| Inferred (DB) | Declared (TS) | Result |
|---------------|---------------|--------|
| `{ id: number }` | `{ id: number }` | Match |
| `{ id: number }` | `{ id: number; name: string }` | Error: extra property `name` |
| `{ id: number; name: string }` | `{ id: number }` | Error: missing property `name` |
| `{ id: number }` | `{ id: string }` | Error: type mismatch |
| `{ id: number \| null }` | `{ id: number }` | Warning: nullability |

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

### Schema Hash Computation

The `schema_hash` detects when the database schema changes, invalidating cached types:

```rust
pub async fn compute_schema_hash(conn: &Client) -> Result<u64> {
    // Hash relevant pg_catalog tables
    let rows = conn.query(
        r#"
        SELECT
            c.relname AS table_name,
            a.attname AS column_name,
            t.typname AS type_name,
            a.attnotnull AS not_null
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        JOIN pg_type t ON t.oid = a.atttypid
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY c.relname, a.attnum
        "#,
        &[]
    ).await?;

    let mut hasher = XxHash64::default();
    for row in rows {
        hasher.write(row.get::<_, &str>(0).as_bytes());
        hasher.write(row.get::<_, &str>(1).as_bytes());
        hasher.write(row.get::<_, &str>(2).as_bytes());
        hasher.write(&[row.get::<_, bool>(3) as u8]);
    }

    Ok(hasher.finish())
}
```

**Invalidation strategy:**
1. On LSP startup, compute current schema hash
2. Compare against stored `schema_meta.schema_hash`
3. If different, clear `query_types` table, update stored hash
4. CLI `check` also verifies schema hash before using cache

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

### Generate Type Annotation (TS007)

For untyped queries:

```typescript
// Before
const user = await db.oneOrNone("SELECT id, name FROM users WHERE id = $1", [id]);

// After (code action applied)
const user = await db.oneOrNone<{ id: number; name: string }>("SELECT ...", [id]);
```

### Fix Type Annotation (TS010)

For type mismatches:

```typescript
// Before (declared type doesn't match query)
const user = await db.oneOrNone<{ id: number; email: string }>(
  "SELECT id, name FROM users WHERE id = $1",
  [id]
);

// After (code action: "Update type to match query")
const user = await db.oneOrNone<{ id: number; name: string }>(
  "SELECT id, name FROM users WHERE id = $1",
  [id]
);
```

### Code Action Implementation

```rust
// ts-sqlx-core/src/code_actions.rs

pub fn generate_code_actions(
    query: &QuerySite,
    diagnostics: &[Diagnostic],
    inferred_type: &QueryType
) -> Vec<CodeAction> {
    let mut actions = Vec::new();

    for diag in diagnostics {
        match diag.code {
            DiagnosticCode::UntypedQuery => {
                actions.push(CodeAction {
                    title: "Generate type annotation".to_string(),
                    kind: CodeActionKind::QuickFix,
                    edit: generate_type_edit(query, inferred_type),
                    diagnostics: vec![diag.clone()],
                });
            }
            DiagnosticCode::TypeMismatch => {
                actions.push(CodeAction {
                    title: "Update type to match query".to_string(),
                    kind: CodeActionKind::QuickFix,
                    edit: replace_type_edit(query, inferred_type),
                    diagnostics: vec![diag.clone()],
                });
            }
            _ => {}
        }
    }

    actions
}
```

## Error Handling

### tsgo Process Errors

```rust
pub struct TsgoClient {
    child: Child,
    // ...
    restart_count: AtomicU32,
}

impl TsgoClient {
    const MAX_RESTARTS: u32 = 3;

    async fn request<T: DeserializeOwned>(&self, method: &str, params: Value) -> Result<T> {
        match self.send_request(method, params).await {
            Ok(response) => Ok(response),
            Err(TsgoError::ProcessDied) => {
                if self.restart_count.fetch_add(1, Ordering::SeqCst) < Self::MAX_RESTARTS {
                    self.restart().await?;
                    self.send_request(method, params).await
                } else {
                    Err(TsgoError::TooManyRestarts)
                }
            }
            Err(TsgoError::Timeout) => {
                // Log warning, return graceful degradation
                Err(TsgoError::Timeout)
            }
            Err(e) => Err(e),
        }
    }

    async fn restart(&self) -> Result<()> {
        // Kill existing process, spawn new one, re-sync open files
    }
}
```

### Database Connection Errors

```rust
pub struct LiveInferrer {
    pool: Pool<PostgresConnectionManager>,
    cache: TypeCache,
}

impl TypeInferrer for LiveInferrer {
    async fn infer(&self, sql: &str) -> Result<QueryType, InferError> {
        // Try cache first
        if let Some(cached) = self.cache.get(sql)? {
            return Ok(cached);
        }

        // Try live DB
        match self.pool.get().await {
            Ok(conn) => {
                let result = self.infer_from_db(&conn, sql).await?;
                self.cache.set(sql, &result)?;
                Ok(result)
            }
            Err(pool_err) => {
                // Connection failed - return degraded result
                Err(InferError::NoConnection {
                    reason: pool_err.to_string(),
                    suggestion: "Set DATABASE_URL or run with cached types".to_string(),
                })
            }
        }
    }
}
```

### SQLite Cache Errors

```rust
pub struct TypeCache {
    conn: Mutex<Connection>,
}

impl TypeCache {
    pub fn get(&self, sql: &str) -> Result<Option<QueryType>, CacheError> {
        let conn = self.conn.lock().map_err(|_| CacheError::LockPoisoned)?;

        match conn.query_row(/* ... */) {
            Ok(row) => /* deserialize */,
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => {
                // Log error, return None (cache miss, not failure)
                tracing::warn!("Cache read error: {}", e);
                Ok(None)
            }
        }
    }

    pub fn set(&self, sql: &str, types: &QueryType) -> Result<(), CacheError> {
        // Write errors are logged but don't fail the operation
        // Next request will just re-infer
        if let Err(e) = self.try_set(sql, types) {
            tracing::warn!("Cache write error: {}", e);
        }
        Ok(())
    }
}
```

### Graceful Degradation

| Error | Behavior |
|-------|----------|
| tsgo crashes | Restart up to 3 times, then disable TS type features |
| tsgo timeout | Skip type resolution for that query, emit TS008 diagnostic |
| DB connection failed | Use cached types, emit TS009 if cache miss |
| Cache corruption | Delete cache, re-infer on next request |
| Malformed tsgo response | Log, skip that query, continue with others |

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

- **pg-embed offline mode** — Embedded PostgreSQL via [pg-embed](https://crates.io/crates/pg-embed) crate for offline type inference without a running database
  - Downloads real Postgres binaries (~50MB, cached)
  - Full compatibility with production Postgres
  - Native Rust, tokio-based, no WASM runtime needed
  - Loads schema from `schema.sql` snapshot
- Query completions (table/column names)
- Refactoring support (rename column across queries)
- Consider tsgo API stabilization — may allow tighter integration
