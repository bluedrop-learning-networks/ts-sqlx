# ts-sqlx Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript SQL query checker and type inferrer for PostgreSQL, providing LSP diagnostics and CLI checking for pg-promise/node-postgres projects.

**Architecture:** Monorepo with 4 packages (core, language-server, cli, test-utils). Core provides query detection, SQL parsing, param extraction, DB inference, and type comparison. All type inference uses PREPARE-based approach via a DatabaseAdapter abstraction (real Postgres or PGLite). Tests run against PGLite with fixture schemas and `@expect` annotations.

**Tech Stack:** TypeScript, ts-morph, libpg-query, PGLite, pg, better-sqlite3, vscode-languageserver, cmd-ts, vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-03-20-ts-sqlx-design.md`

---

## File Structure

```
ts-sqlx/
├── package.json                          # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json                    # Shared TS config
├── vitest.config.ts                      # Root vitest config
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                  # Public exports
│   │       ├── config.ts                 # ts-sqlx.toml parsing
│   │       ├── types.ts                  # Shared type definitions
│   │       ├── adapters/
│   │       │   ├── database/
│   │       │   │   ├── types.ts          # DatabaseAdapter interface
│   │       │   │   ├── pgAdapter.ts      # Real Postgres via pg
│   │       │   │   ├── pgliteAdapter.ts  # PGLite WASM adapter
│   │       │   │   └── oidMap.ts         # OID → type name mapping
│   │       │   └── typescript/
│   │       │       ├── types.ts          # TypeScriptAdapter interface
│   │       │       └── tsMorphAdapter.ts # ts-morph implementation
│   │       ├── paramExtractor.ts         # pg-promise param extraction
│   │       ├── sqlAnalyzer.ts            # libpg-query parsing
│   │       ├── queryDetector.ts          # Type-based query detection
│   │       ├── dbInferrer.ts             # PREPARE-based type inference
│   │       ├── typeComparator.ts         # Compare inferred vs declared types
│   │       ├── diagnostics.ts            # Diagnostic generation (TS001-TS010)
│   │       └── cache.ts                  # SQLite type cache
│   ├── test-utils/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                  # Public exports
│   │       ├── pgliteFixture.ts          # PGLite setup/teardown helpers
│   │       └── fixtureRunner.ts          # Parse @expect annotations, run assertions
│   ├── language-server/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                  # LSP binary entry point
│   │       ├── server.ts                 # vscode-languageserver setup
│   │       └── codeActions.ts            # Quick fix code actions
│   └── cli/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts                  # CLI binary entry point
│           └── commands/
│               ├── check.ts              # ts-sqlx check
│               ├── generate.ts           # ts-sqlx generate
│               └── cache.ts              # ts-sqlx cache status/clear
├── tests/
│   ├── fixtures/                         # Already exists - test fixture files
│   └── integration/
│       ├── paramExtractor.test.ts
│       ├── sqlAnalyzer.test.ts
│       ├── dbInferrer.test.ts
│       ├── queryDetector.test.ts
│       ├── typeComparator.test.ts
│       ├── diagnostics.test.ts
│       ├── returnTypes.test.ts
│       ├── pgpParams.test.ts
│       ├── typeResolution.test.ts
│       └── cache.test.ts
```

---

## Chunk 1: Project Scaffolding + Test Utils + PGLite Adapter

This chunk sets up the monorepo, core types, PGLite adapter, and test utilities — everything needed to write red-green tests using the existing fixtures.

### Task 1: Monorepo Scaffolding

**Files:**
- Create: `package.json` (workspace root)
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/test-utils/package.json`
- Create: `packages/test-utils/tsconfig.json`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "ts-sqlx",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest",
    "test:run": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@ts-sqlx/core': path.resolve(__dirname, 'packages/core'),
      '@ts-sqlx/test-utils': path.resolve(__dirname, 'packages/test-utils'),
    },
  },
});
```

Note: vitest.config.ts is CommonJS-compatible (vitest handles it), so `__dirname` is fine here. All other source/test files use ESM and must use `import.meta.url` with `fileURLToPath` instead of `__dirname`.

- [ ] **Step 5: Create `packages/core/package.json`**

```json
{
  "name": "@ts-sqlx/core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@electric-sql/pglite": "^0.2.0",
    "better-sqlite3": "^11.0.0",
    "libpg-query": "^15.2.0",
    "pg": "^8.13.0",
    "ts-morph": "^25.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/pg": "^8.11.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 6: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 7: Create `packages/test-utils/package.json`**

```json
{
  "name": "@ts-sqlx/test-utils",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@ts-sqlx/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 8: Create `packages/test-utils/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 9: Install dependencies**

Run: `pnpm install`
Expected: All packages install, workspace links created.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.config.ts packages/core/package.json packages/core/tsconfig.json packages/test-utils/package.json packages/test-utils/tsconfig.json pnpm-lock.yaml
git commit -m "feat: scaffold monorepo with core and test-utils packages"
```

---

### Task 2: Core Type Definitions

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/adapters/database/types.ts`

- [ ] **Step 1: Create `packages/core/src/types.ts`**

Shared types used across the project:

```typescript
// Text range in source
export interface TextRange {
  start: number;
  end: number;
}

// Diagnostic codes
export type DiagnosticCode =
  | 'TS001' | 'TS002' | 'TS003' | 'TS004' | 'TS005'
  | 'TS006' | 'TS007' | 'TS008' | 'TS009' | 'TS010';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  range: TextRange;
}

// Query method types (pg-promise + node-postgres)
export type QueryMethod =
  | 'one' | 'oneOrNone' | 'many' | 'manyOrNone' | 'any'
  | 'none' | 'result' | 'query' | 'multi';

export type QueryLibrary = 'pg-promise' | 'node-postgres';

// Detected query call
export interface QueryCallInfo {
  library: QueryLibrary;
  method: QueryMethod;
  sqlArgIndex: number;
  paramsArgIndex: number | undefined;
  sqlText: string | undefined;          // Resolved SQL string (undefined if dynamic)
  declaredResultType: string | undefined; // Generic type text
  paramsType: string | undefined;        // Params argument type text
  position: TextRange;
}

// Parameter extraction
export type ParamModifier = 'raw' | 'value' | 'name' | 'alias' | 'json' | 'csv' | 'list';

export interface ParamRef {
  position: TextRange;
  kind: 'indexed' | 'named';
  number: number;
  name?: string;
  path?: string[];
  modifier?: ParamModifier;
  shorthand?: '^' | '#' | '~';
}

export interface ParamError {
  position: TextRange;
  message: string;
}

export interface ExtractedParams {
  normalized: string;
  params: ParamRef[];
  errors: ParamError[];
}

// Type inference results
export interface InferredQueryType {
  params: InferredParam[];
  columns: InferredColumn[];
}

export interface InferredParam {
  index: number;
  pgType: string;
  tsType: string;
  nullable: boolean;
}

export interface InferredColumn {
  name: string;
  pgType: string;
  tsType: string;
  nullable: boolean;
}
```

- [ ] **Step 2: Create `packages/core/src/adapters/database/types.ts`**

DatabaseAdapter interface:

```typescript
export interface PgTypeInfo {
  oid: number;
  name: string;
  isArray: boolean;
}

export interface ColumnInfo {
  name: string;
  type: PgTypeInfo;
  nullable: boolean;
}

export interface QueryTypeInfo {
  params: PgTypeInfo[];
  columns: ColumnInfo[];
}

export interface CompositeField {
  name: string;
  type: PgTypeInfo;
}

export interface DatabaseAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  executeSchema(sql: string): Promise<void>;
  describeQuery(sql: string): Promise<QueryTypeInfo>;
  getEnumValues(typeName: string): Promise<string[]>;
  getCompositeFields(typeName: string): Promise<CompositeField[]>;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/adapters/database/types.ts
git commit -m "feat: add core type definitions and DatabaseAdapter interface"
```

---

### Task 3: OID → Type Name Mapping

**Files:**
- Create: `packages/core/src/adapters/database/oidMap.ts`
- Create: `tests/integration/oidMap.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/oidMap.test.ts
import { describe, it, expect } from 'vitest';
import { oidToTypeName, tsTypeFromPgType, isArrayOid } from '@ts-sqlx/core/src/adapters/database/oidMap.js';

describe('oidToTypeName', () => {
  it('maps common OIDs to type names', () => {
    expect(oidToTypeName(23)).toBe('int4');
    expect(oidToTypeName(25)).toBe('text');
    expect(oidToTypeName(16)).toBe('bool');
    expect(oidToTypeName(2950)).toBe('uuid');
  });

  it('returns unknown for unmapped OIDs', () => {
    expect(oidToTypeName(99999)).toBe('unknown');
  });
});

describe('tsTypeFromPgType', () => {
  it('maps int types to number', () => {
    expect(tsTypeFromPgType('int2')).toBe('number');
    expect(tsTypeFromPgType('int4')).toBe('number');
    expect(tsTypeFromPgType('float4')).toBe('number');
    expect(tsTypeFromPgType('float8')).toBe('number');
  });

  it('maps bigint to string (precision)', () => {
    expect(tsTypeFromPgType('int8')).toBe('string');
    expect(tsTypeFromPgType('numeric')).toBe('string');
  });

  it('maps text types to string', () => {
    expect(tsTypeFromPgType('text')).toBe('string');
    expect(tsTypeFromPgType('varchar')).toBe('string');
    expect(tsTypeFromPgType('char')).toBe('string');
    expect(tsTypeFromPgType('uuid')).toBe('string');
  });

  it('maps bool to boolean', () => {
    expect(tsTypeFromPgType('bool')).toBe('boolean');
  });

  it('maps date/time to Date', () => {
    expect(tsTypeFromPgType('timestamp')).toBe('Date');
    expect(tsTypeFromPgType('timestamptz')).toBe('Date');
    expect(tsTypeFromPgType('date')).toBe('Date');
  });

  it('maps time types to string', () => {
    expect(tsTypeFromPgType('time')).toBe('string');
    expect(tsTypeFromPgType('timetz')).toBe('string');
    expect(tsTypeFromPgType('interval')).toBe('string');
  });

  it('maps json/jsonb to unknown', () => {
    expect(tsTypeFromPgType('json')).toBe('unknown');
    expect(tsTypeFromPgType('jsonb')).toBe('unknown');
  });

  it('maps bytea to Buffer', () => {
    expect(tsTypeFromPgType('bytea')).toBe('Buffer');
  });

  it('maps network types to string', () => {
    expect(tsTypeFromPgType('inet')).toBe('string');
    expect(tsTypeFromPgType('cidr')).toBe('string');
    expect(tsTypeFromPgType('macaddr')).toBe('string');
  });
});

describe('isArrayOid', () => {
  it('identifies array OIDs', () => {
    expect(isArrayOid(1007)).toBe(true);  // _int4
    expect(isArrayOid(1009)).toBe(true);  // _text
  });

  it('rejects non-array OIDs', () => {
    expect(isArrayOid(23)).toBe(false);
    expect(isArrayOid(25)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/oidMap.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement OID map**

```typescript
// packages/core/src/adapters/database/oidMap.ts

// Standard PostgreSQL OIDs
const OID_MAP: Record<number, string> = {
  16: 'bool',
  17: 'bytea',
  18: 'char',
  20: 'int8',
  21: 'int2',
  23: 'int4',
  25: 'text',
  26: 'oid',
  114: 'json',
  142: 'xml',
  600: 'point',
  700: 'float4',
  701: 'float8',
  790: 'money',
  829: 'macaddr',
  869: 'inet',
  650: 'cidr',
  1042: 'char',      // bpchar
  1043: 'varchar',
  1082: 'date',
  1083: 'time',
  1114: 'timestamp',
  1184: 'timestamptz',
  1186: 'interval',
  1266: 'timetz',
  1560: 'bit',
  1562: 'varbit',
  1700: 'numeric',
  2950: 'uuid',
  3614: 'tsvector',
  3615: 'tsquery',
  3802: 'jsonb',
  // Array types
  1000: '_bool',
  1001: '_bytea',
  1005: '_int2',
  1007: '_int4',
  1009: '_text',
  1016: '_int8',
  1021: '_float4',
  1022: '_float8',
  1115: '_timestamp',
  1182: '_date',
  1231: '_numeric',
  2951: '_uuid',
  199: '_json',
  3807: '_jsonb',
  1015: '_varchar',
};

export function oidToTypeName(oid: number): string {
  return OID_MAP[oid] ?? 'unknown';
}

export function isArrayOid(oid: number): boolean {
  const name = OID_MAP[oid];
  return name !== undefined && name.startsWith('_');
}

export function arrayElementTypeName(arrayTypeName: string): string {
  if (arrayTypeName.startsWith('_')) {
    return arrayTypeName.slice(1);
  }
  return arrayTypeName;
}

const PG_TO_TS: Record<string, string> = {
  // Numeric
  int2: 'number',
  int4: 'number',
  int8: 'string',      // bigint exceeds JS number precision
  float4: 'number',
  float8: 'number',
  numeric: 'string',   // precision preservation
  money: 'string',
  oid: 'number',
  // Text
  text: 'string',
  varchar: 'string',
  char: 'string',
  xml: 'string',
  // Boolean
  bool: 'boolean',
  // Date/Time
  date: 'Date',
  timestamp: 'Date',
  timestamptz: 'Date',
  time: 'string',
  timetz: 'string',
  interval: 'string',
  // JSON
  json: 'unknown',
  jsonb: 'unknown',
  // Binary
  bytea: 'Buffer',
  // UUID
  uuid: 'string',
  // Network
  inet: 'string',
  cidr: 'string',
  macaddr: 'string',
  // Full-text search
  tsvector: 'string',
  tsquery: 'string',
  // Geometric
  point: 'string',
  // Bit
  bit: 'string',
  varbit: 'string',
};

export function tsTypeFromPgType(pgType: string): string {
  return PG_TO_TS[pgType] ?? 'unknown';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/oidMap.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/adapters/database/oidMap.ts tests/integration/oidMap.test.ts
git commit -m "feat: add PostgreSQL OID to TypeScript type mapping"
```

---

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

---

### Task 5: Test Utils — PGLite Fixture Helper

**Files:**
- Create: `packages/test-utils/src/pgliteFixture.ts`

- [ ] **Step 1: Implement PGLite fixture helper**

```typescript
// packages/test-utils/src/pgliteFixture.ts
import { PGLiteAdapter } from '@ts-sqlx/core/src/adapters/database/pgliteAdapter.js';
import type { DatabaseAdapter } from '@ts-sqlx/core/src/adapters/database/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../tests/fixtures');

export interface PGLiteFixture {
  adapter: DatabaseAdapter;
  setup(): Promise<void>;
  teardown(): Promise<void>;
}

export async function createPGLiteFixture(
  schemaPath?: string
): Promise<PGLiteFixture> {
  const resolvedSchema = schemaPath ?? path.join(FIXTURES_DIR, 'schema.sql');
  const adapter = await PGLiteAdapter.create();

  return {
    adapter,
    async setup() {
      const schema = fs.readFileSync(resolvedSchema, 'utf8');
      await adapter.executeSchema(schema);
    },
    async teardown() {
      await adapter.disconnect();
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/test-utils/src/pgliteFixture.ts
git commit -m "feat: add PGLite test fixture helper"
```

---

### Task 6: Test Utils — Fixture Runner (Annotation Parser)

**Files:**
- Create: `packages/test-utils/src/fixtureRunner.ts`
- Create: `tests/integration/fixtureRunner.test.ts`

The fixture runner parses `@expect` annotations from test fixture files and provides an interface for running them against diagnostics. It does NOT run the full analyzer yet — that comes later. This task implements the annotation parsing and result comparison logic.

- [ ] **Step 1: Write the test for annotation parsing**

```typescript
// tests/integration/fixtureRunner.test.ts
import { describe, it, expect } from 'vitest';
import { parseFixtureExpectations } from '@ts-sqlx/test-utils/src/fixtureRunner.js';

describe('parseFixtureExpectations', () => {
  it('parses single @expect annotation', () => {
    const source = `
db.one("SELEC * FROM users");
// @expect TS001
`.trim();
    const expectations = parseFixtureExpectations(source);
    expect(expectations).toHaveLength(1);
    expect(expectations[0].code).toBe('TS001');
    expect(expectations[0].messageSubstring).toBeUndefined();
    expect(expectations[0].line).toBe(2);
  });

  it('parses @expect with message substring', () => {
    const source = `
db.one("SELECT * FROM nonexistent");
// @expect TS002 "nonexistent"
`.trim();
    const expectations = parseFixtureExpectations(source);
    expect(expectations).toHaveLength(1);
    expect(expectations[0].code).toBe('TS002');
    expect(expectations[0].messageSubstring).toBe('nonexistent');
  });

  it('parses multiple @expect on same line', () => {
    const source = `
db.one<{ wrong: number }>("SELECT id FROM missing_table");
// @expect TS002 @expect TS010
`.trim();
    const expectations = parseFixtureExpectations(source);
    expect(expectations).toHaveLength(2);
    expect(expectations[0].code).toBe('TS002');
    expect(expectations[1].code).toBe('TS010');
  });

  it('parses @expect-pass annotation', () => {
    const source = `
db.one<{ id: number }>("SELECT id FROM users WHERE id = $1", [1]);
// @expect-pass
`.trim();
    const expectations = parseFixtureExpectations(source);
    expect(expectations).toHaveLength(1);
    expect(expectations[0].pass).toBe(true);
  });

  it('ignores non-annotation comments', () => {
    const source = `
// This is a regular comment
db.one("SELECT 1");
// Another comment
`.trim();
    const expectations = parseFixtureExpectations(source);
    expect(expectations).toHaveLength(0);
  });

  it('associates annotation with the preceding code line', () => {
    const source = `
db.one("SELECT 1");
// @expect-pass

db.one("SELEC");
// @expect TS001
`.trim();
    const expectations = parseFixtureExpectations(source);
    expect(expectations).toHaveLength(2);
    // Line numbers refer to the annotation comment line
    expect(expectations[0].line).toBe(2);
    expect(expectations[1].line).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/fixtureRunner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement fixture runner**

```typescript
// packages/test-utils/src/fixtureRunner.ts
import type { Diagnostic, DiagnosticCode } from '@ts-sqlx/core/src/types.js';
import type { DatabaseAdapter } from '@ts-sqlx/core/src/adapters/database/types.js';

export interface FixtureExpectation {
  line: number;               // Line number of the @expect comment
  code?: DiagnosticCode;      // Expected diagnostic code
  messageSubstring?: string;  // Optional message match
  pass?: boolean;             // @expect-pass
}

export interface FixtureResult {
  file: string;
  passed: number;
  failed: number;
  errors: FixtureError[];
}

export interface FixtureError {
  line: number;
  expected: string;
  actual: string | null;
  message?: string;
}

const EXPECT_PATTERN = /@expect\s+(TS\d{3})(?:\s+"([^"]*)")?/g;
const EXPECT_PASS_PATTERN = /@expect-pass/;

export function parseFixtureExpectations(source: string): FixtureExpectation[] {
  const lines = source.split('\n');
  const expectations: FixtureExpectation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line.startsWith('//')) continue;

    const lineNumber = i + 1; // 1-based

    // Check @expect-pass
    if (EXPECT_PASS_PATTERN.test(line)) {
      expectations.push({ line: lineNumber, pass: true });
      continue;
    }

    // Check @expect TS### patterns
    // Reset regex state for each line
    const regex = new RegExp(EXPECT_PATTERN.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      expectations.push({
        line: lineNumber,
        code: match[1] as DiagnosticCode,
        messageSubstring: match[2] || undefined,
      });
    }
  }

  return expectations;
}

export function matchDiagnostics(
  expectations: FixtureExpectation[],
  diagnostics: Diagnostic[],
  source: string,
): FixtureResult {
  const lines = source.split('\n');
  const errors: FixtureError[] = [];
  let passed = 0;

  for (const exp of expectations) {
    if (exp.pass) {
      // @expect-pass: no diagnostics should appear on the preceding code line
      // The preceding code line is the line before the annotation
      const codeLine = exp.line - 1;
      const codeLineStart = lines.slice(0, codeLine - 1).join('\n').length + (codeLine > 1 ? 1 : 0);
      const codeLineEnd = codeLineStart + lines[codeLine - 1].length;

      const found = diagnostics.filter(
        (d) => d.range.start >= codeLineStart && d.range.start < codeLineEnd
      );
      if (found.length === 0) {
        passed++;
      } else {
        errors.push({
          line: exp.line,
          expected: 'no diagnostics',
          actual: found.map((d) => `${d.code}: ${d.message}`).join(', '),
        });
      }
      continue;
    }

    // @expect TS###: find matching diagnostic near this line
    if (!exp.code) continue;

    const matching = diagnostics.filter((d) => d.code === exp.code);

    if (matching.length === 0) {
      errors.push({
        line: exp.line,
        expected: exp.code,
        actual: null,
        message: exp.messageSubstring
          ? `Expected ${exp.code} "${exp.messageSubstring}" but got no diagnostics`
          : `Expected ${exp.code} but got no diagnostics`,
      });
      continue;
    }

    // Check message substring if specified
    if (exp.messageSubstring) {
      const withMessage = matching.filter((d) =>
        d.message.includes(exp.messageSubstring!)
      );
      if (withMessage.length === 0) {
        errors.push({
          line: exp.line,
          expected: `${exp.code} "${exp.messageSubstring}"`,
          actual: matching.map((d) => `${d.code}: ${d.message}`).join(', '),
          message: `Found ${exp.code} but message didn't contain "${exp.messageSubstring}"`,
        });
        continue;
      }
    }

    passed++;
  }

  return { file: '', passed, failed: errors.length, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/fixtureRunner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/test-utils/src/fixtureRunner.ts tests/integration/fixtureRunner.test.ts
git commit -m "feat: add fixture runner with @expect annotation parsing"
```

---

### Task 7: Test Utils — Index & Exports

**Files:**
- Create: `packages/test-utils/src/index.ts`
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Create test-utils index**

```typescript
// packages/test-utils/src/index.ts
export { createPGLiteFixture } from './pgliteFixture.js';
export type { PGLiteFixture } from './pgliteFixture.js';
export {
  parseFixtureExpectations,
  matchDiagnostics,
} from './fixtureRunner.js';
export type {
  FixtureExpectation,
  FixtureResult,
  FixtureError,
} from './fixtureRunner.js';
```

- [ ] **Step 2: Create core index (initial — will grow)**

```typescript
// packages/core/src/index.ts
export * from './types.js';
export * from './adapters/database/types.js';
export * from './adapters/database/oidMap.js';
export { PGLiteAdapter } from './adapters/database/pgliteAdapter.js';
```

- [ ] **Step 3: Commit**

```bash
git add packages/test-utils/src/index.ts packages/core/src/index.ts
git commit -m "feat: add package index exports for core and test-utils"
```

---

## Chunk 2: Param Extractor + SQL Analyzer

This chunk implements the pg-promise parameter extraction and libpg-query SQL parsing — the two components that operate on raw SQL strings before any database interaction.

### Task 8: Param Extractor

**Files:**
- Create: `packages/core/src/paramExtractor.ts`
- Create: `tests/integration/paramExtractor.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/paramExtractor.test.ts
import { describe, it, expect } from 'vitest';
import { extractParams } from '@ts-sqlx/core/src/paramExtractor.js';

describe('extractParams', () => {
  describe('indexed parameters', () => {
    it('extracts $1, $2 style params', () => {
      const result = extractParams('SELECT * FROM users WHERE id = $1 AND name = $2');
      expect(result.normalized).toBe('SELECT * FROM users WHERE id = $1 AND name = $2');
      expect(result.params).toHaveLength(2);
      expect(result.params[0].kind).toBe('indexed');
      expect(result.params[0].number).toBe(1);
      expect(result.params[1].number).toBe(2);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('named parameters — curly braces', () => {
    it('extracts ${name} style params', () => {
      const result = extractParams('SELECT * FROM users WHERE name = ${name} AND email = ${email}');
      expect(result.normalized).toBe('SELECT * FROM users WHERE name = $1 AND email = $2');
      expect(result.params).toHaveLength(2);
      expect(result.params[0].kind).toBe('named');
      expect(result.params[0].name).toBe('name');
      expect(result.params[0].number).toBe(1);
      expect(result.params[1].name).toBe('email');
      expect(result.params[1].number).toBe(2);
    });

    it('reuses number for duplicate names', () => {
      const result = extractParams('SELECT * FROM users WHERE name = ${name} OR name LIKE ${name}');
      expect(result.normalized).toBe('SELECT * FROM users WHERE name = $1 OR name LIKE $1');
      expect(result.params).toHaveLength(2);
      expect(result.params[0].number).toBe(1);
      expect(result.params[1].number).toBe(1);
    });
  });

  describe('all bracket styles', () => {
    it('extracts $(name) style', () => {
      const result = extractParams('SELECT * FROM users WHERE name = $(name)');
      expect(result.params[0].name).toBe('name');
    });

    it('extracts $<name> style', () => {
      const result = extractParams('SELECT * FROM users WHERE name = $<name>');
      expect(result.params[0].name).toBe('name');
    });

    it('extracts $[name] style', () => {
      const result = extractParams('SELECT * FROM users WHERE name = $[name]');
      expect(result.params[0].name).toBe('name');
    });

    it('extracts $/name/ style', () => {
      const result = extractParams('SELECT * FROM users WHERE name = $/name/');
      expect(result.params[0].name).toBe('name');
    });
  });

  describe('modifiers', () => {
    it('extracts :raw modifier', () => {
      const result = extractParams('SELECT * FROM ${table:raw}');
      expect(result.params[0].modifier).toBe('raw');
      expect(result.params[0].name).toBe('table');
    });

    it('extracts ^ shorthand for :raw', () => {
      const result = extractParams('SELECT * FROM ${table^}');
      expect(result.params[0].modifier).toBe('raw');
      expect(result.params[0].shorthand).toBe('^');
    });

    it('extracts # shorthand for :value', () => {
      const result = extractParams('SELECT * FROM users WHERE id = ${id#}');
      expect(result.params[0].modifier).toBe('value');
      expect(result.params[0].shorthand).toBe('#');
    });

    it('extracts ~ shorthand for :name', () => {
      const result = extractParams('SELECT * FROM users ORDER BY ${col~}');
      expect(result.params[0].modifier).toBe('name');
      expect(result.params[0].shorthand).toBe('~');
    });

    it('extracts :json modifier', () => {
      const result = extractParams('INSERT INTO logs VALUES (${data:json})');
      expect(result.params[0].modifier).toBe('json');
    });

    it('extracts :csv modifier', () => {
      const result = extractParams('WHERE id IN (${ids:csv})');
      expect(result.params[0].modifier).toBe('csv');
    });

    it('extracts :list modifier (alias for csv)', () => {
      const result = extractParams('WHERE id IN (${ids:list})');
      expect(result.params[0].modifier).toBe('list');
    });

    it('extracts indexed params with modifiers', () => {
      const result = extractParams('SELECT * FROM $1:raw WHERE $2:name = $3');
      expect(result.params[0].modifier).toBe('raw');
      expect(result.params[1].modifier).toBe('name');
      expect(result.params[2].modifier).toBeUndefined();
    });
  });

  describe('nested properties', () => {
    it('extracts dotted path', () => {
      const result = extractParams('SELECT * FROM users WHERE city = ${profile.city}');
      expect(result.params[0].name).toBe('profile');
      expect(result.params[0].path).toEqual(['profile', 'city']);
    });

    it('extracts deep nesting', () => {
      const result = extractParams('WHERE city = ${profile.address.city}');
      expect(result.params[0].path).toEqual(['profile', 'address', 'city']);
    });
  });

  describe('this keyword', () => {
    it('extracts ${this}', () => {
      const result = extractParams('INSERT INTO logs VALUES (${this:json})');
      expect(result.params[0].name).toBe('this');
      expect(result.params[0].modifier).toBe('json');
    });
  });

  describe('errors', () => {
    it('reports unclosed bracket', () => {
      const result = extractParams('SELECT ${name FROM users');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toMatch(/unclosed/i);
    });

    it('reports empty parameter name', () => {
      const result = extractParams('SELECT * FROM users WHERE id = ${}');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toMatch(/empty/i);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/paramExtractor.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement param extractor**

```typescript
// packages/core/src/paramExtractor.ts
import type { ExtractedParams, ParamRef, ParamError, ParamModifier, TextRange } from './types.js';

const BRACKET_PAIRS: Record<string, string> = {
  '{': '}',
  '(': ')',
  '<': '>',
  '[': ']',
  '/': '/',
};

const MODIFIER_MAP: Record<string, ParamModifier> = {
  raw: 'raw',
  value: 'value',
  name: 'name',
  alias: 'alias',
  json: 'json',
  csv: 'csv',
  list: 'list',
};

const SHORTHAND_MAP: Record<string, ParamModifier> = {
  '^': 'raw',
  '#': 'value',
  '~': 'name',
};

export function extractParams(sql: string): ExtractedParams {
  const params: ParamRef[] = [];
  const errors: ParamError[] = [];
  const nameToNumber = new Map<string, number>();
  let nextNumber = 1;
  let normalized = '';
  let i = 0;

  while (i < sql.length) {
    if (sql[i] !== '$') {
      normalized += sql[i];
      i++;
      continue;
    }

    const dollarPos = i;
    i++; // skip $

    if (i >= sql.length) {
      normalized += '$';
      break;
    }

    // Check for indexed parameter: $N
    if (sql[i] >= '1' && sql[i] <= '9') {
      let numStr = '';
      while (i < sql.length && sql[i] >= '0' && sql[i] <= '9') {
        numStr += sql[i];
        i++;
      }
      const num = parseInt(numStr, 10);

      // Check for modifier on indexed param: $1:raw or $1^
      let modifier: ParamModifier | undefined;
      let shorthand: '^' | '#' | '~' | undefined;
      const modResult = parseModifier(sql, i);
      if (modResult) {
        modifier = modResult.modifier;
        shorthand = modResult.shorthand;
        i = modResult.end;
      }

      params.push({
        position: { start: dollarPos, end: i },
        kind: 'indexed',
        number: num,
        modifier,
        shorthand,
      });

      // Keep next number in sync
      if (num >= nextNumber) nextNumber = num + 1;
      normalized += `$${num}`;
      continue;
    }

    // Check for named parameter: ${name}, $(name), $<name>, $[name], $/name/
    const openChar = sql[i];
    const closeChar = BRACKET_PAIRS[openChar];
    if (closeChar) {
      i++; // skip open bracket
      const nameStart = i;

      // Find close bracket
      const closeIdx = sql.indexOf(closeChar, i);
      if (closeIdx === -1) {
        errors.push({
          position: { start: dollarPos, end: sql.length },
          message: `Unclosed bracket '${openChar}' in parameter`,
        });
        normalized += sql.slice(dollarPos);
        i = sql.length;
        continue;
      }

      const content = sql.slice(nameStart, closeIdx);
      i = closeIdx + 1; // skip close bracket

      if (content.length === 0) {
        errors.push({
          position: { start: dollarPos, end: i },
          message: 'Empty parameter name',
        });
        normalized += sql.slice(dollarPos, i);
        continue;
      }

      // Parse name, modifier, and shorthand from content
      let name: string;
      let modifier: ParamModifier | undefined;
      let shorthand: '^' | '#' | '~' | undefined;
      let path: string[] | undefined;

      // Check for shorthand at end: ${name^}, ${name#}, ${name~}
      const lastChar = content[content.length - 1];
      if (SHORTHAND_MAP[lastChar]) {
        shorthand = lastChar as '^' | '#' | '~';
        modifier = SHORTHAND_MAP[lastChar];
        name = content.slice(0, -1);
      } else if (content.includes(':')) {
        // Check for modifier: ${name:raw}
        const colonIdx = content.indexOf(':');
        name = content.slice(0, colonIdx);
        const modName = content.slice(colonIdx + 1);
        modifier = MODIFIER_MAP[modName];
      } else {
        name = content;
      }

      // Check for nested properties
      if (name.includes('.')) {
        path = name.split('.');
        name = path[0];
      }

      // Assign/reuse number
      let number: number;
      const lookupKey = path ? path.join('.') : name;
      if (nameToNumber.has(lookupKey)) {
        number = nameToNumber.get(lookupKey)!;
      } else {
        number = nextNumber++;
        nameToNumber.set(lookupKey, number);
      }

      params.push({
        position: { start: dollarPos, end: i },
        kind: 'named',
        number,
        name,
        path,
        modifier,
        shorthand,
      });

      normalized += `$${number}`;
      continue;
    }

    // Not a recognized parameter pattern — keep as-is
    normalized += '$';
    // Don't advance i — we already incremented past $
  }

  return { normalized, params, errors };
}

function parseModifier(
  sql: string,
  pos: number
): { modifier: ParamModifier; shorthand?: '^' | '#' | '~'; end: number } | undefined {
  if (pos >= sql.length) return undefined;

  // Shorthand: $1^, $1#, $1~
  const ch = sql[pos];
  if (SHORTHAND_MAP[ch]) {
    return {
      modifier: SHORTHAND_MAP[ch],
      shorthand: ch as '^' | '#' | '~',
      end: pos + 1,
    };
  }

  // Long form: $1:raw, $1:name, etc.
  if (ch === ':') {
    const rest = sql.slice(pos + 1);
    for (const [key, mod] of Object.entries(MODIFIER_MAP)) {
      if (rest.startsWith(key)) {
        // Make sure the modifier isn't followed by a word char
        const afterMod = pos + 1 + key.length;
        if (afterMod >= sql.length || !/\w/.test(sql[afterMod])) {
          return { modifier: mod, end: afterMod };
        }
      }
    }
  }

  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/paramExtractor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/paramExtractor.ts tests/integration/paramExtractor.test.ts
git commit -m "feat: add pg-promise parameter extractor with all bracket styles and modifiers"
```

---

### Task 9: SQL Analyzer (libpg-query wrapper)

**Files:**
- Create: `packages/core/src/sqlAnalyzer.ts`
- Create: `tests/integration/sqlAnalyzer.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/sqlAnalyzer.test.ts
import { describe, it, expect } from 'vitest';
import { parseSql } from '@ts-sqlx/core/src/sqlAnalyzer.js';

describe('parseSql', () => {
  it('parses valid SELECT', () => {
    const result = parseSql('SELECT id, name FROM users WHERE id = $1');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('parses valid INSERT', () => {
    const result = parseSql('INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id');
    expect(result.valid).toBe(true);
  });

  it('reports syntax error for typo', () => {
    const result = parseSql('SELEC * FROM users');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.message).toBeTruthy();
  });

  it('reports error for invalid syntax', () => {
    const result = parseSql('SELECT * FROM users WHERE AND id = 1');
    expect(result.valid).toBe(false);
  });

  it('reports error for empty query', () => {
    const result = parseSql('');
    expect(result.valid).toBe(false);
  });

  it('reports error for whitespace-only query', () => {
    const result = parseSql('   ');
    expect(result.valid).toBe(false);
  });

  it('parses valid UPDATE', () => {
    const result = parseSql('UPDATE users SET name = $1 WHERE id = $2');
    expect(result.valid).toBe(true);
  });

  it('parses valid DELETE', () => {
    const result = parseSql('DELETE FROM users WHERE id = $1');
    expect(result.valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/sqlAnalyzer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement SQL analyzer**

```typescript
// packages/core/src/sqlAnalyzer.ts
import { parseQuerySync } from 'libpg-query';

export interface ParseResult {
  valid: boolean;
  error?: {
    message: string;
    cursorPosition?: number;
  };
}

export function parseSql(sql: string): ParseResult {
  const trimmed = sql.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      error: { message: 'Empty query' },
    };
  }

  try {
    parseQuerySync(trimmed);
    return { valid: true };
  } catch (e: unknown) {
    const err = e as Error & { cursorPosition?: number };
    return {
      valid: false,
      error: {
        message: err.message,
        cursorPosition: err.cursorPosition,
      },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/sqlAnalyzer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sqlAnalyzer.ts tests/integration/sqlAnalyzer.test.ts
git commit -m "feat: add SQL analyzer using libpg-query"
```

---

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

---

## Chunk 3: TypeScript Adapter + Query Detector + Config

### Task 11: Config Parser

**Files:**
- Create: `packages/core/src/config.ts`
- Create: `tests/integration/config.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/config.test.ts
import { describe, it, expect } from 'vitest';
import { parseConfig, resolveConfig } from '@ts-sqlx/core/src/config.js';
import * as path from 'path';

describe('parseConfig', () => {
  it('parses a basic config', () => {
    const config = parseConfig(`
[database]
url = "$DATABASE_URL"

[paths]
include = ["src/**/*.ts"]
exclude = ["**/*.test.ts"]

[cache]
path = ".ts-sqlx/cache.db"

[diagnostics]
untyped = "warning"
unable_to_analyze = "info"
no_connection = "warning"
`);
    expect(config.database.url).toBe('$DATABASE_URL');
    expect(config.paths.include).toEqual(['src/**/*.ts']);
    expect(config.paths.exclude).toEqual(['**/*.test.ts']);
    expect(config.diagnostics.untyped).toBe('warning');
  });

  it('parses pglite config', () => {
    const config = parseConfig(`
[database]
pglite = true
schema = "schema.sql"
`);
    expect(config.database.pglite).toBe(true);
    expect(config.database.schema).toBe('schema.sql');
  });
});

describe('resolveConfig', () => {
  it('finds config in fixtures directory', () => {
    const fixturesDir = path.join(__dirname, '../fixtures');
    const config = resolveConfig(fixturesDir);
    expect(config).toBeDefined();
  });

  it('returns defaults when no config found', () => {
    const config = resolveConfig('/tmp/nonexistent');
    expect(config).toBeDefined();
    expect(config.paths.include).toEqual(['**/*.ts']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/config.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement config parser**

We'll use a simple TOML parser. Add `smol-toml` to core dependencies.

```typescript
// packages/core/src/config.ts
import { parse as parseToml } from 'smol-toml';
import * as fs from 'fs';
import * as path from 'path';

export interface TsSqlxConfig {
  database: {
    url?: string;
    pglite?: boolean;
    schema?: string;
  };
  paths: {
    include: string[];
    exclude: string[];
  };
  cache: {
    path: string;
  };
  diagnostics: {
    untyped: 'error' | 'warning' | 'info' | 'off';
    unable_to_analyze: 'error' | 'warning' | 'info' | 'off';
    no_connection: 'error' | 'warning' | 'info' | 'off';
  };
}

const DEFAULTS: TsSqlxConfig = {
  database: {},
  paths: {
    include: ['**/*.ts'],
    exclude: ['**/node_modules/**', '**/*.test.ts', '**/*.spec.ts'],
  },
  cache: {
    path: '.ts-sqlx/cache.db',
  },
  diagnostics: {
    untyped: 'warning',
    unable_to_analyze: 'info',
    no_connection: 'warning',
  },
};

export function parseConfig(tomlText: string): TsSqlxConfig {
  const parsed = parseToml(tomlText) as Record<string, unknown>;
  const db = (parsed.database ?? {}) as Record<string, unknown>;
  const paths = (parsed.paths ?? {}) as Record<string, unknown>;
  const cache = (parsed.cache ?? {}) as Record<string, unknown>;
  const diag = (parsed.diagnostics ?? {}) as Record<string, unknown>;

  return {
    database: {
      url: db.url as string | undefined,
      pglite: db.pglite as boolean | undefined,
      schema: db.schema as string | undefined,
    },
    paths: {
      include: (paths.include as string[]) ?? DEFAULTS.paths.include,
      exclude: (paths.exclude as string[]) ?? DEFAULTS.paths.exclude,
    },
    cache: {
      path: (cache.path as string) ?? DEFAULTS.cache.path,
    },
    diagnostics: {
      untyped: (diag.untyped as TsSqlxConfig['diagnostics']['untyped']) ?? DEFAULTS.diagnostics.untyped,
      unable_to_analyze: (diag.unable_to_analyze as TsSqlxConfig['diagnostics']['unable_to_analyze']) ?? DEFAULTS.diagnostics.unable_to_analyze,
      no_connection: (diag.no_connection as TsSqlxConfig['diagnostics']['no_connection']) ?? DEFAULTS.diagnostics.no_connection,
    },
  };
}

export function resolveConfig(startDir: string): TsSqlxConfig {
  // 1. Look for ts-sqlx.toml in directory tree
  let dir = startDir;
  while (true) {
    const configPath = path.join(dir, 'ts-sqlx.toml');
    if (fs.existsSync(configPath)) {
      const config = parseConfig(fs.readFileSync(configPath, 'utf8'));
      // Resolve $ENV_VAR syntax in database.url
      if (config.database.url?.startsWith('$')) {
        const envVar = config.database.url.slice(1);
        config.database.url = process.env[envVar] || config.database.url;
      }
      return config;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 2. Zero-config fallbacks (spec: Database Configuration Priority)
  const defaults = { ...DEFAULTS, database: { ...DEFAULTS.database } };

  // Check DATABASE_URL env var
  if (process.env.DATABASE_URL) {
    defaults.database.url = process.env.DATABASE_URL;
    return defaults;
  }

  // Check for schema.sql in project root → use PGLite
  const schemaPath = path.join(startDir, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    defaults.database.pglite = true;
    defaults.database.schema = 'schema.sql';
    return defaults;
  }

  return defaults;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config.ts tests/integration/config.test.ts
git commit -m "feat: add TOML config parser with defaults and resolution"
```

---

### Task 12: TypeScript Adapter Interface + ts-morph Implementation

**Files:**
- Create: `packages/core/src/adapters/typescript/types.ts`
- Create: `packages/core/src/adapters/typescript/tsMorphAdapter.ts`
- Create: `tests/integration/tsMorphAdapter.test.ts`

- [ ] **Step 1: Create TypeScript adapter interface**

Note: This interface differs from the spec's `TypeScriptAdapter`. The spec uses position-based `getCallExpression` (singular) and `isAssignableTo` on a `TSType` wrapper. In practice, it's more efficient to scan all call expressions in a file at once and use string-based type checking in the detector. The adapter remains pluggable for future TSGo swap.

```typescript
// packages/core/src/adapters/typescript/types.ts

export interface PropertyInfo {
  name: string;
  type: string;
  optional: boolean;
}

export interface ArgumentInfo {
  position: number;
  type: string;
  text: string;
}

export interface CallExpressionInfo {
  receiverType: string;
  methodName: string;
  typeArguments: string[];
  arguments: ArgumentInfo[];
  position: { start: number; end: number };
}

export interface ResolvedImport {
  filePath: string;
  exportName: string;
  type: string;
}

export interface TypeScriptAdapter {
  loadProject(tsConfigPath: string): void;
  updateFile(filePath: string, content: string): void;
  getProjectFiles(): string[];
  getTypeText(filePath: string, position: number): string | undefined;
  resolveStringLiteral(filePath: string, position: number): string | undefined;
  getCallExpressions(filePath: string): CallExpressionInfo[];
  getTypeProperties(typeText: string, filePath: string): PropertyInfo[];
  followImport(filePath: string, importName: string): ResolvedImport | undefined;
}
```

- [ ] **Step 2: Write the test**

```typescript
// tests/integration/tsMorphAdapter.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { TsMorphAdapter } from '@ts-sqlx/core/src/adapters/typescript/tsMorphAdapter.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('TsMorphAdapter', () => {
  let adapter: TsMorphAdapter;
  const fixturesDir = path.join(__dirname, '../fixtures');

  beforeAll(() => {
    adapter = new TsMorphAdapter();
    adapter.loadProject(path.join(fixturesDir, 'tsconfig.json'));
  });

  it('lists project files', () => {
    const files = adapter.getProjectFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.some(f => f.includes('param-types.ts'))).toBe(true);
  });

  it('resolves string literal from source', () => {
    // Create an in-memory file with a known SQL string
    adapter.updateFile(
      path.join(fixturesDir, '_test_resolve.ts'),
      'const sql = "SELECT id FROM users";'
    );
    // We need to find the string literal — this tests the basic resolve capability
    const resolved = adapter.resolveStringLiteral(
      path.join(fixturesDir, '_test_resolve.ts'),
      13 // position inside the string literal
    );
    expect(resolved).toBe('SELECT id FROM users');
  });

  it('gets call expressions from fixture file', () => {
    const calls = adapter.getCallExpressions(
      path.join(fixturesDir, 'diagnostics/ts001-syntax-errors.ts')
    );
    expect(calls.length).toBeGreaterThan(0);
    // All calls should be on db object
    expect(calls.some(c => c.methodName === 'one' || c.methodName === 'many')).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/tsMorphAdapter.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement ts-morph adapter**

```typescript
// packages/core/src/adapters/typescript/tsMorphAdapter.ts
import {
  Project,
  Node,
  SyntaxKind,
  type SourceFile,
} from 'ts-morph';
import type {
  TypeScriptAdapter,
  CallExpressionInfo,
  ArgumentInfo,
  PropertyInfo,
  ResolvedImport,
} from './types.js';

export class TsMorphAdapter implements TypeScriptAdapter {
  private project!: Project;

  loadProject(tsConfigPath: string): void {
    this.project = new Project({ tsConfigFilePath: tsConfigPath });
  }

  updateFile(filePath: string, content: string): void {
    const sourceFile = this.project.getSourceFile(filePath);
    if (sourceFile) {
      sourceFile.replaceWithText(content);
    } else {
      this.project.createSourceFile(filePath, content, { overwrite: true });
    }
  }

  getProjectFiles(): string[] {
    return this.project.getSourceFiles().map((sf) => sf.getFilePath());
  }

  getTypeText(filePath: string, position: number): string | undefined {
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return undefined;
    const node = sourceFile.getDescendantAtPos(position);
    if (!node) return undefined;
    return node.getType().getText();
  }

  resolveStringLiteral(filePath: string, position: number): string | undefined {
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return undefined;

    const node = sourceFile.getDescendantAtPos(position);
    if (!node) return undefined;

    // Direct string literal
    if (Node.isStringLiteral(node)) {
      return node.getLiteralValue();
    }

    // Template literal (no interpolation)
    if (Node.isNoSubstitutionTemplateLiteral(node)) {
      return node.getLiteralValue();
    }

    // Variable reference — try to resolve initializer
    if (Node.isIdentifier(node)) {
      const defs = node.getDefinitionNodes();
      for (const def of defs) {
        if (Node.isVariableDeclaration(def)) {
          const init = def.getInitializer();
          if (init && Node.isStringLiteral(init)) {
            return init.getLiteralValue();
          }
          if (init && Node.isNoSubstitutionTemplateLiteral(init)) {
            return init.getLiteralValue();
          }
        }
      }
    }

    return undefined;
  }

  getCallExpressions(filePath: string): CallExpressionInfo[] {
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return [];

    const results: CallExpressionInfo[] = [];

    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;

      const expr = node.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) return;

      const receiver = expr.getExpression();
      const methodName = expr.getName();

      const typeArgs = node.getTypeArguments().map((t) => t.getText());
      const args: ArgumentInfo[] = node.getArguments().map((arg) => ({
        position: arg.getStart(),
        type: arg.getType().getText(),
        text: arg.getText(),
      }));

      results.push({
        receiverType: receiver.getType().getText(),
        methodName,
        typeArguments: typeArgs,
        arguments: args,
        position: { start: node.getStart(), end: node.getEnd() },
      });
    });

    return results;
  }

  getTypeProperties(typeText: string, filePath: string): PropertyInfo[] {
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return [];

    // Create a temporary variable with the type to resolve it
    const tempFile = this.project.createSourceFile(
      '__ts_sqlx_temp__.ts',
      `import type {} from '${filePath}';\ntype __Resolve__ = ${typeText};`,
      { overwrite: true }
    );

    try {
      const typeAlias = tempFile.getTypeAlias('__Resolve__');
      if (!typeAlias) return [];

      const type = typeAlias.getType();
      return type.getProperties().map((prop) => {
        const decl = prop.getDeclarations()[0];
        return {
          name: prop.getName(),
          type: prop.getTypeAtLocation(tempFile).getText(),
          optional: decl ? Node.isPropertySignature(decl) && decl.hasQuestionToken() : false,
        };
      });
    } finally {
      this.project.removeSourceFile(tempFile);
    }
  }

  followImport(filePath: string, importName: string): ResolvedImport | undefined {
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return undefined;

    for (const importDecl of sourceFile.getImportDeclarations()) {
      for (const named of importDecl.getNamedImports()) {
        if (named.getName() === importName) {
          const symbol = named.getNameNode().getSymbol();
          if (!symbol) continue;
          const decls = symbol.getDeclarations();
          if (decls.length === 0) continue;
          const decl = decls[0];
          return {
            filePath: decl.getSourceFile().getFilePath(),
            exportName: importName,
            type: decl.getType().getText(),
          };
        }
      }
    }

    return undefined;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/tsMorphAdapter.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/adapters/typescript/types.ts packages/core/src/adapters/typescript/tsMorphAdapter.ts tests/integration/tsMorphAdapter.test.ts
git commit -m "feat: add TypeScript adapter interface and ts-morph implementation"
```

---

### Task 13: Query Detector

**Files:**
- Create: `packages/core/src/queryDetector.ts`
- Create: `tests/integration/queryDetector.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/queryDetector.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { QueryDetector } from '@ts-sqlx/core/src/queryDetector.js';
import { TsMorphAdapter } from '@ts-sqlx/core/src/adapters/typescript/tsMorphAdapter.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('QueryDetector', () => {
  let tsAdapter: TsMorphAdapter;
  let detector: QueryDetector;
  const fixturesDir = path.join(__dirname, '../fixtures');

  beforeAll(() => {
    tsAdapter = new TsMorphAdapter();
    tsAdapter.loadProject(path.join(fixturesDir, 'tsconfig.json'));
    detector = new QueryDetector(tsAdapter);
  });

  it('detects pg-promise db.one calls', () => {
    const queries = detector.detectQueries(
      path.join(fixturesDir, 'diagnostics/ts001-syntax-errors.ts')
    );
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.some(q => q.method === 'one')).toBe(true);
    expect(queries.every(q => q.library === 'pg-promise')).toBe(true);
  });

  it('extracts SQL text from string literals', () => {
    const queries = detector.detectQueries(
      path.join(fixturesDir, 'diagnostics/ts001-syntax-errors.ts')
    );
    // First query should have SQL text
    const withSql = queries.filter(q => q.sqlText !== undefined);
    expect(withSql.length).toBeGreaterThan(0);
  });

  it('extracts declared result type when present', () => {
    const queries = detector.detectQueries(
      path.join(fixturesDir, 'diagnostics/ts010-declared-vs-inferred.ts')
    );
    const withType = queries.filter(q => q.declaredResultType !== undefined);
    expect(withType.length).toBeGreaterThan(0);
  });

  it('returns undefined sqlText for dynamic queries', () => {
    const queries = detector.detectQueries(
      path.join(fixturesDir, 'diagnostics/ts008-unable-to-analyze.ts')
    );
    const dynamic = queries.filter(q => q.sqlText === undefined);
    expect(dynamic.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/queryDetector.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement query detector**

```typescript
// packages/core/src/queryDetector.ts
import type { TypeScriptAdapter, CallExpressionInfo } from './adapters/typescript/types.js';
import type { QueryCallInfo, QueryMethod, QueryLibrary } from './types.js';

const PG_PROMISE_METHODS: Set<string> = new Set([
  'one', 'oneOrNone', 'many', 'manyOrNone', 'any',
  'none', 'result', 'query', 'multi',
]);

const NODE_PG_METHODS: Set<string> = new Set(['query']);

export class QueryDetector {
  constructor(private tsAdapter: TypeScriptAdapter) {}

  detectQueries(filePath: string): QueryCallInfo[] {
    const calls = this.tsAdapter.getCallExpressions(filePath);
    const results: QueryCallInfo[] = [];

    for (const call of calls) {
      const info = this.classifyCall(call, filePath);
      if (info) results.push(info);
    }

    return results;
  }

  private classifyCall(
    call: CallExpressionInfo,
    filePath: string,
  ): QueryCallInfo | undefined {
    let library: QueryLibrary | undefined;

    if (PG_PROMISE_METHODS.has(call.methodName) && this.isPgPromiseType(call.receiverType)) {
      library = 'pg-promise';
    } else if (NODE_PG_METHODS.has(call.methodName) && this.isNodePostgresType(call.receiverType)) {
      library = 'node-postgres';
    }

    if (!library) return undefined;

    // Resolve SQL text from first argument using TypeScript adapter
    let sqlText: string | undefined;
    if (call.arguments.length > 0) {
      const sqlArg = call.arguments[0];
      // Use adapter to resolve: handles string literals, const variables, template literals
      sqlText = this.tsAdapter.resolveStringLiteral(filePath, sqlArg.position);
      // Fallback to naive parsing if adapter can't resolve (e.g., no source file loaded)
      if (sqlText === undefined) {
        sqlText = this.extractStringValue(sqlArg.text);
      }
    }

    return {
      library,
      method: call.methodName as QueryMethod,
      sqlArgIndex: 0,
      paramsArgIndex: call.arguments.length > 1 ? 1 : undefined,
      sqlText,
      declaredResultType: call.typeArguments.length > 0 ? call.typeArguments[0] : undefined,
      paramsType: call.arguments.length > 1 ? call.arguments[1].type : undefined,
      position: call.position,
    };
  }

  private isPgPromiseType(typeText: string): boolean {
    return /\b(IDatabase|ITask|IBaseProtocol)\b/.test(typeText) ||
           typeText.includes('pg-promise') ||
           // Match our test fixture IDatabase type
           typeText === 'IDatabase';
  }

  private isNodePostgresType(typeText: string): boolean {
    // Use word boundaries to avoid matching "pg" substring in unrelated types
    return /\b(Pool|PoolClient|Client)\b/.test(typeText) &&
           (typeText.includes('pg') || typeText.includes('node-postgres'));
  }

  private extractStringValue(text: string): string | undefined {
    // Direct string literal: "..." or '...'
    if ((text.startsWith('"') && text.endsWith('"')) ||
        (text.startsWith("'") && text.endsWith("'"))) {
      return text.slice(1, -1);
    }
    // Template literal without interpolation: `...`
    if (text.startsWith('`') && text.endsWith('`') && !text.includes('${')) {
      return text.slice(1, -1);
    }
    // Dynamic — cannot resolve
    return undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/queryDetector.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/queryDetector.ts tests/integration/queryDetector.test.ts
git commit -m "feat: add type-based query detector for pg-promise and node-postgres"
```

---

## Chunk 4: Type Comparator + Diagnostics

### Task 14: Type Comparator

**Files:**
- Create: `packages/core/src/typeComparator.ts`
- Create: `tests/integration/typeComparator.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/typeComparator.test.ts
import { describe, it, expect } from 'vitest';
import { compareTypes } from '@ts-sqlx/core/src/typeComparator.js';
import type { InferredColumn } from '@ts-sqlx/core/src/types.js';

describe('compareTypes', () => {
  it('accepts matching types', () => {
    const inferred: InferredColumn[] = [
      { name: 'id', pgType: 'uuid', tsType: 'string', nullable: false },
      { name: 'name', pgType: 'text', tsType: 'string', nullable: true },
    ];
    const declared = [
      { name: 'id', type: 'string', optional: false },
      { name: 'name', type: 'string | null', optional: false },
    ];
    const result = compareTypes(inferred, declared);
    expect(result.match).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it('detects missing property in declared type', () => {
    const inferred: InferredColumn[] = [
      { name: 'id', pgType: 'uuid', tsType: 'string', nullable: false },
      { name: 'name', pgType: 'text', tsType: 'string', nullable: false },
    ];
    const declared = [
      { name: 'id', type: 'string', optional: false },
    ];
    const result = compareTypes(inferred, declared);
    expect(result.match).toBe(false);
    expect(result.mismatches.some(m => m.includes("'name'"))).toBe(true);
  });

  it('detects extra property in declared type', () => {
    const inferred: InferredColumn[] = [
      { name: 'id', pgType: 'uuid', tsType: 'string', nullable: false },
    ];
    const declared = [
      { name: 'id', type: 'string', optional: false },
      { name: 'email', type: 'string', optional: false },
    ];
    const result = compareTypes(inferred, declared);
    expect(result.match).toBe(false);
    expect(result.mismatches.some(m => m.includes("'email'"))).toBe(true);
  });

  it('detects type mismatch', () => {
    const inferred: InferredColumn[] = [
      { name: 'id', pgType: 'uuid', tsType: 'string', nullable: false },
    ];
    const declared = [
      { name: 'id', type: 'number', optional: false },
    ];
    const result = compareTypes(inferred, declared);
    expect(result.match).toBe(false);
    expect(result.mismatches.some(m => m.includes('type mismatch'))).toBe(true);
  });

  it('accepts nullable column with union type', () => {
    const inferred: InferredColumn[] = [
      { name: 'name', pgType: 'text', tsType: 'string', nullable: true },
    ];
    const declared = [
      { name: 'name', type: 'string | null', optional: false },
    ];
    const result = compareTypes(inferred, declared);
    expect(result.match).toBe(true);
  });

  it('detects missing null in nullable column', () => {
    const inferred: InferredColumn[] = [
      { name: 'name', pgType: 'text', tsType: 'string', nullable: true },
    ];
    const declared = [
      { name: 'name', type: 'string', optional: false },
    ];
    const result = compareTypes(inferred, declared);
    expect(result.match).toBe(false);
    expect(result.mismatches.some(m => m.includes('nullable'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/typeComparator.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement type comparator**

```typescript
// packages/core/src/typeComparator.ts
import type { InferredColumn } from './types.js';

export interface DeclaredProperty {
  name: string;
  type: string;
  optional: boolean;
}

export interface CompareResult {
  match: boolean;
  mismatches: string[];
}

export function compareTypes(
  inferred: InferredColumn[],
  declared: DeclaredProperty[],
): CompareResult {
  const mismatches: string[] = [];
  const inferredMap = new Map(inferred.map((c) => [c.name, c]));
  const declaredMap = new Map(declared.map((p) => [p.name, p]));

  // Check for properties in inferred but not in declared
  for (const col of inferred) {
    if (!declaredMap.has(col.name)) {
      mismatches.push(`missing property '${col.name}' in declared type`);
    }
  }

  // Check for properties in declared but not in inferred
  for (const prop of declared) {
    if (!inferredMap.has(prop.name)) {
      mismatches.push(`property '${prop.name}' not in query result`);
    }
  }

  // Check type compatibility for shared properties
  for (const col of inferred) {
    const prop = declaredMap.get(col.name);
    if (!prop) continue;

    const expectedType = col.nullable ? `${col.tsType} | null` : col.tsType;

    if (!isTypeCompatible(expectedType, prop.type, col.nullable)) {
      if (col.nullable && !typeIncludesNull(prop.type)) {
        mismatches.push(
          `property '${col.name}' is nullable but declared as '${prop.type}' (expected '${expectedType}')`
        );
      } else {
        mismatches.push(
          `property '${col.name}': type mismatch — inferred '${expectedType}', declared '${prop.type}'`
        );
      }
    }
  }

  return { match: mismatches.length === 0, mismatches };
}

function isTypeCompatible(
  inferred: string,
  declared: string,
  nullable: boolean,
): boolean {
  const normalizedInferred = normalizeType(inferred);
  const normalizedDeclared = normalizeType(declared);

  if (normalizedInferred === normalizedDeclared) return true;

  // Check if nullable column's base type matches
  if (nullable) {
    const declaredParts = normalizedDeclared.split('|').map((s) => s.trim());
    const baseType = normalizeType(inferred.replace('| null', '').trim());
    return declaredParts.includes(baseType) && declaredParts.includes('null');
  }

  return false;
}

function typeIncludesNull(typeStr: string): boolean {
  return typeStr.split('|').some((part) => part.trim() === 'null');
}

function normalizeType(t: string): string {
  return t
    .split('|')
    .map((s) => s.trim())
    .sort()
    .join(' | ');
}

export function generateTypeAnnotation(columns: InferredColumn[]): string {
  const props = columns.map((col) => {
    const type = col.nullable ? `${col.tsType} | null` : col.tsType;
    return `${col.name}: ${type}`;
  });
  return `{ ${props.join('; ')} }`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/typeComparator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/typeComparator.ts tests/integration/typeComparator.test.ts
git commit -m "feat: add type comparator for inferred vs declared types"
```

---

### Task 15: Diagnostics Engine

**Files:**
- Create: `packages/core/src/diagnostics.ts`
- Create: `tests/integration/diagnostics.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/diagnostics.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DiagnosticsEngine } from '@ts-sqlx/core/src/diagnostics.js';
import { PGLiteAdapter } from '@ts-sqlx/core/src/adapters/database/pgliteAdapter.js';
import { TsMorphAdapter } from '@ts-sqlx/core/src/adapters/typescript/tsMorphAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('DiagnosticsEngine', () => {
  let dbAdapter: PGLiteAdapter;
  let tsAdapter: TsMorphAdapter;
  let engine: DiagnosticsEngine;
  const fixturesDir = path.join(__dirname, '../fixtures');

  beforeAll(async () => {
    dbAdapter = await PGLiteAdapter.create();
    const schema = fs.readFileSync(path.join(fixturesDir, 'schema.sql'), 'utf8');
    await dbAdapter.executeSchema(schema);

    tsAdapter = new TsMorphAdapter();
    tsAdapter.loadProject(path.join(fixturesDir, 'tsconfig.json'));

    engine = new DiagnosticsEngine(dbAdapter, tsAdapter);
  });

  afterAll(async () => {
    await dbAdapter.disconnect();
  });

  it('reports TS001 for SQL syntax errors', async () => {
    const diags = await engine.analyze(
      path.join(fixturesDir, 'diagnostics/ts001-syntax-errors.ts')
    );
    const ts001 = diags.filter(d => d.code === 'TS001');
    expect(ts001.length).toBeGreaterThan(0);
  });

  it('reports TS002 for unknown tables', async () => {
    const diags = await engine.analyze(
      path.join(fixturesDir, 'diagnostics/ts002-unknown-table.ts')
    );
    const ts002 = diags.filter(d => d.code === 'TS002');
    expect(ts002.length).toBeGreaterThan(0);
  });

  it('reports TS007 for missing type annotations', async () => {
    const diags = await engine.analyze(
      path.join(fixturesDir, 'diagnostics/ts007-no-type-annotation.ts')
    );
    const ts007 = diags.filter(d => d.code === 'TS007');
    expect(ts007.length).toBeGreaterThan(0);
  });

  it('reports TS008 for dynamic queries', async () => {
    const diags = await engine.analyze(
      path.join(fixturesDir, 'diagnostics/ts008-unable-to-analyze.ts')
    );
    const ts008 = diags.filter(d => d.code === 'TS008');
    expect(ts008.length).toBeGreaterThan(0);
  });

  it('produces no errors for valid queries with correct types', async () => {
    // Create a test file with a valid query
    const testFile = path.join(fixturesDir, '_test_valid.ts');
    tsAdapter.updateFile(testFile, `
import { db } from './db';
const result = db.one<{ id: string; email: string }>("SELECT id, email FROM users WHERE id = $1", ["test"]);
`);
    const diags = await engine.analyze(testFile);
    const errors = diags.filter(d => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/diagnostics.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement diagnostics engine**

```typescript
// packages/core/src/diagnostics.ts
import type { Diagnostic, DiagnosticCode, DiagnosticSeverity, QueryCallInfo } from './types.js';
import type { DatabaseAdapter } from './adapters/database/types.js';
import type { TypeScriptAdapter } from './adapters/typescript/types.js';
import { QueryDetector } from './queryDetector.js';
import { extractParams } from './paramExtractor.js';
import { parseSql } from './sqlAnalyzer.js';
import { DbInferrer } from './dbInferrer.js';
import { compareTypes, generateTypeAnnotation } from './typeComparator.js';
import type { DeclaredProperty } from './typeComparator.js';

export class DiagnosticsEngine {
  private queryDetector: QueryDetector;
  private inferrer: DbInferrer;

  constructor(
    private dbAdapter: DatabaseAdapter | null,
    private tsAdapter: TypeScriptAdapter,
  ) {
    this.queryDetector = new QueryDetector(tsAdapter);
    this.inferrer = dbAdapter ? new DbInferrer(dbAdapter) : null!;
  }

  async analyze(filePath: string): Promise<Diagnostic[]> {
    const diagnostics: Diagnostic[] = [];
    const queries = this.queryDetector.detectQueries(filePath);

    for (const query of queries) {
      const diags = await this.analyzeQuery(query, filePath);
      diagnostics.push(...diags);
    }

    return diagnostics;
  }

  private async analyzeQuery(
    query: QueryCallInfo,
    filePath: string,
  ): Promise<Diagnostic[]> {
    const diagnostics: Diagnostic[] = [];

    // TS008: Unable to analyze dynamic SQL
    if (query.sqlText === undefined) {
      diagnostics.push({
        code: 'TS008',
        severity: 'info',
        message: 'Unable to analyze: dynamic SQL',
        range: query.position,
      });
      return diagnostics;
    }

    // TS007: No type annotation
    if (!query.declaredResultType && query.method !== 'none') {
      diagnostics.push({
        code: 'TS007',
        severity: 'warning',
        message: 'Query has no type annotation',
        range: query.position,
      });
    }

    // Extract and normalize parameters
    const extracted = extractParams(query.sqlText);

    // TS001: Param syntax errors
    for (const err of extracted.errors) {
      diagnostics.push({
        code: 'TS001',
        severity: 'error',
        message: `SQL parameter syntax error: ${err.message}`,
        range: query.position,
      });
    }

    // TS001: SQL syntax validation
    const parseResult = parseSql(extracted.normalized);
    if (!parseResult.valid) {
      diagnostics.push({
        code: 'TS001',
        severity: 'error',
        message: `SQL syntax error: ${parseResult.error!.message}`,
        range: query.position,
      });
      return diagnostics; // Don't proceed if SQL is invalid
    }

    // TS009: No database connection
    if (!this.dbAdapter || !this.dbAdapter.isConnected()) {
      diagnostics.push({
        code: 'TS009',
        severity: 'warning',
        message: 'No database connection — cannot infer types',
        range: query.position,
      });
      return diagnostics;
    }

    // Infer types from database
    try {
      const inferred = await this.inferrer.infer(extracted.normalized);

      // TS005: Wrong parameter count
      const uniqueParamNumbers = new Set(extracted.params.map(p => p.number));
      const sqlParamCount = uniqueParamNumbers.size;
      const expectedParamCount = inferred.params.length;

      if (query.paramsArgIndex !== undefined && query.paramsType) {
        // Has params argument — check if it's an array and validate length
        // For array params: check if the array literal has the right number of elements
        const arrayMatch = query.paramsType.match(/^\[([^\]]*)\]$/);
        if (arrayMatch) {
          const elements = arrayMatch[1].split(',').filter(s => s.trim()).length;
          if (elements !== expectedParamCount) {
            diagnostics.push({
              code: 'TS005',
              severity: 'error',
              message: `Expected ${expectedParamCount} parameter(s), got ${elements}`,
              range: query.position,
            });
          }
        }
        // For named params: TS006 handles missing properties (below)
      } else if (expectedParamCount > 0 && query.paramsArgIndex === undefined) {
        diagnostics.push({
          code: 'TS005',
          severity: 'error',
          message: `Expected ${expectedParamCount} parameter(s), got 0`,
          range: query.position,
        });
      }

      // TS010: Declared type doesn't match inferred
      if (query.declaredResultType) {
        const declaredProps = this.tsAdapter.getTypeProperties(
          query.declaredResultType,
          filePath,
        );
        if (declaredProps.length > 0) {
          const comparison = compareTypes(inferred.columns, declaredProps);
          if (!comparison.match) {
            for (const mismatch of comparison.mismatches) {
              diagnostics.push({
                code: 'TS010',
                severity: 'error',
                message: mismatch,
                range: query.position,
              });
            }
          }
        }
      }
    } catch (e: unknown) {
      // Database errors likely indicate TS002/TS003/TS004
      const msg = (e as Error).message;
      if (/relation .* does not exist/i.test(msg)) {
        const match = msg.match(/relation "([^"]+)"/);
        diagnostics.push({
          code: 'TS002',
          severity: 'error',
          message: match ? `Unknown table: ${match[1]}` : `Unknown table: ${msg}`,
          range: query.position,
        });
      } else if (/column .* does not exist/i.test(msg)) {
        const match = msg.match(/column "([^"]+)"/);
        diagnostics.push({
          code: 'TS003',
          severity: 'error',
          message: match ? `Unknown column: ${match[1]}` : `Unknown column: ${msg}`,
          range: query.position,
        });
      } else if (/type/i.test(msg)) {
        diagnostics.push({
          code: 'TS004',
          severity: 'error',
          message: `Type mismatch in SQL: ${msg}`,
          range: query.position,
        });
      } else {
        diagnostics.push({
          code: 'TS001',
          severity: 'error',
          message: `SQL error: ${msg}`,
          range: query.position,
        });
      }
    }

    return diagnostics;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/diagnostics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/diagnostics.ts tests/integration/diagnostics.test.ts
git commit -m "feat: add diagnostics engine with TS001-TS010 support"
```

---

### Task 16: Fixture-Based Integration Tests

Run the full fixture test suite against all diagnostic fixtures. This validates the end-to-end pipeline: query detection → param extraction → SQL parsing → DB inference → type comparison → diagnostics.

**Files:**
- Create: `tests/integration/fixtures.test.ts`

- [ ] **Step 1: Write the fixture integration test**

```typescript
// tests/integration/fixtures.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DiagnosticsEngine } from '@ts-sqlx/core/src/diagnostics.js';
import { PGLiteAdapter } from '@ts-sqlx/core/src/adapters/database/pgliteAdapter.js';
import { TsMorphAdapter } from '@ts-sqlx/core/src/adapters/typescript/tsMorphAdapter.js';
import { parseFixtureExpectations, matchDiagnostics } from '@ts-sqlx/test-utils/src/fixtureRunner.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('fixture tests', () => {
  let dbAdapter: PGLiteAdapter;
  let tsAdapter: TsMorphAdapter;
  let engine: DiagnosticsEngine;
  const fixturesDir = path.join(__dirname, '../fixtures');

  beforeAll(async () => {
    dbAdapter = await PGLiteAdapter.create();
    const schema = fs.readFileSync(path.join(fixturesDir, 'schema.sql'), 'utf8');
    await dbAdapter.executeSchema(schema);

    tsAdapter = new TsMorphAdapter();
    tsAdapter.loadProject(path.join(fixturesDir, 'tsconfig.json'));

    engine = new DiagnosticsEngine(dbAdapter, tsAdapter);
  });

  afterAll(async () => {
    await dbAdapter.disconnect();
  });

  const diagnosticsFixtures = [
    'diagnostics/ts001-syntax-errors.ts',
    'diagnostics/ts002-unknown-table.ts',
    'diagnostics/ts003-unknown-column.ts',
    'diagnostics/ts004-type-mismatch.ts',
    'diagnostics/ts005-wrong-param-count.ts',
    'diagnostics/ts006-missing-param-property.ts',
    'diagnostics/ts007-no-type-annotation.ts',
    'diagnostics/ts008-unable-to-analyze.ts',
    'diagnostics/ts010-declared-vs-inferred.ts',
  ];

  // ts009 needs special handling — requires engine with no DB connection
  it('passes fixture: diagnostics/ts009-no-connection.ts', async () => {
    const noDbEngine = new DiagnosticsEngine(null, tsAdapter);
    const filePath = path.join(fixturesDir, 'diagnostics/ts009-no-connection.ts');
    const source = fs.readFileSync(filePath, 'utf8');
    const expectations = parseFixtureExpectations(source);
    const diagnostics = await noDbEngine.analyze(filePath);

    const result = matchDiagnostics(expectations, diagnostics, source);
    if (result.errors.length > 0) {
      const errorDetails = result.errors
        .map(e => `  Line ${e.line}: expected ${e.expected}, got ${e.actual ?? 'nothing'} ${e.message ? `(${e.message})` : ''}`)
        .join('\n');
      expect.fail(
        `${result.failed} expectation(s) failed in ts009:\n${errorDetails}`
      );
    }
  });

  for (const fixture of diagnosticsFixtures) {
    it(`passes fixture: ${fixture}`, async () => {
      const filePath = path.join(fixturesDir, fixture);
      const source = fs.readFileSync(filePath, 'utf8');
      const expectations = parseFixtureExpectations(source);
      const diagnostics = await engine.analyze(filePath);

      const result = matchDiagnostics(expectations, diagnostics, source);

      if (result.errors.length > 0) {
        const errorDetails = result.errors
          .map(e => `  Line ${e.line}: expected ${e.expected}, got ${e.actual ?? 'nothing'} ${e.message ? `(${e.message})` : ''}`)
          .join('\n');
        expect.fail(
          `${result.failed} expectation(s) failed in ${fixture}:\n${errorDetails}`
        );
      }
    });
  }
});
```

- [ ] **Step 2: Run tests — expect some failures initially**

Run: `pnpm vitest run tests/integration/fixtures.test.ts`
Expected: Some fixtures may fail as the diagnostics engine may need refinement. Use failures to iterate.

- [ ] **Step 3: Fix any failures, iterate**

Adjust `diagnostics.ts`, `queryDetector.ts`, or other components based on specific fixture failures. The red-green cycle here is: read failure → understand gap → fix implementation → re-run.

- [ ] **Step 4: Commit when all diagnostic fixtures pass**

```bash
git add tests/integration/fixtures.test.ts
git commit -m "feat: add fixture-based integration tests for all diagnostics"
```

---

## Chunk 5: Cache + Language Server + CLI

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

---

### Task 18: Language Server Package Setup

**Files:**
- Create: `packages/language-server/package.json`
- Create: `packages/language-server/tsconfig.json`
- Create: `packages/language-server/src/server.ts`
- Create: `packages/language-server/src/index.ts`

- [ ] **Step 1: Create `packages/language-server/package.json`**

```json
{
  "name": "@ts-sqlx/language-server",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "ts-sqlx-lsp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@ts-sqlx/core": "workspace:*",
    "vscode-languageserver": "^10.0.0",
    "vscode-languageserver-textdocument": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create `packages/language-server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Implement LSP server**

```typescript
// packages/language-server/src/server.ts
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
  DiagnosticSeverity as LSPSeverity,
  type Diagnostic as LSPDiagnostic,
  CodeActionKind,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DiagnosticsEngine } from '@ts-sqlx/core/src/diagnostics.js';
import { PGLiteAdapter } from '@ts-sqlx/core/src/adapters/database/pgliteAdapter.js';
import { TsMorphAdapter } from '@ts-sqlx/core/src/adapters/typescript/tsMorphAdapter.js';
import { resolveConfig } from '@ts-sqlx/core/src/config.js';
import type { Diagnostic, DiagnosticSeverity } from '@ts-sqlx/core/src/types.js';
import * as fs from 'fs';
import * as path from 'path';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let engine: DiagnosticsEngine | null = null;

connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
  const rootUri = params.rootUri;
  if (rootUri) {
    const rootPath = new URL(rootUri).pathname;
    const config = resolveConfig(rootPath);

    // Set up TypeScript adapter
    const tsAdapter = new TsMorphAdapter();
    const tsConfigPath = path.join(rootPath, 'tsconfig.json');
    if (fs.existsSync(tsConfigPath)) {
      tsAdapter.loadProject(tsConfigPath);
    }

    // Set up database adapter
    let dbAdapter = null;
    if (config.database.pglite && config.database.schema) {
      const adapter = await PGLiteAdapter.create();
      const schemaPath = path.resolve(rootPath, config.database.schema);
      if (fs.existsSync(schemaPath)) {
        await adapter.executeSchema(fs.readFileSync(schemaPath, 'utf8'));
      }
      dbAdapter = adapter;
    } else if (config.database.url) {
      // Real Postgres adapter would go here
      // For now, only PGLite is implemented
    }

    engine = new DiagnosticsEngine(dbAdapter, tsAdapter);
  }

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix],
      },
    },
  };
});

documents.onDidChangeContent(async (change) => {
  if (!engine) return;

  const uri = change.document.uri;
  const filePath = new URL(uri).pathname;

  if (!filePath.endsWith('.ts')) return;

  try {
    const text = change.document.getText();
    const diagnostics = await engine.analyze(filePath);
    connection.sendDiagnostics({
      uri,
      diagnostics: diagnostics.map(d => toLspDiagnostic(d, text)),
    });
  } catch {
    // Silently ignore analysis errors
  }
});

// Convert byte offset to line/character position
function offsetToPosition(text: string, offset: number): { line: number; character: number } {
  let line = 0;
  let lastNewline = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      lastNewline = i;
    }
  }
  return { line, character: offset - lastNewline - 1 };
}

function toLspDiagnostic(d: Diagnostic, documentText: string): LSPDiagnostic {
  return {
    range: {
      start: offsetToPosition(documentText, d.range.start),
      end: offsetToPosition(documentText, d.range.end),
    },
    severity: toLspSeverity(d.severity),
    code: d.code,
    source: 'ts-sqlx',
    message: d.message,
  };
}

function toLspSeverity(s: DiagnosticSeverity): LSPSeverity {
  switch (s) {
    case 'error': return LSPSeverity.Error;
    case 'warning': return LSPSeverity.Warning;
    case 'info': return LSPSeverity.Information;
  }
}

// Code action handler
connection.onCodeAction((params) => {
  if (!engine) return [];
  // Code actions are generated alongside diagnostics —
  // for now return empty; Task 19 wires this up with the codeActions module
  return [];
});

documents.listen(connection);
connection.listen();
```

- [ ] **Step 4: Create entry point**

```typescript
// packages/language-server/src/index.ts
#!/usr/bin/env node
import './server.js';
```

- [ ] **Step 5: Install deps and verify build**

Run: `pnpm install && pnpm -r build`
Expected: No build errors.

- [ ] **Step 6: Commit**

```bash
git add packages/language-server/
git commit -m "feat: add language server with LSP diagnostics"
```

---

### Task 19: Code Actions

**Files:**
- Create: `packages/language-server/src/codeActions.ts`
- Modify: `packages/language-server/src/server.ts` (add code action handler)

- [ ] **Step 1: Implement code actions**

```typescript
// packages/language-server/src/codeActions.ts
import type {
  CodeAction,
  CodeActionParams,
  TextEdit,
} from 'vscode-languageserver/node.js';
import { CodeActionKind } from 'vscode-languageserver/node.js';

export function createAddTypeAnnotationAction(
  uri: string,
  generatedType: string,
  insertPosition: { line: number; character: number },
): CodeAction {
  return {
    title: 'Add inferred type annotation',
    kind: CodeActionKind.QuickFix,
    edit: {
      changes: {
        [uri]: [
          {
            range: {
              start: insertPosition,
              end: insertPosition,
            },
            newText: `<${generatedType}>`,
          },
        ],
      },
    },
  };
}

export function createUpdateTypeAnnotationAction(
  uri: string,
  generatedType: string,
  replaceRange: { start: { line: number; character: number }; end: { line: number; character: number } },
): CodeAction {
  return {
    title: 'Update type annotation to match query',
    kind: CodeActionKind.QuickFix,
    edit: {
      changes: {
        [uri]: [
          {
            range: replaceRange,
            newText: generatedType,
          },
        ],
      },
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/language-server/src/codeActions.ts
git commit -m "feat: add code actions for type annotation generation"
```

---

### Task 20: CLI Package

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/commands/check.ts`
- Create: `packages/cli/src/commands/generate.ts`
- Create: `packages/cli/src/commands/cache.ts`

- [ ] **Step 1: Create `packages/cli/package.json`**

```json
{
  "name": "@ts-sqlx/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "ts-sqlx": "dist/index.js"
  },
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@ts-sqlx/core": "workspace:*",
    "cmd-ts": "^0.13.0",
    "glob": "^11.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create `packages/cli/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Implement check command**

```typescript
// packages/cli/src/commands/check.ts
import { command, positional, flag, string, optional } from 'cmd-ts';
import { DiagnosticsEngine } from '@ts-sqlx/core/src/diagnostics.js';
import { PGLiteAdapter } from '@ts-sqlx/core/src/adapters/database/pgliteAdapter.js';
import { TsMorphAdapter } from '@ts-sqlx/core/src/adapters/typescript/tsMorphAdapter.js';
import { resolveConfig } from '@ts-sqlx/core/src/config.js';
import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';

export const checkCommand = command({
  name: 'check',
  description: 'Check SQL queries for errors',
  args: {
    pattern: positional({ type: optional(string), displayName: 'glob' }),
    staged: flag({ long: 'staged', description: 'Check staged files only' }),
    changed: flag({ long: 'changed', description: 'Check changed files' }),
  },
  async handler({ pattern, staged, changed }) {
    const cwd = process.cwd();
    const config = resolveConfig(cwd);

    // Set up TypeScript adapter
    const tsAdapter = new TsMorphAdapter();
    const tsConfigPath = path.join(cwd, 'tsconfig.json');
    if (fs.existsSync(tsConfigPath)) {
      tsAdapter.loadProject(tsConfigPath);
    }

    // Set up database adapter
    let dbAdapter = null;
    if (config.database.pglite && config.database.schema) {
      const adapter = await PGLiteAdapter.create();
      const schemaPath = path.resolve(cwd, config.database.schema);
      if (fs.existsSync(schemaPath)) {
        await adapter.executeSchema(fs.readFileSync(schemaPath, 'utf8'));
      }
      dbAdapter = adapter;
    }

    const engine = new DiagnosticsEngine(dbAdapter, tsAdapter);

    // Resolve files
    const patterns = pattern ? [pattern] : config.paths.include;
    const files = await glob(patterns, {
      cwd,
      ignore: config.paths.exclude,
      absolute: true,
    });

    let totalErrors = 0;
    for (const file of files) {
      if (!file.endsWith('.ts')) continue;
      const diagnostics = await engine.analyze(file);

      for (const d of diagnostics) {
        const relPath = path.relative(cwd, file);
        console.log(`${relPath}: ${d.code} ${d.severity}: ${d.message}`);
      }

      totalErrors += diagnostics.filter(d => d.severity === 'error').length;
    }

    if (dbAdapter) await dbAdapter.disconnect();

    if (totalErrors > 0) {
      console.log(`\n${totalErrors} error(s) found.`);
      process.exit(1);
    } else {
      console.log('No errors found.');
    }
  },
});
```

- [ ] **Step 4: Implement cache command**

```typescript
// packages/cli/src/commands/cache.ts
import { command, subcommands } from 'cmd-ts';
import { TypeCache } from '@ts-sqlx/core/src/cache.js';
import { resolveConfig } from '@ts-sqlx/core/src/config.js';
import * as path from 'path';

const statusCommand = command({
  name: 'status',
  description: 'Show cache status',
  args: {},
  handler() {
    const config = resolveConfig(process.cwd());
    const cachePath = path.resolve(process.cwd(), config.cache.path);
    const cache = new TypeCache(cachePath);
    const stats = cache.stats();
    console.log(`Cache: ${cachePath}`);
    console.log(`Entries: ${stats.entries}`);
    cache.close();
  },
});

const clearCommand = command({
  name: 'clear',
  description: 'Clear type cache',
  args: {},
  handler() {
    const config = resolveConfig(process.cwd());
    const cachePath = path.resolve(process.cwd(), config.cache.path);
    const cache = new TypeCache(cachePath);
    cache.clear();
    console.log('Cache cleared.');
    cache.close();
  },
});

export const cacheCommand = subcommands({
  name: 'cache',
  cmds: { status: statusCommand, clear: clearCommand },
});
```

- [ ] **Step 5: Implement generate command (deferred — v1.1)**

The `generate` command requires file rewriting with code actions, which is complex. It's deferred to v1.1 per spec priorities. The stub exits with a clear message.

```typescript
// packages/cli/src/commands/generate.ts
import { command, positional, string, optional } from 'cmd-ts';

export const generateCommand = command({
  name: 'generate',
  description: 'Generate/update type annotations (coming in v1.1)',
  args: {
    pattern: positional({ type: optional(string), displayName: 'glob' }),
  },
  async handler({ pattern }) {
    console.error('ts-sqlx generate is not yet implemented. Use the LSP code actions in your editor for now.');
    process.exit(2);
  },
});
```

- [ ] **Step 6: Create CLI entry point**

```typescript
// packages/cli/src/index.ts
#!/usr/bin/env node
import { run, subcommands } from 'cmd-ts';
import { checkCommand } from './commands/check.js';
import { generateCommand } from './commands/generate.js';
import { cacheCommand } from './commands/cache.js';

const app = subcommands({
  name: 'ts-sqlx',
  cmds: {
    check: checkCommand,
    generate: generateCommand,
    cache: cacheCommand,
  },
});

run(app, process.argv.slice(2));
```

- [ ] **Step 7: Install deps and verify build**

Run: `pnpm install && pnpm -r build`
Expected: No build errors.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/
git commit -m "feat: add CLI with check, generate, and cache commands"
```

---

### Task 21: Update Core Exports and Final Wiring

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Update core index with all exports**

```typescript
// packages/core/src/index.ts
export * from './types.js';
export * from './adapters/database/types.js';
export * from './adapters/database/oidMap.js';
export { PGLiteAdapter } from './adapters/database/pgliteAdapter.js';
export * from './adapters/typescript/types.js';
export { TsMorphAdapter } from './adapters/typescript/tsMorphAdapter.js';
export { extractParams } from './paramExtractor.js';
export { parseSql } from './sqlAnalyzer.js';
export { QueryDetector } from './queryDetector.js';
export { DbInferrer } from './dbInferrer.js';
export { compareTypes, generateTypeAnnotation } from './typeComparator.js';
export { DiagnosticsEngine } from './diagnostics.js';
export { TypeCache } from './cache.js';
export { parseConfig, resolveConfig } from './config.js';
```

- [ ] **Step 2: Run all tests**

Run: `pnpm vitest run`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat: update core exports with all public API"
```

---

### Task 22: Return Types Fixture Tests

**Files:**
- Create: `tests/integration/returnTypes.test.ts`

- [ ] **Step 1: Write fixture tests for return type inference**

```typescript
// tests/integration/returnTypes.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@ts-sqlx/core/src/dbInferrer.js';
import { PGLiteAdapter } from '@ts-sqlx/core/src/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('return type inference', () => {
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

  describe('scalar types', () => {
    it('maps integer types', async () => {
      const r = await inferrer.infer('SELECT small_int, regular_int, big_int FROM type_showcase');
      expect(r.columns[0].tsType).toBe('number');  // smallint
      expect(r.columns[1].tsType).toBe('number');  // int
      expect(r.columns[2].tsType).toBe('string');   // bigint
    });

    it('maps float types', async () => {
      const r = await inferrer.infer('SELECT real_num, double_num, numeric_val FROM type_showcase');
      expect(r.columns[0].tsType).toBe('number');
      expect(r.columns[1].tsType).toBe('number');
      expect(r.columns[2].tsType).toBe('string');
    });

    it('maps text types', async () => {
      const r = await inferrer.infer('SELECT char_col, varchar_col, text_col FROM type_showcase');
      expect(r.columns[0].tsType).toBe('string');
      expect(r.columns[1].tsType).toBe('string');
      expect(r.columns[2].tsType).toBe('string');
    });

    it('maps boolean', async () => {
      const r = await inferrer.infer('SELECT bool_col FROM type_showcase');
      expect(r.columns[0].tsType).toBe('boolean');
    });

    it('maps uuid', async () => {
      const r = await inferrer.infer('SELECT uuid_col FROM type_showcase');
      expect(r.columns[0].tsType).toBe('string');
    });

    it('maps date/time types', async () => {
      const r = await inferrer.infer(
        'SELECT date_col, timestamp_col, timestamptz_col, time_col, interval_col FROM type_showcase'
      );
      expect(r.columns[0].tsType).toBe('Date');
      expect(r.columns[1].tsType).toBe('Date');
      expect(r.columns[2].tsType).toBe('Date');
      expect(r.columns[3].tsType).toBe('string');
      expect(r.columns[4].tsType).toBe('string');
    });

    it('maps json/jsonb to unknown', async () => {
      const r = await inferrer.infer('SELECT json_col, jsonb_col FROM type_showcase');
      expect(r.columns[0].tsType).toBe('unknown');
      expect(r.columns[1].tsType).toBe('unknown');
    });

    it('maps bytea to Buffer', async () => {
      const r = await inferrer.infer('SELECT bytes FROM type_showcase');
      expect(r.columns[0].tsType).toBe('Buffer');
    });
  });

  describe('array types', () => {
    it('maps integer arrays', async () => {
      const r = await inferrer.infer('SELECT int_array FROM type_showcase');
      expect(r.columns[0].tsType).toBe('number[]');
    });

    it('maps text arrays', async () => {
      const r = await inferrer.infer('SELECT text_array FROM type_showcase');
      expect(r.columns[0].tsType).toBe('string[]');
    });
  });

  describe('expressions', () => {
    it('infers COUNT as string (bigint)', async () => {
      const r = await inferrer.infer('SELECT COUNT(*) as cnt FROM users');
      expect(r.columns[0].tsType).toBe('string');
    });

    it('infers aliased columns', async () => {
      const r = await inferrer.infer('SELECT id AS user_id FROM users');
      expect(r.columns[0].name).toBe('user_id');
    });
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run tests/integration/returnTypes.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/returnTypes.test.ts
git commit -m "test: add return type inference integration tests"
```

---

### Task 23: PGP Params Fixture Tests

**Files:**
- Create: `tests/integration/pgpParams.test.ts`

- [ ] **Step 1: Write param extraction tests from fixtures**

```typescript
// tests/integration/pgpParams.test.ts
import { describe, it, expect } from 'vitest';
import { extractParams } from '@ts-sqlx/core/src/paramExtractor.js';

describe('pgp-params fixture coverage', () => {
  describe('bracket styles', () => {
    it('curly braces: ${name}', () => {
      const r = extractParams('SELECT * FROM users WHERE name = ${name}');
      expect(r.params[0].name).toBe('name');
      expect(r.normalized).toContain('$1');
    });

    it('parentheses: $(name)', () => {
      const r = extractParams('SELECT * FROM users WHERE name = $(name)');
      expect(r.params[0].name).toBe('name');
    });

    it('angle brackets: $<name>', () => {
      const r = extractParams('SELECT * FROM users WHERE name = $<name>');
      expect(r.params[0].name).toBe('name');
    });

    it('square brackets: $[name]', () => {
      const r = extractParams('SELECT * FROM users WHERE name = $[name]');
      expect(r.params[0].name).toBe('name');
    });

    it('slashes: $/name/', () => {
      const r = extractParams('SELECT * FROM users WHERE name = $/name/');
      expect(r.params[0].name).toBe('name');
    });

    it('mixed styles in same query', () => {
      const r = extractParams('SELECT * FROM users WHERE name = ${name} AND id = $(id) AND email = $<email>');
      expect(r.params).toHaveLength(3);
      expect(r.params[0].name).toBe('name');
      expect(r.params[1].name).toBe('id');
      expect(r.params[2].name).toBe('email');
    });
  });

  describe('modifiers', () => {
    it(':raw modifier', () => {
      const r = extractParams('SELECT * FROM ${table:raw}');
      expect(r.params[0].modifier).toBe('raw');
    });

    it('^ shorthand', () => {
      const r = extractParams('SELECT * FROM $<table^>');
      expect(r.params[0].modifier).toBe('raw');
      expect(r.params[0].shorthand).toBe('^');
    });

    it(':json modifier', () => {
      const r = extractParams('INSERT INTO logs VALUES (${data:json})');
      expect(r.params[0].modifier).toBe('json');
    });

    it(':csv modifier', () => {
      const r = extractParams('WHERE id IN (${ids:csv})');
      expect(r.params[0].modifier).toBe('csv');
    });
  });

  describe('advanced features', () => {
    it('nested properties', () => {
      const r = extractParams('WHERE name = ${profile.name} AND city = ${profile.address.city}');
      expect(r.params[0].path).toEqual(['profile', 'name']);
      expect(r.params[1].path).toEqual(['profile', 'address', 'city']);
    });

    it('this keyword', () => {
      const r = extractParams('INSERT INTO logs VALUES (${this:json})');
      expect(r.params[0].name).toBe('this');
      expect(r.params[0].modifier).toBe('json');
    });

    it('indexed with modifiers', () => {
      const r = extractParams('SELECT * FROM $1:raw WHERE $2~ = $3');
      expect(r.params[0].modifier).toBe('raw');
      expect(r.params[1].modifier).toBe('name');
      expect(r.params[2].modifier).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run tests/integration/pgpParams.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/pgpParams.test.ts
git commit -m "test: add pg-promise parameter syntax integration tests"
```

---

### Task 24: Final Integration — Run All Tests

- [ ] **Step 1: Run the full test suite**

Run: `pnpm vitest run`
Expected: All tests pass.

- [ ] **Step 2: Verify build**

Run: `pnpm -r build`
Expected: All packages build without errors.

- [ ] **Step 3: Final commit (if any remaining changes)**

```bash
git add packages/ tests/
git commit -m "chore: final integration wiring and cleanup"
```

---

## Deferred Items (Not in Scope for This Plan)

These spec features are intentionally deferred. They are not blockers for v1 functionality:

| Item | Why Deferred | When |
|------|-------------|------|
| **PgAdapter (real Postgres)** | PGLite covers testing and offline dev. Real Postgres adapter follows the same `DatabaseAdapter` interface — straightforward addition. | v1 fast-follow |
| **`ts-sqlx generate` CLI command** | Requires file rewriting logic. LSP code actions provide the same capability interactively. | v1.1 |
| **Cache integration in diagnostics pipeline** | Cache and engine exist independently. Wiring the fallback chain (cache → DB → PGLite) is a performance optimization. | v1 fast-follow |
| **Incremental index (in-memory file tracking)** | Performance optimization to avoid re-parsing unchanged files. | v1.1 |
| **`--database-url` CLI flag** | Config file and env var cover the main cases. | v1 fast-follow |
| **`schema_meta` table in cache** | Schema hash tracking for auto-invalidation. v1 uses manual `cache clear`. | v1.1 |
