# Type Mapping Overrides

## Problem

ts-sqlx has a hardcoded `PG_TO_TS` mapping in `oidMap.ts` that converts PostgreSQL types to TypeScript types (e.g., `numeric` → `string`, `json` → `unknown`, `int8` → `string`). Users cannot customize these mappings, which is a problem when:

- The default mapping is overly conservative (e.g., `numeric` → `string` when the user knows their values fit in `number`)
- Users want to use library types for better semantics (e.g., `timestamptz` → `dayjs#Dayjs`, `numeric` → `decimal.js#Decimal`)
- Custom or extension PG types (e.g., `citext`, PostGIS `geometry`) map to `unknown` with no override path

## Design

### Config Format

A new `[types]` section in `ts-sqlx.toml`:

```toml
[types]
# Simple overrides — built-in TS types, no import needed
numeric = "number"
int8 = "bigint"
jsonb = "Record<string, unknown>"

# External type imports — "module#ExportedName"
timestamptz = "dayjs#Dayjs"
money = "@prisma/client/runtime#Decimal"

# Relative imports resolve from project root
point = "./src/types/geo#Point"
```

**Parsing rule:** If the value contains `#`, split on the first `#` — left side is the module specifier, right side is the type name. Otherwise, the value is used as-is (a built-in type).

The parsed config produces a `TypeOverride` per entry:

```typescript
interface TypeOverride {
  tsType: string;        // e.g. "Dayjs", "number"
  importFrom?: string;   // e.g. "dayjs", undefined for built-ins
}
```

### Override Application

Overrides are applied in `DbInferrer`, the single point where PG types are converted to TS types. The override map is checked first; if no override exists, the hardcoded `PG_TO_TS` default is used.

```typescript
const override = this.typeOverrides?.get(pgTypeName);
const baseTsType = override?.tsType ?? tsTypeFromPgType(pgTypeName);
```

The `InferredColumn` and `InferredParam` types gain an optional `importFrom?: string` field to carry import metadata downstream to code generation.

### Override Flow

```
ts-sqlx.toml [types] section
    ↓
resolveConfig() parses into Map<string, TypeOverride>
    ↓
DiagnosticsEngine constructor receives overrides
    ↓
DbInferrer constructor receives overrides
    ↓
DbInferrer.infer() checks overrides before PG_TO_TS fallback
    ↓
InferredColumn/InferredParam carry tsType + importFrom
    ↓
generateTypeAnnotation() collects imports
    ↓
Code actions insert type annotation + import statements
```

### Type Comparison

No changes to `compareTypes()` or `isTypeCompatible()`. The override is applied upstream in `DbInferrer`, so by the time comparison happens, `col.tsType` is already the override value (e.g., `"Dayjs"` instead of `"Date"`), and string comparison works naturally.

Trade-off: if a user declares `amount: Decimal` but imports a different `Decimal` than what the override specifies, ts-sqlx won't catch this. This is an accepted simplification — full type resolution through the TS compiler would add significant complexity for minimal practical benefit.

### Import Insertion in Code Actions

`generateTypeAnnotation()` currently returns a `string`. It will return a richer result:

```typescript
interface GeneratedAnnotation {
  typeText: string;
  imports: { typeName: string; moduleSpecifier: string }[];
}
```

When the "Add inferred type annotation" or "Update type annotation" code action fires, it inserts both the type annotation and any required `import type` statements.

Import statements are inserted at line 0 unconditionally — no check for existing imports. Duplicate imports produce a TS error that the user's editor (organize-imports) can trivially fix. This avoids parsing the file's import declarations in the language server.

### Scope

- **Per-PG-type overrides only** — no per-column, per-table, or per-query overrides
- **Simple mapping only** — no parameter/return split (a `date` override applies to both query params and results)
- **String-based type comparison** — no deep TS compiler resolution for override types
- **External imports supported** — via `module#Type` syntax in config values

### Changes by File

| File | Change |
|------|--------|
| `config.ts` | Add `types?: Record<string, string>` to `TsSqlxConfig`, parse `[types]` section, extract `TypeOverride` map |
| `types.ts` | Add `importFrom?: string` to `InferredColumn` and `InferredParam` |
| `dbInferrer.ts` | Accept `Map<string, TypeOverride>`, check overrides before `PG_TO_TS` fallback |
| `diagnostics.ts` | Pass type overrides from config to `DbInferrer` constructor |
| `typeComparator.ts` | `generateTypeAnnotation()` returns `GeneratedAnnotation` with imports list |
| `server.ts` | Pass config overrides through; handle import insertion in code actions |
| `codeActions.ts` | Accept imports array, generate additional text edits for import statements |

No new files. No changes to `oidMap.ts` — hardcoded defaults remain untouched. No changes to `check.ts` — overrides flow through `DiagnosticsEngine` automatically.

### Not in Scope

- Per-column overrides (e.g., `users.id` → `UserId`)
- Per-query overrides
- Parameter/return type split
- Nullable-aware overrides (e.g., different type for nullable vs non-nullable)
- Runtime type parser configuration (this is purely compile-time)
- Checking for existing imports before inserting
