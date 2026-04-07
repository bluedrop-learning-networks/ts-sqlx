# Auto Enum Type Inference

**Date:** 2026-04-07
**Status:** Approved

## Problem

When a query returns a column with a custom PostgreSQL enum type (e.g. `status_enum`), `ts-sqlx` resolves it to `unknown` because the hardcoded `OID_MAP` only covers built-in types. Users must manually configure type overrides in `ts-sqlx.toml` to get correct types. The adapter layer already has `getEnumValues()` and `getCompositeFields()` methods, but these are never called during type inference.

## Solution

Automatically discover all enum types in the database at startup and use them to infer precise TypeScript string union types (e.g. `'draft' | 'published' | 'archived'`).

## Scope

**In scope:** Enum types with string union inference.

**Explicitly excluded:** Composite types, domain types, enum codegen to separate `.ts` files. These are follow-up work — the plumbing established here makes them straightforward to add.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| TS representation | String union (`'a' \| 'b'`) | Most idiomatic TS, no codegen files, works with existing type comparator |
| Discovery timing | Eager at startup | One cheap query, no per-query latency surprises, simple code |
| Registry location | Adapter layer | Adapters own DB access; inferrer consumes the result |
| Override precedence | Manual overrides win | Preserves existing behavior, gives users an escape hatch |
| `string` vs enum union | Strict mismatch | Nudges users toward precise types; `string` can be forced via override |
| Schema qualification | Unqualified names (v1) | Only `search_path`-visible enums supported; duplicate names across schemas unsupported. Schema field stored for future use |
| Label escaping | Escape single quotes | Labels containing `'` are escaped to `\'` in generated union strings |
| Cache invalidation | None (v1) | Language server requires restart to pick up new enums from migrations. Future: refresh on schema change or explicit LSP command |

## Data Model

### New type: `EnumTypeInfo`

Added to `packages/core/src/adapters/database/types.ts`:

```typescript
export interface EnumTypeInfo {
  oid: number;          // scalar enum OID
  arrayOid: number;     // OID of the _enum array type (from pg_type.typarray)
  name: string;         // pg type name, e.g. 'status_enum'
  schema: string;       // pg schema, e.g. 'public'
  labels: string[];     // ordered enum values: ['draft', 'published', 'archived']
}
```

### New method on `DatabaseAdapter`

```typescript
discoverEnums(): Promise<Map<string, EnumTypeInfo>>;
```

Key is the pg type name (e.g. `'status_enum'`).

## Discovery Query

Added to `packages/core/src/adapters/database/shared.ts` as `queryEnumTypes()`:

```sql
SELECT t.oid, t.typname, t.typarray, n.nspname,
       array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON t.typnamespace = n.oid
GROUP BY t.oid, t.typname, t.typarray, n.nspname
```

One query, returns all enums in the database. The `typarray` column provides the array variant OID so `_status_enum` resolves correctly too.

## Adapter Changes

Both `PgAdapter` and `PgliteAdapter` get the same pattern:

1. **`discoverEnums()`** calls `queryEnumTypes()`, stores result internally in an `enumsByOid: Map<number, EnumTypeInfo>` for use by `describeQuery`. **Both the scalar OID and the array OID** are inserted as keys pointing to the same `EnumTypeInfo`, so array enum columns resolve correctly.

2. **New `resolveOid()` helper** replaces **all** inline `oidToTypeName` + `isArrayOid` calls in `describeQuery`, including the `PgTypeInfo.isArray` assignment. The returned `isArray` value is used directly for `PgTypeInfo.isArray` in the column/param mapping:

```typescript
private resolveOid(oid: number): { name: string; isArray: boolean } {
  const builtinName = oidToTypeName(oid);
  if (builtinName !== 'unknown') {
    return {
      name: isArrayOid(oid) ? arrayElementTypeName(builtinName) : builtinName,
      isArray: isArrayOid(oid),
    };
  }
  const enumInfo = this.enumsByOid.get(oid);
  if (enumInfo) {
    const isArray = oid === enumInfo.arrayOid;
    return { name: enumInfo.name, isArray };
  }
  return { name: 'unknown', isArray: false };
}
```

`describeQuery` uses `resolveOid()` instead of calling `oidToTypeName`/`isArrayOid` directly.

## DbInferrer Changes

### Initialization

`DbInferrer` gains an `async init()` method since the constructor cannot be async:

```typescript
class DbInferrer {
  private enumMap: Map<string, EnumTypeInfo> = new Map();

  async init(): Promise<void> {
    this.enumMap = await this.adapter.discoverEnums();
  }
}
```

The `DbInferrer` only needs the name-keyed map. OID-to-name resolution is handled by the adapter's `resolveOid()` in `describeQuery`, so by the time `resolveType()` runs, it receives the enum's pg type name and can look it up in `enumMap` directly.

### Type Resolution

`resolveType()` gains an enum check between overrides and the `PG_TO_TS` fallback:

```typescript
private resolveType(pgName: string, isArray: boolean): { tsType: string; importFrom?: string } {
  // 1. Manual overrides win
  const override = this.typeOverrides?.get(pgName);
  if (override) { /* existing logic */ }

  // 2. Check enum registry
  const enumInfo = this.enumMap.get(pgName);
  if (enumInfo) {
    const union = enumInfo.labels.map(l => `'${l.replace(/'/g, "\\'")}'`).join(' | ');
    return { tsType: isArray ? `(${union})[]` : union };
  }

  // 3. Built-in PG_TO_TS fallback
  const baseTsType = tsTypeFromPgType(pgName);
  return { tsType: isArray ? `${baseTsType}[]` : baseTsType };
}
```

## Initialization Flow

The startup sequence becomes:

```
connect() → discoverEnums() → new DbInferrer(adapter, overrides) → init()
```

`DiagnosticsEngine` needs an `async init()` method (or factory) since the constructor currently creates `DbInferrer` synchronously. Callers (`cli`, `language-server`) call `init()` after construction.

**PGLite note:** `PGLiteAdapter` uses a static `create()` factory rather than `connect()`. Its `discoverEnums()` should be called after `create()` (which is when the DB is ready), not after `connect()` (which is a no-op).

## Type Comparison

**`typeComparator.ts` needs a fix for nullable multi-member unions.** The current `isTypeCompatible` function handles nullable types by doing `inferred.replace('| null', '')` and then checking if the result is one of the declared type's `|`-separated parts. This works for simple types like `string | null` but breaks for enum unions like `'draft' | 'published' | 'archived' | null` — the `replace` leaves a multi-member string that won't match any single part.

**Fix:** Change the nullable comparison to normalize both sides into sorted sets of `|`-separated members and compare sets, rather than checking string inclusion. Specifically:

```typescript
if (nullable) {
  // Split both sides into sets, remove null from inferred, compare
  const inferredParts = normalizeType(inferred.replace(/\| null/g, '').trim())
  const declaredParts = normalizeType(declared.replace(/\| null/g, '').trim())
  const declaredHasNull = typeIncludesNull(declared);
  return inferredParts === declaredParts && declaredHasNull;
}
```

**Strict behavior:** If a user declares a property as `string` for an enum column, it is flagged as a type mismatch. This is intentional — the inferred type is narrower. Users who want `string` can add a type override.

## Codegen

**No changes needed to `generateTypeAnnotation`.** A column with `tsType: "'draft' | 'published' | 'archived'"` renders as `status: 'draft' | 'published' | 'archived'` in the generated annotation.

## File Change Summary

| File | Change |
|---|---|
| `adapters/database/types.ts` | Add `EnumTypeInfo` interface, add `discoverEnums()` to `DatabaseAdapter` |
| `adapters/database/shared.ts` | Add `queryEnumTypes()` bulk discovery function |
| `adapters/database/pgAdapter.ts` | Implement `discoverEnums()`, add `resolveOid()` helper, refactor `describeQuery` |
| `adapters/database/pgliteAdapter.ts` | Same changes as pgAdapter (called after `create()`) |
| `dbInferrer.ts` | Add `init()`, store enum map + OID reverse map, enum check in `resolveType()` |
| `typeComparator.ts` | Fix `isTypeCompatible` for nullable multi-member unions |
| `diagnostics.ts` | Add `init()` that calls `discoverEnums()` + `inferrer.init()` |
| CLI entry point | Call `diagnosticsEngine.init()` after connect |
| Language server | Call `diagnosticsEngine.init()` after connect |

## Testing

1. **Unit: `queryEnumTypes`** — Mock query function, verify correct parsing into `Map<string, EnumTypeInfo>`
2. **Unit: `resolveType` with enums** — Pre-built enum map, verify union strings, verify overrides win, verify array enums produce `(union)[]`
3. **Unit: `resolveOid`** — Built-in OIDs still resolve, enum OIDs resolve to name, array enum OIDs resolve, unknown OIDs return `'unknown'`
4. **Integration: end-to-end enum inference** — Using existing `schema.sql` which has `status_enum`:
   - `SELECT status FROM type_showcase` infers `'draft' | 'published' | 'archived'`
   - `SELECT status FROM orders` same result
   - Type comparison catches mismatches against declared types
5. **Unit: type comparator** — Enum union vs `string` is flagged as a mismatch
6. **Unit: type comparator nullable** — Nullable enum union (`'draft' | 'published' | 'archived' | null`) matches declared `'draft' | 'published' | 'archived' | null`, and mismatches against `string | null`
