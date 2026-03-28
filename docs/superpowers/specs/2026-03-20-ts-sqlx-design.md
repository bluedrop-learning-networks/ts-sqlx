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

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ts-sqlx                                     │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  vscode-languageserver                                        │  │
│  │  - LSP protocol (stdio/IPC)                                   │  │
│  │  - Document sync                                              │  │
│  │  - Diagnostics, code actions, hover                           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  TypeScript Adapter (ts-morph)                                │  │
│  │  - Project/file management                                    │  │
│  │  - Type resolution and checking                               │  │
│  │  - Import following                                           │  │
│  │  - Pluggable: can swap for TSGo adapter in future             │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Database Adapter                                             │  │
│  │  - PgAdapter: connects to real Postgres via pg                │  │
│  │  - PGLiteAdapter: in-process WASM Postgres (testing/offline)  │  │
│  │  - Common interface for PREPARE-based type inference          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  ts-sqlx Core                                                 │  │
│  │                                                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌───────────────────────┐  │  │
│  │  │ Query       │  │ SQL Parser  │  │ DB Inferrer           │  │  │
│  │  │ Detector    │  │ (libpg-     │  │ (via DB Adapter)      │  │  │
│  │  │ (type-based)│  │  query-node)│  │                       │  │  │
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

2. **Separate LSP with vscode-languageserver** — Not a TypeScript plugin. All LSP request handlers are async, enabling non-blocking database queries, file I/O, and cache operations. Standard LSP implementation used by most language servers.

3. **ts-morph for TypeScript analysis** — Wraps TypeScript compiler API with cleaner interface. Handles type resolution, import following, and incremental updates. Pluggable adapter pattern allows future swap to TSGo.

4. **Type-based query detection** — Instead of matching object/method names, check if the receiver type is assignable to `IDatabase<T>` (pg-promise) or `Pool`/`Client` (node-postgres). Handles aliased imports and custom wrappers.

5. **libpg-query for SQL parsing** — Uses the actual Postgres parser extracted as a library. Accurate syntax validation.

6. **PREPARE for type inference** — Uses PREPARE statements to infer parameter and result types without executing queries. Works with both real Postgres and PGLite.

7. **PGLite for testing and offline mode** — Embeds a WASM-based Postgres instance. Enables zero-dependency integration tests and offline development. Tests run against PGLite with fixture schemas.

8. **Database adapter pattern** — Abstracts database connection behind `DatabaseAdapter` interface. `PgAdapter` for real Postgres, `PGLiteAdapter` for embedded. Same PREPARE-based inference logic works with both.

9. **Cache for CI** — SQLite cache stores inferred types. Development populates cache against live DB or PGLite; CI can use cached types or spin up PGLite.

## Project Structure

```
ts-sqlx/
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── index.ts              # Core exports
│   │   │   ├── adapters/
│   │   │   │   ├── typescript/
│   │   │   │   │   ├── types.ts      # TypeScriptAdapter interface
│   │   │   │   │   └── tsMorphAdapter.ts
│   │   │   │   └── database/
│   │   │   │       ├── types.ts      # DatabaseAdapter interface
│   │   │   │       ├── pgAdapter.ts  # Real Postgres (pg)
│   │   │   │       └── pgliteAdapter.ts # PGLite (WASM)
│   │   │   ├── queryDetector.ts      # Type-based query detection
│   │   │   ├── sqlAnalyzer.ts        # libpg-query + validation
│   │   │   ├── paramExtractor.ts     # Extract $1, $<name> params
│   │   │   ├── dbInferrer.ts         # PREPARE queries (uses DatabaseAdapter)
│   │   │   ├── typeComparator.ts     # Compare inferred vs declared
│   │   │   ├── diagnostics.ts        # Diagnostic generation
│   │   │   └── cache.ts              # Type cache
│   │   └── package.json
│   ├── language-server/
│   │   ├── src/
│   │   │   ├── index.ts              # LSP entry point
│   │   │   ├── server.ts             # vscode-languageserver setup
│   │   │   └── codeActions.ts        # Generate type action
│   │   └── package.json
│   ├── cli/
│   │   ├── src/
│   │   │   ├── index.ts              # CLI entry
│   │   │   └── commands/
│   │   │       ├── check.ts          # ts-sqlx check
│   │   │       └── generate.ts       # ts-sqlx generate
│   │   └── package.json              # depends on cmd-ts
│   └── test-utils/
│       ├── src/
│       │   ├── index.ts              # Test helper exports
│       │   ├── pgliteFixture.ts      # PGLite test setup
│       │   └── fixtureRunner.ts      # Run @expect annotations
│       └── package.json
├── tests/
│   ├── fixtures/
│   │   ├── schema.sql                # Test database schema
│   │   ├── diagnostics/              # Diagnostic test cases
│   │   ├── return-types/             # Type inference tests
│   │   ├── pgp-params/               # Parameter syntax tests
│   │   └── type-resolution/          # TypeScript type tests
│   └── integration/
│       └── ...
├── ts-sqlx.toml                      # Example config
├── package.json                      # pnpm workspace
└── tsconfig.json
```

## TypeScript Adapter

### Interface

The adapter abstracts TypeScript analysis, allowing future implementations (TSGo, etc.):

```typescript
interface TypeScriptAdapter {
  // Project management
  loadProject(tsConfigPath: string): void;
  updateFile(filePath: string, content: string): void;
  getProjectFiles(): string[];

  // Type resolution
  getTypeAtPosition(filePath: string, position: number): TSType | undefined;
  resolveSymbol(filePath: string, position: number): ResolvedSymbol | undefined;

  // For query detection - check receiver type
  getCallExpression(filePath: string, position: number): CallExpressionInfo | undefined;

  // For cross-file resolution
  followImport(filePath: string, importName: string): ResolvedImport | undefined;

  // Type checking
  isAssignableTo(source: TSType, target: TSType): boolean;
  getTypeProperties(type: TSType): PropertyInfo[];
}

interface CallExpressionInfo {
  receiverType: TSType;
  methodName: string;
  typeArguments: TSType[];
  arguments: ArgumentInfo[];
}

interface ResolvedSymbol {
  name: string;
  filePath: string;
  position: number;
  type: TSType;
}

interface ResolvedImport {
  filePath: string;
  exportName: string;
  type: TSType;
}
```

### ts-morph Implementation

```typescript
import { Project, Node, SyntaxKind, Type } from 'ts-morph';

class TsMorphAdapter implements TypeScriptAdapter {
  private project: Project;

  loadProject(tsConfigPath: string): void {
    this.project = new Project({ tsConfigFilePath: tsConfigPath });
  }

  updateFile(filePath: string, content: string): void {
    const sourceFile = this.project.getSourceFile(filePath);
    if (sourceFile) {
      sourceFile.replaceWithText(content);
    } else {
      this.project.createSourceFile(filePath, content);
    }
  }

  getCallExpression(filePath: string, position: number): CallExpressionInfo | undefined {
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return undefined;

    const node = sourceFile.getDescendantAtPos(position);
    const callExpr = node?.getFirstAncestorByKind(SyntaxKind.CallExpression);
    if (!callExpr) return undefined;

    const expr = callExpr.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return undefined;

    return {
      receiverType: expr.getExpression().getType(),
      methodName: expr.getName(),
      typeArguments: callExpr.getTypeArguments().map(t => t.getType()),
      arguments: callExpr.getArguments().map(arg => ({
        position: arg.getStart(),
        type: arg.getType(),
        text: arg.getText(),
      })),
    };
  }

  // ... other methods
}
```

## Database Adapter

### Interface

The database adapter abstracts Postgres connections, allowing both real Postgres and PGLite:

```typescript
interface DatabaseAdapter {
  // Connection management
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Schema setup (for PGLite)
  executeSchema(sql: string): Promise<void>;

  // Type inference (implementation differs: PgAdapter uses PREPARE, PGLiteAdapter uses describeQuery)
  describeQuery(sql: string): Promise<QueryTypeInfo>;

  // Schema introspection
  getEnumValues(typeName: string): Promise<string[]>;
  getCompositeFields(typeName: string): Promise<CompositeField[]>;
}

interface QueryTypeInfo {
  params: PgTypeInfo[];
  columns: ColumnInfo[];
}

interface PgTypeInfo {
  oid: number;
  name: string;        // e.g., "int4", "text", "uuid"
  isArray: boolean;
}

interface ColumnInfo {
  name: string;
  type: PgTypeInfo;
  nullable: boolean;
}

interface CompositeField {
  name: string;
  type: PgTypeInfo;
}
```

### PgAdapter (Real Postgres)

PgAdapter uses PREPARE statements internally to get type information:

```typescript
import { Pool } from 'pg';

class PgAdapter implements DatabaseAdapter {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async connect(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async describeQuery(sql: string): Promise<QueryTypeInfo> {
    const stmtName = `_ts_sqlx_${Date.now()}`;
    try {
      // PREPARE the statement
      await this.pool.query(`PREPARE ${stmtName} AS ${sql}`);

      // Get parameter types
      const paramsResult = await this.pool.query(
        `SELECT parameter_types FROM pg_prepared_statements WHERE name = $1`,
        [stmtName]
      );

      // Get result column types (requires parsing the statement)
      // Note: pg_prepared_statements doesn't give us column info directly
      // We need to use a different approach for columns
      const columnsResult = await this.pool.query(
        `SELECT * FROM (${sql}) AS _ts_sqlx_subq LIMIT 0`
      );
      // columnsResult.fields contains column metadata

      // Look up nullability from pg_attribute using tableID/columnID from field metadata
      const nullabilityMap = new Map<string, boolean>();
      for (const f of columnsResult.fields) {
        if (f.tableID && f.columnID) {
          const nullResult = await this.pool.query(
            `SELECT NOT attnotnull AS nullable FROM pg_attribute WHERE attrelid = $1 AND attnum = $2`,
            [f.tableID, f.columnID]
          );
          nullabilityMap.set(f.name, nullResult.rows[0]?.nullable ?? true);
        }
      }

      return {
        params: parseParamTypes(paramsResult.rows[0]?.parameter_types),
        columns: columnsResult.fields.map(f => ({
          name: f.name,
          type: { oid: f.dataTypeID, name: oidToTypeName(f.dataTypeID), isArray: false },
          nullable: nullabilityMap.get(f.name) ?? true,  // Default to nullable for expressions
        })),
      };
    } finally {
      await this.pool.query(`DEALLOCATE ${stmtName}`);
    }
  }

  // ... other methods
}
```

### PGLiteAdapter (Embedded WASM Postgres)

PGLite provides a `describeQuery()` method that returns type information without needing PREPARE statements:

```typescript
import { PGlite } from '@electric-sql/pglite';

class PGLiteAdapter implements DatabaseAdapter {
  private db: PGlite;

  static async create(): Promise<PGLiteAdapter> {
    const adapter = new PGLiteAdapter();
    adapter.db = await PGlite.create();  // In-memory by default
    return adapter;
  }

  private constructor() {}

  async connect(): Promise<void> {
    // Already connected via create()
  }

  async executeSchema(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  // PGLite uses its native describeQuery() method
  async describeQuery(sql: string): Promise<QueryTypeInfo> {
    const result = await this.db.describeQuery(sql);
    // result.queryParams: [{ dataTypeID: 25, serializer: Function }, ...]
    // result.resultFields: [{ name: "id", dataTypeID: 23, parser: Function }, ...]
    // Note: PGLite's describeQuery doesn't expose tableOID/columnNumber,
    // so we cannot look up nullability from pg_attribute
    return {
      params: result.queryParams.map((p, i) => ({
        oid: p.dataTypeID,
        name: oidToTypeName(p.dataTypeID),
        isArray: isArrayOid(p.dataTypeID),
      })),
      columns: result.resultFields.map(f => ({
        name: f.name,
        type: {
          oid: f.dataTypeID,
          name: oidToTypeName(f.dataTypeID),
          isArray: isArrayOid(f.dataTypeID),
        },
        nullable: true,  // PGLite limitation: always assume nullable
      })),
    };
  }

  // ... other methods
}
```

### Adapter Selection

```typescript
function createDatabaseAdapter(config: Config): DatabaseAdapter {
  if (config.database.pglite) {
    // Use PGLite with schema file
    const adapter = new PGLiteAdapter();
    return adapter;
  } else if (config.database.url) {
    // Use real Postgres
    return new PgAdapter(config.database.url);
  } else {
    throw new Error('No database configured');
  }
}
```

## Query Detection

### Type-Based Detection

Instead of matching object names (`db`, `client`, `pool`), detect queries by checking if the receiver type matches known database interfaces:

```typescript
interface QueryDetector {
  detectQuery(
    adapter: TypeScriptAdapter,
    filePath: string,
    position: number
  ): QueryCallInfo | undefined;
}

interface QueryCallInfo {
  library: 'pg-promise' | 'node-postgres';
  method: QueryMethod;
  sqlArgIndex: number;
  paramsArgIndex: number | undefined;
  declaredResultType: TSType | undefined;
  position: TextRange;
}

type QueryMethod =
  | 'one' | 'oneOrNone' | 'many' | 'manyOrNone' | 'any'
  | 'none' | 'result' | 'query' | 'multi';
```

### Detection Logic

```typescript
function detectQuery(adapter: TypeScriptAdapter, filePath: string, position: number): QueryCallInfo | undefined {
  const call = adapter.getCallExpression(filePath, position);
  if (!call) return undefined;

  // Check pg-promise: IDatabase, ITask, IBaseProtocol
  if (isPgPromiseType(call.receiverType)) {
    const method = call.methodName as QueryMethod;
    if (QUERY_METHODS.includes(method)) {
      return {
        library: 'pg-promise',
        method,
        sqlArgIndex: 0,
        paramsArgIndex: call.arguments.length > 1 ? 1 : undefined,
        declaredResultType: call.typeArguments[0],
        position: call.position,
      };
    }
  }

  // Check node-postgres: Pool, PoolClient, Client
  if (isNodePostgresType(call.receiverType)) {
    if (call.methodName === 'query') {
      return {
        library: 'node-postgres',
        method: 'query',
        sqlArgIndex: 0,
        paramsArgIndex: call.arguments.length > 1 ? 1 : undefined,
        declaredResultType: call.typeArguments[0],
        position: call.position,
      };
    }
  }

  return undefined;
}

function isPgPromiseType(type: TSType): boolean {
  // Check if type has IDatabase, ITask, or IBaseProtocol in its hierarchy
  const typeText = type.getText();
  return /\b(IDatabase|ITask|IBaseProtocol)\b/.test(typeText) ||
         type.getSymbol()?.getDeclarations()?.some(d =>
           d.getSourceFile().getFilePath().includes('pg-promise')
         ) ?? false;
}

function isNodePostgresType(type: TSType): boolean {
  const typeText = type.getText();
  return /\b(Pool|PoolClient|Client)\b/.test(typeText) ||
         type.getSymbol()?.getDeclarations()?.some(d =>
           d.getSourceFile().getFilePath().includes('pg')
         ) ?? false;
}
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

ts-morph provides full project resolution for SQL strings defined elsewhere:

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

db.one<User>(GET_USER, [id]);  // Both resolved via ts-morph
```

Resolution follows imports, resolves type aliases, and handles:
- Direct string literals
- `const` variable references
- Template literals (without interpolation)
- Re-exports

## SQL Parsing

### Parser

Use `libpg-query` (npm package) — Node.js bindings to the actual PostgreSQL parser extracted from Postgres source. Provides:

- Accurate SQL syntax validation (same parser as Postgres itself)
- Parse tree for analysis
- Synchronous (`parseQuerySync`) and async (`parseQuery`) APIs

Note: Error messages from libpg-query include the error text but may not include precise cursor positions in all cases. For user-friendly error positioning, we attempt to map errors back to the original SQL string by matching error context. Fallback: if position cannot be determined, highlight the entire SQL string literal.

### Parameter Extraction

Support both indexed and named parameters with all pg-promise syntax variants:

#### Bracket Styles

| Style | Example | Description |
|-------|---------|-------------|
| `${}` | `${name}` | Curly braces |
| `$()` | `$(name)` | Parentheses |
| `$<>` | `$<name>` | Angle brackets |
| `$[]` | `$[name]` | Square brackets |
| `$//` | `$/name/` | Slashes |

All five styles can be mixed in the same query.

#### Modifiers

| Modifier | Shorthand | Description |
|----------|-----------|-------------|
| `:raw` | `^` | Raw text injection (unescaped) |
| `:value` | `#` | Escaped value without quotes |
| `:name` | `~` | SQL identifier with quotes |
| `:alias` | — | Less strict identifier |
| `:json` | — | JSON formatting |
| `:csv` | — | Comma-separated values |
| `:list` | — | Comma-separated (alias for csv) |

Examples:
```sql
-- Modifiers with any bracket style
SELECT * FROM ${table:raw} WHERE ${column:name} = ${value}
SELECT * FROM $<table^> WHERE $<column~> = $<value>
INSERT INTO users (data) VALUES (${payload:json})
SELECT * FROM users WHERE id IN (${ids:csv})

-- Indexed parameters with modifiers
SELECT * FROM $1:raw WHERE $2:name = $3
SELECT * FROM $1^ WHERE $2~ = $3
```

#### Nested Properties

```sql
-- Access nested object properties
SELECT * FROM users WHERE name = ${profile.name}
SELECT * FROM users WHERE status = ${filters.status}

-- Deep nesting
SELECT * FROM users WHERE city = ${profile.address.city}
```

#### Special Syntax

```sql
-- This keyword (references the entire params object)
INSERT INTO logs (data) VALUES (${this:json})

-- Mixed indexed and named (not recommended but supported)
SELECT * FROM users WHERE id = $1 AND name = ${name}
```

Named parameters are normalized to `$N` before parsing with libpg_query:

```
Original:  SELECT * FROM users WHERE id = $<userId> AND name = $<name>
Normalized: SELECT * FROM users WHERE id = $1       AND name = $2
```

### Param Extractor Interface

```typescript
interface ParamExtractor {
  extract(sql: string): ExtractedParams;
}

interface ExtractedParams {
  normalized: string;          // SQL with $N placeholders
  params: ParamRef[];
  errors: ParamError[];        // Syntax errors in param syntax
}

interface ParamRef {
  position: TextRange;         // Position in original SQL
  kind: 'indexed' | 'named';
  number: number;              // Assigned $N
  name?: string;               // For named params (e.g., "userId")
  path?: string[];             // For nested params (e.g., ["profile", "name"])
  modifier?: ParamModifier;
  shorthand?: '^' | '#' | '~'; // If shorthand was used
}

type ParamModifier = 'raw' | 'value' | 'name' | 'alias' | 'json' | 'csv' | 'list';

interface ParamError {
  position: TextRange;
  message: string;             // e.g., "Unclosed bracket", "Empty parameter name"
}
```

## Type Inference

### Method

Type inference varies by adapter:

**PGLite**: Uses `describeQuery()` which returns parameter and result types directly via the PostgreSQL wire protocol's Parse/Describe messages.

**Real Postgres (pg)**: Uses PREPARE statements to infer types:

```sql
-- Prepare the statement to get parameter types
PREPARE _ts_sqlx_12345 AS SELECT id, name FROM users WHERE id = $1;
SELECT parameter_types FROM pg_prepared_statements WHERE name = '_ts_sqlx_12345';
-- → {uuid}

-- Get result column types by executing with LIMIT 0
SELECT * FROM (SELECT id, name FROM users WHERE id = $1) AS _q LIMIT 0;
-- Result fields contain column metadata (name, dataTypeID)

DEALLOCATE _ts_sqlx_12345;
```

Both adapters expose the same `describeQuery(sql): Promise<QueryTypeInfo>` interface.

### Type Mapping

| Postgres | TypeScript | Notes |
|----------|------------|-------|
| `int2`, `int4` | `number` | Safe integer range |
| `int8` | `string` | Exceeds JS number precision |
| `float4`, `float8` | `number` | |
| `numeric`, `decimal` | `string` | Precision preservation |
| `text`, `varchar`, `char` | `string` | |
| `bool` | `boolean` | |
| `date`, `timestamp`, `timestamptz` | `Date` | |
| `time`, `timetz` | `string` | No JS time-only type |
| `interval` | `string` | |
| `json`, `jsonb` | `unknown` | v1: always `unknown`; no JSON schema hints |
| `uuid` | `string` | |
| `bytea` | `Buffer` | |
| `T[]` | `T[]` | Arrays map element type |
| `inet`, `cidr`, `macaddr` | `string` | Network types |
| `tsvector` | `string` | Full-text search |
| ENUM | union literal | `'draft' \| 'published' \| 'archived'` |
| COMPOSITE | `unknown` | v1: always `unknown` |

### Expression Type Inference

| Expression | Result Type |
|------------|-------------|
| `COUNT(*)` | `string` | Returns bigint |
| `SUM(int)` | `string` | Returns bigint/numeric |
| `AVG(int)` | `string` | Returns numeric |
| `MAX(T)` | `T` or `string` | Preserves type, bigint→string |
| `MIN(T)` | `T` or `string` | Preserves type, bigint→string |
| `BOOL_OR(bool)` | `boolean` | |
| `BOOL_AND(bool)` | `boolean` | |
| `ARRAY_AGG(T)` | `T[]` | |
| `CAST(x AS T)` | `T` | |
| `x::T` | `T` | Cast operator |
| `COALESCE(a, b)` | non-null type | Removes nullability |
| `CASE WHEN...` | union of branches | |
| `CONCAT(...)` | `string` | |
| `EXTRACT(...)` | `number` | |

### Nullability Rules

| Source | Nullable? |
|--------|-----------|
| Column with `NOT NULL` | No |
| Column without `NOT NULL` | Yes |
| LEFT JOIN columns | Yes (all joined columns) |
| RIGHT JOIN columns | Yes (left table columns) |
| COALESCE result | No |
| Aggregate functions | Depends on input |
| CASE without ELSE | Yes |
| Subquery scalar | Yes |
| Computed expressions | Yes (no table/column to look up) |

**Nullability detection by adapter:**

| Adapter | Nullability Support | How |
|---------|---------------------|-----|
| PgAdapter | ✓ Full | Uses `tableID`/`columnID` from field metadata to query `pg_attribute.attnotnull` |
| PGLiteAdapter | ✗ Limited | `describeQuery()` doesn't expose table/column IDs; assumes nullable |

Note: Expressions (e.g., `COUNT(*)`, `a + b`, `COALESCE(...)`) don't have a backing table column, so nullability must be inferred from expression semantics rather than schema lookup.

### Inferrer Interface

```typescript
interface TypeInferrer {
  infer(sql: string): Promise<InferredQueryType>;
}

interface InferredQueryType {
  params: InferredParam[];
  columns: InferredColumn[];
}

interface InferredParam {
  index: number;              // $1, $2, etc.
  pgType: string;             // e.g., "int4", "text"
  tsType: string;             // e.g., "number", "string"
  nullable: boolean;
}

interface InferredColumn {
  name: string;               // Column name or alias
  pgType: string;
  tsType: string;
  nullable: boolean;
}
```

### Fallback Chain

1. Check type cache (fast path)
2. If miss + DATABASE_URL set → infer from live DB, update cache
3. If miss + schema file configured → infer via PGLite, update cache
4. If miss + no DB and no schema → diagnostic TS009 "cannot infer, no database connection"

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
| Schema changes | Manual `ts-sqlx cache clear` required (v1 does not auto-detect schema changes) |
| Manual | `ts-sqlx cache clear` |

Note: In v1, schema changes are not automatically detected. Users must run `ts-sqlx cache clear` after modifying database schema. Future versions could compute schema hash from `pg_catalog` tables.

## Diagnostics

| Code | Severity | Description |
|------|----------|-------------|
| `TS001` | Error | SQL syntax error (includes empty/whitespace-only queries) |
| `TS002` | Error | Unknown table |
| `TS003` | Error | Unknown column |
| `TS004` | Error | Type mismatch in SQL expression |
| `TS005` | Error | Wrong parameter count |
| `TS006` | Error | Missing property in params object (including nested properties) |
| `TS007` | Warning | Query has no type annotation |
| `TS008` | Info | Unable to analyze (dynamic SQL) |
| `TS009` | Warning | No database connection |
| `TS010` | Error | Declared type doesn't match inferred |

### TS001 - SQL Syntax Error

Detected via libpg-query:
- Typos in keywords (`SELEC`, `FORM`)
- Missing clauses (`SELECT id name` missing comma)
- Unclosed quotes
- Empty or whitespace-only queries
- Invalid parameter syntax (`${}`, unclosed brackets)

### TS005 - Wrong Parameter Count

```typescript
// Expected 2 parameters, got 1
db.one("SELECT * FROM users WHERE id = $1 AND name = $2", [id]);
// @expect TS005 "expected 2, got 1"

// Expected 1 parameter, got 0
db.one("SELECT * FROM users WHERE id = $1");
// @expect TS005 "expected 1, got 0"
```

### TS006 - Missing Parameter Property

For named parameters, checks that the params object has the required properties:

```typescript
// Missing 'email' property
db.one("SELECT * FROM users WHERE name = ${name} AND email = ${email}", { name: "foo" });
// @expect TS006 "missing property: email"

// Missing nested property
db.one("SELECT * FROM users WHERE city = ${profile.city}", { profile: { name: "foo" } });
// @expect TS006 "missing property: profile.city"
```

### TS008 - Unable to Analyze

Emitted for dynamic SQL that cannot be statically analyzed:

```typescript
// Template literal with interpolation
db.one(`SELECT * FROM ${getTableName()}`);
// @expect TS008

// String concatenation
db.one("SELECT * FROM " + tableName);
// @expect TS008

// Variable reference (non-const or complex)
db.one(query);
// @expect TS008

// Ternary expression
db.one(condition ? "SELECT a" : "SELECT b");
// @expect TS008
```

### TS010 - Type Mismatch

```typescript
interface User {
  userId: number;  // Wrong: should be 'id'
  name: string;
}

db.one<User>("SELECT id, name FROM users WHERE id = $1", [1]);
// @expect TS010 "property 'userId' not in query result"
// @expect TS010 "missing property 'id' in declared type"
```

## Code Actions

All code actions are registered as **quick fixes** (`CodeActionKind.QuickFix`) so they appear in the editor's lightbulb menu and can be applied with the standard quick-fix keybinding (Ctrl+. / Cmd+.).

### Add Type Annotation

Triggered by `TS007` (query has no type annotation). Inserts the inferred type as a generic parameter:

Generated types reflect column nullability: nullable columns produce `T | null`, NOT NULL columns produce `T`.

```typescript
// Before — TS007: query has no type annotation
const user = await db.oneOrNone("SELECT id, name FROM users WHERE id = $1", [id]);

// After (quick fix: "Add inferred type annotation")
// `id` is UUID NOT NULL → string; `name` is TEXT (nullable) → string | null
const user = await db.oneOrNone<{ id: string; name: string | null }>("SELECT ...", [id]);
```

For node-postgres:

```typescript
// Before — TS007
const result = await client.query("SELECT id, name FROM users", []);

// After (quick fix: "Add inferred type annotation")
const result = await client.query<{ id: string; name: string | null }>("SELECT ...", []);
```

### Update Type Annotation

Triggered by `TS010` (declared type doesn't match inferred). When a generic type parameter already exists, ts-sqlx resolves it through the TypeScript type system (including aliases, utility types, imports) and checks assignability against the inferred type. If they don't match, it reports TS010 and offers a quick fix to replace the existing type:

```typescript
interface User { userId: string; name: string }

// Before — TS010: property 'userId' not in query result; missing property 'id' in declared type
const user = await db.one<User>("SELECT id, name FROM users WHERE id = $1", [1]);

// Quick fix: "Update type annotation to match query"
// Replaces the generic parameter with the inferred type (with correct nullability):
const user = await db.one<{ id: string; name: string | null }>("SELECT id, name FROM users WHERE id = $1", [1]);
```

When the declared type is an inline object literal, the quick fix replaces it directly. When it's a named type (interface/alias), the quick fix replaces the generic parameter reference with an inline type, since modifying the type declaration could affect other usages.

### Code Action Summary

| Diagnostic | Code Action | Description |
|------------|-------------|-------------|
| `TS007` | Add inferred type annotation | Insert generic type parameter |
| `TS010` | Update type annotation to match query | Replace mismatched generic type parameter with inferred type |

## CLI

Built with `cmd-ts` for type-safe argument parsing.

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
# Option 1: Connect to real Postgres
url = "$DATABASE_URL"

# Option 2: Use PGLite with schema file (for offline/testing)
# pglite = true
# schema = "schema.sql"

[paths]
include = ["src/**/*.ts"]
exclude = ["**/*.test.ts", "**/*.spec.ts"]

[cache]
path = ".ts-sqlx/cache.db"

[diagnostics]
untyped = "warning"          # TS007 severity
unable_to_analyze = "info"   # TS008 severity
no_connection = "warning"    # TS009 severity
```

Note: The `[queries]` section with `methods` and `objects` is no longer needed since detection is type-based.

### Database Configuration Priority

1. `--database-url` CLI flag
2. `[database].url` in config (supports `$ENV_VAR` syntax)
3. `DATABASE_URL` environment variable
4. `[database].pglite = true` with `[database].schema` file
5. No database → TS009 warnings for queries requiring inference

### Resolution Order

1. CLI flags
2. `ts-sqlx.toml` in current directory
3. `ts-sqlx.toml` in parent directories
4. Built-in defaults

### Zero Config

If no config file exists:
- Use `DATABASE_URL` env var if set
- Fall back to `schema.sql` in project root with PGLite if no DATABASE_URL
- Scan all `.ts` files
- Cache in `.ts-sqlx/cache.db`

## Type Resolution

### Supported TypeScript Constructs

| Construct | Supported | Notes |
|-----------|-----------|-------|
| Inline object types | ✓ | `db.one<{ id: number }>` |
| Interfaces | ✓ | |
| Type aliases | ✓ | |
| Imported types | ✓ | Via ts-morph import following |
| Type-only imports | ✓ | `import type { User }` |
| Intersection types | ✓ | `A & B` merges properties |
| Union types | ✓ | For nullability |
| Namespaced types | ✓ | `Models.User` |

### Also Supported (via ts-morph)

Since ts-morph resolves types through the full TypeScript compiler, these work automatically:

| Construct | Example |
|-----------|---------|
| Mapped types | `Record<string, number>` |
| Utility types | `Pick<User, 'id' \| 'name'>`, `Omit`, `Partial`, etc. |
| Conditional types | `NonNullable<T>`, `Extract`, etc. |
| Generic type parameters | `type Result<T> = { data: T }` |

ts-morph evaluates these to their resolved structural types before comparison.

## Testing

### PGLite-Based Integration Tests

All integration tests run against PGLite with a fixture schema. No external Postgres required:

```typescript
import { PGLiteAdapter } from '@ts-sqlx/core';
import { runFixtureTests } from '@ts-sqlx/test-utils';
import * as fs from 'fs';

describe('diagnostics', () => {
  let db: PGLiteAdapter;

  beforeAll(async () => {
    db = await PGLiteAdapter.create();
    await db.executeSchema(fs.readFileSync('tests/fixtures/schema.sql', 'utf8'));
  });

  afterAll(async () => {
    await db.disconnect();
  });

  it('detects syntax errors', async () => {
    await runFixtureTests(db, 'tests/fixtures/diagnostics/ts001-syntax-errors.ts');
  });
});
```

### Fixture Runner

The `fixtureRunner` parses test files, extracts `@expect` annotations, runs the analyzer, and compares results:

```typescript
interface FixtureResult {
  file: string;
  passed: number;
  failed: number;
  errors: FixtureError[];
}

interface FixtureError {
  line: number;
  expected: string;        // e.g., "TS001"
  actual: string | null;   // Actual diagnostic or null if none
  message?: string;
}

async function runFixtureTests(
  db: DatabaseAdapter,
  fixturePath: string
): Promise<FixtureResult>;
```

### Test Schema

`tests/fixtures/schema.sql` defines the test database:

```sql
-- Core tables for testing
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  name TEXT,
  age INTEGER,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  author_id UUID REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT,
  view_count BIGINT DEFAULT 0,
  tags TEXT[]
);

-- Custom types for type mapping tests
CREATE TYPE status_enum AS ENUM ('draft', 'published', 'archived');
CREATE TYPE address AS (street TEXT, city TEXT, zip TEXT);

-- Comprehensive type showcase table (see tests/fixtures/schema.sql for full definition)
CREATE TABLE type_showcase (
  small_int SMALLINT,
  regular_int INTEGER NOT NULL,
  big_int BIGINT,
  real_num REAL,
  double_num DOUBLE PRECISION,
  numeric_num NUMERIC(10,2),
  text_col TEXT,
  bool_col BOOLEAN,
  date_col DATE,
  timestamp_col TIMESTAMP,
  timestamptz_col TIMESTAMPTZ,
  json_col JSON,
  jsonb_col JSONB,
  uuid_col UUID,
  bytea_col BYTEA,
  int_array INTEGER[],
  text_array TEXT[],
  status status_enum,
  addr address
);
```

### CI Integration

Tests run in CI without any database setup:

```yaml
# .github/workflows/test.yml
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v2
    - run: pnpm install
    - run: pnpm test  # Uses PGLite, no Postgres needed
```

## Test Fixture Format

Test fixtures use comment-based annotations for expected diagnostics:

```typescript
// Single diagnostic
db.one("SELEC * FROM users");
// @expect TS001

// Diagnostic with message substring
db.one("SELECT * FROM nonexistent");
// @expect TS002 "nonexistent"

// Multiple diagnostics on same statement
db.one<{ wrong: number }>("SELECT id FROM missing_table");
// @expect TS002 @expect TS010

// Explicitly valid (no diagnostic expected)
db.one<{ id: number }>("SELECT id FROM users WHERE id = $1", [1]);
// @expect-pass

// Code action test
db.one("SELECT id, name FROM users");
// @expect TS007
// @action "Generate type" -> "<{ id: number; name: string }>"
```

## Dependencies

### Core

| Package | Purpose |
|---------|---------|
| `ts-morph` | TypeScript analysis and type resolution |
| `libpg-query` | PostgreSQL SQL parser (actual Postgres parser) |
| `@electric-sql/pglite` | Embedded WASM Postgres |
| `pg` | Real Postgres client |
| `better-sqlite3` | Type cache storage |

### Language Server

| Package | Purpose |
|---------|---------|
| `vscode-languageserver` | LSP protocol implementation (import from `vscode-languageserver/node`) |
| `vscode-languageserver-textdocument` | Document handling |

### CLI

| Package | Purpose |
|---------|---------|
| `cmd-ts` | Type-safe CLI argument parsing |

### Dev/Test

| Package | Purpose |
|---------|---------|
| `vitest` | Test runner |
| `@electric-sql/pglite` | Used in tests (also runtime for offline mode) |

## Future Work

### v1.1

- Tagged template literals with interpolation
- `@sql` annotation for variable hints (if needed)
- Hover information showing inferred types and schema details

### v2

- TSGo adapter for faster TypeScript analysis
- Query completions (table/column names)
- Refactoring support (rename column across queries)
- Mapped/utility type support (Pick, Omit, etc.)
- PGLite persistence mode (save schema state between runs)
