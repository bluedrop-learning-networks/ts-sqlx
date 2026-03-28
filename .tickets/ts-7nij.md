---
id: ts-7nij
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
# Task 3: OID → Type Name Mapping

Implement PostgreSQL OID-to-type-name mapping and PG-to-TypeScript type conversion with comprehensive tests.

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

## Design

Maps PostgreSQL OIDs to type names and TypeScript types. Key mappings: int8→string (precision), json→unknown, bytea→Buffer, date→Date.

## Acceptance Criteria

oidMap.ts with oidToTypeName, tsTypeFromPgType, isArrayOid; tests pass; commit created

