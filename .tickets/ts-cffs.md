---
id: ts-cffs
status: closed
deps: [ts-w2b0]
links: []
created: 2026-03-28T14:46:49Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [core, types]
---
# Task 2: Core Type Definitions

Define core shared types (diagnostics, query call info, params, inference results) and the DatabaseAdapter interface.

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

## Design

Core shared types: Diagnostic, QueryCallInfo, ExtractedParams, InferredQueryType. DatabaseAdapter interface for PGLite/Pg abstraction.

## Acceptance Criteria

packages/core/src/types.ts and adapters/database/types.ts created with all interfaces; commit created

