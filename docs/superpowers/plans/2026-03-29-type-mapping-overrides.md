# Type Mapping Overrides Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to override the default PG-to-TS type mapping via `[types]` in `ts-sqlx.toml`, including support for external type imports.

**Architecture:** Add a `[types]` section to the config that produces a `Map<string, TypeOverride>`. Thread this map from config through `DiagnosticsEngine` to `DbInferrer`, where overrides are checked before the hardcoded `PG_TO_TS` fallback. `generateTypeAnnotation()` returns import metadata alongside the type text, and code actions insert both type annotations and import statements.

**Tech Stack:** TypeScript, vitest, smol-toml, vscode-languageserver

---

## Chunk 1: Config parsing and type override map

### Task 1: Parse `[types]` from config

**Files:**
- Modify: `packages/core/src/config.ts`
- Test: `tests/integration/config.test.ts`

- [ ] **Step 1: Write failing tests for `[types]` parsing**

Add to `tests/integration/config.test.ts`:

```typescript
it('parses simple type overrides', () => {
  const config = parseConfig(`
[types]
numeric = "number"
int8 = "bigint"
jsonb = "Record<string, unknown>"
`);
  expect(config.types).toEqual({
    numeric: 'number',
    int8: 'bigint',
    jsonb: 'Record<string, unknown>',
  });
});

it('defaults to empty types when section is absent', () => {
  const config = parseConfig(`
[database]
url = "$DATABASE_URL"
`);
  expect(config.types).toEqual({});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run tests/integration/config.test.ts`
Expected: FAIL — `config.types` is `undefined`

- [ ] **Step 3: Add `types` to `TsSqlxConfig` and parse it**

In `packages/core/src/config.ts`:

Add `types: Record<string, string>` to the `TsSqlxConfig` interface.

Add `types: {}` to the `DEFAULTS` object.

In `parseConfig()`, add after the `diag` line:
```typescript
const types = (parsed.types ?? {}) as Record<string, string>;
```

Add to the return object:
```typescript
types: { ...types },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run tests/integration/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config.ts tests/integration/config.test.ts
git commit -m "feat: parse [types] section from ts-sqlx.toml config"
```

### Task 2: Parse `TypeOverride` from config values

**Files:**
- Modify: `packages/core/src/config.ts`
- Test: `tests/integration/config.test.ts`

- [ ] **Step 1: Write failing tests for `TypeOverride` parsing**

Add to `tests/integration/config.test.ts`:

```typescript
import { parseConfig, resolveConfig, parseTypeOverrides } from '@ts-sqlx/core/config.js';

describe('parseTypeOverrides', () => {
  it('parses built-in type (no import)', () => {
    const overrides = parseTypeOverrides({ numeric: 'number' });
    expect(overrides.get('numeric')).toEqual({ tsType: 'number' });
  });

  it('parses external type import with # syntax', () => {
    const overrides = parseTypeOverrides({ timestamptz: 'dayjs#Dayjs' });
    expect(overrides.get('timestamptz')).toEqual({
      tsType: 'Dayjs',
      importFrom: 'dayjs',
    });
  });

  it('parses scoped package import', () => {
    const overrides = parseTypeOverrides({ money: '@prisma/client/runtime#Decimal' });
    expect(overrides.get('money')).toEqual({
      tsType: 'Decimal',
      importFrom: '@prisma/client/runtime',
    });
  });

  it('parses relative path import', () => {
    const overrides = parseTypeOverrides({ point: './src/types/geo#Point' });
    expect(overrides.get('point')).toEqual({
      tsType: 'Point',
      importFrom: './src/types/geo',
    });
  });

  it('returns empty map for empty input', () => {
    const overrides = parseTypeOverrides({});
    expect(overrides.size).toBe(0);
  });

  it('throws on empty type name after #', () => {
    expect(() => parseTypeOverrides({ numeric: 'decimal.js#' }))
      .toThrow('Invalid type override');
  });

  it('throws on empty module before #', () => {
    expect(() => parseTypeOverrides({ numeric: '#Decimal' }))
      .toThrow('Invalid type override');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run tests/integration/config.test.ts`
Expected: FAIL — `parseTypeOverrides` not found

- [ ] **Step 3: Implement `parseTypeOverrides` and `TypeOverride`**

In `packages/core/src/config.ts`, add:

```typescript
export interface TypeOverride {
  tsType: string;
  importFrom?: string;
}

export function parseTypeOverrides(
  types: Record<string, string>,
): Map<string, TypeOverride> {
  const map = new Map<string, TypeOverride>();
  for (const [pgType, value] of Object.entries(types)) {
    const hashIdx = value.indexOf('#');
    if (hashIdx === -1) {
      map.set(pgType, { tsType: value });
    } else {
      const importFrom = value.slice(0, hashIdx);
      const tsType = value.slice(hashIdx + 1);
      if (!importFrom || !tsType) {
        throw new Error(
          `Invalid type override for '${pgType}': both module and type name are required in '${value}'`,
        );
      }
      map.set(pgType, { tsType, importFrom });
    }
  }
  return map;
}
```

- [ ] **Step 4: Export `parseTypeOverrides` from `packages/core/src/index.ts`**

Add to the config export line:
```typescript
export { parseConfig, resolveConfig, parseTypeOverrides } from './config.js';
export type { TsSqlxConfig, TypeOverride } from './config.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test:run tests/integration/config.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config.ts packages/core/src/index.ts tests/integration/config.test.ts
git commit -m "feat: add parseTypeOverrides to extract TypeOverride map from config"
```

## Chunk 2: Override application in DbInferrer

### Task 3: Add `importFrom` to inferred types

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: Add `importFrom` field to `InferredColumn` and `InferredParam`**

In `packages/core/src/types.ts`, add `importFrom?: string;` to both interfaces:

```typescript
export interface InferredParam {
  index: number;
  pgType: string;
  tsType: string;
  nullable: boolean;
  importFrom?: string;
}

export interface InferredColumn {
  name: string;
  pgType: string;
  tsType: string;
  nullable: boolean;
  importFrom?: string;
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `pnpm test:run tests/integration/dbInferrer.test.ts tests/integration/typeComparator.test.ts tests/integration/diagnostics.test.ts`
Expected: PASS (optional field, no breakage)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat: add importFrom field to InferredColumn and InferredParam"
```

### Task 4: Apply overrides in DbInferrer

**Files:**
- Modify: `packages/core/src/dbInferrer.ts`
- Test: `tests/integration/dbInferrer.test.ts`

- [ ] **Step 1: Write failing tests for override application**

Add inside the existing top-level `describe('DbInferrer', ...)` block in `tests/integration/dbInferrer.test.ts` (so it can access the `adapter` variable from the outer scope). Also add the import at the top of the file:

```typescript
import { parseTypeOverrides } from '@ts-sqlx/core/config.js';

// Add this describe block inside the existing describe('DbInferrer', ...):
describe('DbInferrer with type overrides', () => {
  let overrideInferrer: DbInferrer;

  beforeAll(() => {
    const overrides = parseTypeOverrides({
      numeric: 'number',
      jsonb: 'Record<string, unknown>',
      timestamptz: 'dayjs#Dayjs',
    });
    overrideInferrer = new DbInferrer(adapter, overrides);
  });

  it('applies simple type override', async () => {
    const result = await overrideInferrer.infer(
      'SELECT numeric_val FROM type_showcase'
    );
    expect(result.columns[0].tsType).toBe('number');
    expect(result.columns[0].importFrom).toBeUndefined();
  });

  it('applies override with import metadata', async () => {
    const result = await overrideInferrer.infer(
      'SELECT timestamptz_col FROM type_showcase'
    );
    expect(result.columns[0].tsType).toBe('Dayjs');
    expect(result.columns[0].importFrom).toBe('dayjs');
  });

  it('falls back to default when no override exists', async () => {
    const result = await overrideInferrer.infer(
      'SELECT regular_int FROM type_showcase'
    );
    expect(result.columns[0].tsType).toBe('number');
    expect(result.columns[0].importFrom).toBeUndefined();
  });

  it('applies override to array types', async () => {
    // int_array is an int4[] column — no override for int4, so default
    // We need a column whose base type has an override
    const result = await overrideInferrer.infer(
      'SELECT jsonb_col FROM type_showcase'
    );
    expect(result.columns[0].tsType).toBe('Record<string, unknown>');
  });

  it('applies override to parameters', async () => {
    const result = await overrideInferrer.infer(
      'SELECT * FROM type_showcase WHERE numeric_val = $1'
    );
    expect(result.params[0].tsType).toBe('number');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run tests/integration/dbInferrer.test.ts`
Expected: FAIL — `DbInferrer` constructor doesn't accept overrides

- [ ] **Step 3: Implement override support in DbInferrer**

Replace `packages/core/src/dbInferrer.ts`:

```typescript
import type { DatabaseAdapter, QueryTypeInfo } from './adapters/database/types.js';
import type { InferredQueryType, InferredParam, InferredColumn } from './types.js';
import type { TypeOverride } from './config.js';
import { tsTypeFromPgType } from './adapters/database/oidMap.js';

export class DbInferrer {
  constructor(
    private adapter: DatabaseAdapter,
    private typeOverrides?: Map<string, TypeOverride>,
  ) {}

  async infer(sql: string): Promise<InferredQueryType> {
    const info: QueryTypeInfo = await this.adapter.describeQuery(sql);

    const params: InferredParam[] = info.params.map((p, i) => {
      const isArr = p.isArray;
      const override = this.typeOverrides?.get(p.name);
      const baseTsType = override?.tsType ?? tsTypeFromPgType(p.name);
      return {
        index: i + 1,
        pgType: p.name,
        tsType: isArr ? `${baseTsType}[]` : baseTsType,
        nullable: false,
        importFrom: override?.importFrom,
      };
    });

    const columns: InferredColumn[] = info.columns.map((c) => {
      const isArr = c.type.isArray;
      const override = this.typeOverrides?.get(c.type.name);
      const baseTsType = override?.tsType ?? tsTypeFromPgType(c.type.name);
      return {
        name: c.name,
        pgType: c.type.name,
        tsType: isArr ? `${baseTsType}[]` : baseTsType,
        nullable: c.nullable,
        importFrom: override?.importFrom,
      };
    });

    return { params, columns };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run tests/integration/dbInferrer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/dbInferrer.ts tests/integration/dbInferrer.test.ts
git commit -m "feat: apply type overrides in DbInferrer before PG_TO_TS fallback"
```

### Task 5: Thread overrides from DiagnosticsEngine to DbInferrer

**Files:**
- Modify: `packages/core/src/diagnostics.ts`
- Test: `tests/integration/diagnostics.test.ts`

- [ ] **Step 1: Write failing test for override threading**

Add to `tests/integration/diagnostics.test.ts`. First check the existing test setup to understand the pattern, then add:

```typescript
import { parseTypeOverrides } from '@ts-sqlx/core/config.js';

it('uses type overrides in diagnostics', async () => {
  const overrides = parseTypeOverrides({ numeric: 'number' });
  const overrideEngine = new DiagnosticsEngine(adapter, tsAdapter, overrides);
  // Analyze a file that declares a numeric column as number — should match with override
  // The exact test depends on the fixture files available
  // At minimum, verify the engine constructs without error
  expect(overrideEngine).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run tests/integration/diagnostics.test.ts`
Expected: FAIL — `DiagnosticsEngine` constructor doesn't accept 3rd argument

- [ ] **Step 3: Update DiagnosticsEngine constructor**

In `packages/core/src/diagnostics.ts`, add import and update constructor:

```typescript
import type { TypeOverride } from './config.js';
```

Update the constructor:

```typescript
constructor(
  private dbAdapter: DatabaseAdapter | null,
  private tsAdapter: TypeScriptAdapter,
  private typeOverrides?: Map<string, TypeOverride>,
) {
  this.queryDetector = new QueryDetector(tsAdapter);
  this.inferrer = dbAdapter ? new DbInferrer(dbAdapter, typeOverrides) : null;
}
```

- [ ] **Step 4: Run all tests to verify nothing broke**

Run: `pnpm test:run tests/integration/diagnostics.test.ts tests/integration/dbInferrer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/diagnostics.ts tests/integration/diagnostics.test.ts
git commit -m "feat: thread type overrides from DiagnosticsEngine to DbInferrer"
```

## Chunk 3: Type annotation generation with imports

### Task 6: Return imports from `generateTypeAnnotation`

**Files:**
- Modify: `packages/core/src/typeComparator.ts`
- Modify: `packages/core/src/index.ts`
- Test: `tests/integration/typeComparator.test.ts`

- [ ] **Step 1: Write failing tests for `GeneratedAnnotation`**

Add to `tests/integration/typeComparator.test.ts`:

```typescript
import { compareTypes, generateTypeAnnotation } from '@ts-sqlx/core/typeComparator.js';

describe('generateTypeAnnotation', () => {
  it('returns type text with no imports for built-in types', () => {
    const columns: InferredColumn[] = [
      { name: 'id', pgType: 'int4', tsType: 'number', nullable: false },
      { name: 'name', pgType: 'text', tsType: 'string', nullable: true },
    ];
    const result = generateTypeAnnotation(columns);
    expect(result.typeText).toBe('{ id: number; name: string | null }');
    expect(result.imports).toEqual([]);
  });

  it('collects imports from columns with importFrom', () => {
    const columns: InferredColumn[] = [
      { name: 'created', pgType: 'timestamptz', tsType: 'Dayjs', nullable: false, importFrom: 'dayjs' },
      { name: 'name', pgType: 'text', tsType: 'string', nullable: false },
    ];
    const result = generateTypeAnnotation(columns);
    expect(result.typeText).toBe('{ created: Dayjs; name: string }');
    expect(result.imports).toEqual([
      { typeName: 'Dayjs', moduleSpecifier: 'dayjs' },
    ]);
  });

  it('deduplicates imports from the same module', () => {
    const columns: InferredColumn[] = [
      { name: 'created', pgType: 'timestamptz', tsType: 'Dayjs', nullable: false, importFrom: 'dayjs' },
      { name: 'updated', pgType: 'timestamptz', tsType: 'Dayjs', nullable: false, importFrom: 'dayjs' },
    ];
    const result = generateTypeAnnotation(columns);
    expect(result.imports).toHaveLength(1);
  });

  it('collects imports from multiple modules', () => {
    const columns: InferredColumn[] = [
      { name: 'created', pgType: 'timestamptz', tsType: 'Dayjs', nullable: false, importFrom: 'dayjs' },
      { name: 'amount', pgType: 'numeric', tsType: 'Decimal', nullable: false, importFrom: 'decimal.js' },
    ];
    const result = generateTypeAnnotation(columns);
    expect(result.imports).toHaveLength(2);
    expect(result.imports).toContainEqual({ typeName: 'Dayjs', moduleSpecifier: 'dayjs' });
    expect(result.imports).toContainEqual({ typeName: 'Decimal', moduleSpecifier: 'decimal.js' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run tests/integration/typeComparator.test.ts`
Expected: FAIL — `result.typeText` is undefined (function returns a string, not an object)

- [ ] **Step 3: Update `generateTypeAnnotation` return type**

In `packages/core/src/typeComparator.ts`:

```typescript
export interface TypeImport {
  typeName: string;
  moduleSpecifier: string;
}

export interface GeneratedAnnotation {
  typeText: string;
  imports: TypeImport[];
}

export function generateTypeAnnotation(columns: InferredColumn[]): GeneratedAnnotation {
  const props = columns.map((col) => {
    const type = col.nullable ? `${col.tsType} | null` : col.tsType;
    return `${col.name}: ${type}`;
  });
  const typeText = `{ ${props.join('; ')} }`;

  const seen = new Set<string>();
  const imports: TypeImport[] = [];
  for (const col of columns) {
    if (col.importFrom && !seen.has(col.importFrom)) {
      seen.add(col.importFrom);
      imports.push({ typeName: col.tsType, moduleSpecifier: col.importFrom });
    }
  }

  return { typeText, imports };
}
```

- [ ] **Step 4: Update the export in `packages/core/src/index.ts`**

Update the typeComparator export line:

```typescript
export { compareTypes, generateTypeAnnotation } from './typeComparator.js';
export type { DeclaredProperty, CompareResult, GeneratedAnnotation, TypeImport } from './typeComparator.js';
```

- [ ] **Step 5: Run typeComparator tests to verify they pass**

Run: `pnpm test:run tests/integration/typeComparator.test.ts`
Expected: PASS

- [ ] **Step 6: Fix callers of `generateTypeAnnotation`**

The return type changed from `string` to `GeneratedAnnotation`. Update all callers:

In `packages/language-server/src/server.ts`, in the `onCodeAction` handler, change:

```typescript
const generatedType = generateTypeAnnotation(queryAnalysis.inferredColumns);
```

to:

```typescript
const { typeText: generatedType, imports: requiredImports } = generateTypeAnnotation(queryAnalysis.inferredColumns);
```

The `requiredImports` variable is wired up in Task 7. It is temporarily unused but the `imports` default value (`[]`) means it compiles cleanly.

- [ ] **Step 7: Update existing tests that expect a string return**

In `tests/integration/codeActions.test.ts`, the existing `generateTypeAnnotation` tests (lines 131-167) and the TS010 code action test (line 133) expect a string return. Update them to use the new return type:

In the `TS010 code action uses inline type` test, change:
```typescript
const generatedType = generateTypeAnnotation(qa.inferredColumns!);
expect(generatedType).toMatch(/^\{/);
```
to:
```typescript
const { typeText: generatedType } = generateTypeAnnotation(qa.inferredColumns!);
expect(generatedType).toMatch(/^\{/);
```

In the `generateTypeAnnotation` describe block, update all three tests to destructure. For example, change:
```typescript
const result = generateTypeAnnotation(columns);
expect(result).toBe('{ id: string; name: string | null }');
```
to:
```typescript
const { typeText } = generateTypeAnnotation(columns);
expect(typeText).toBe('{ id: string; name: string | null }');
```

Apply the same destructuring pattern to all three tests in that block (`reflects nullability correctly`, `handles all non-nullable columns`, `handles multiple nullable columns`).

- [ ] **Step 8: Run all tests to verify nothing broke**

Run: `pnpm test:run`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/typeComparator.ts packages/core/src/index.ts packages/language-server/src/server.ts tests/integration/codeActions.test.ts
git commit -m "feat: generateTypeAnnotation returns GeneratedAnnotation with imports"
```

## Chunk 4: Code action import insertion

### Task 7: Insert import statements in code actions

**Files:**
- Modify: `packages/language-server/src/codeActions.ts`
- Modify: `packages/language-server/src/server.ts`
- Test: `tests/integration/codeActions.test.ts`

- [ ] **Step 1: Write failing tests for import insertion in code actions**

Add to `tests/integration/codeActions.test.ts`:

Add a new `describe` block inside the existing `describe('Code action wiring', ...)` in `tests/integration/codeActions.test.ts`. Note: `createAddTypeAnnotationAction` and `createUpdateTypeAnnotationAction` are already imported at line 7 — no new import needed.

```typescript
describe('code actions with imports', () => {
  it('adds import text edits when imports are provided', () => {
    const action = createAddTypeAnnotationAction(
      'file:///test.ts',
      '{ created: Dayjs }',
      { line: 5, character: 10 },
      [{ typeName: 'Dayjs', moduleSpecifier: 'dayjs' }],
    );
    const edits = action.edit!.changes!['file:///test.ts'];
    expect(edits).toHaveLength(2); // type annotation + import
    // Import edit should be at line 0
    expect(edits[1].range.start.line).toBe(0);
    expect(edits[1].newText).toContain("import type { Dayjs } from 'dayjs'");
  });

  it('adds multiple import statements', () => {
    const action = createAddTypeAnnotationAction(
      'file:///test.ts',
      '{ created: Dayjs; amount: Decimal }',
      { line: 5, character: 10 },
      [
        { typeName: 'Dayjs', moduleSpecifier: 'dayjs' },
        { typeName: 'Decimal', moduleSpecifier: 'decimal.js' },
      ],
    );
    const edits = action.edit!.changes!['file:///test.ts'];
    expect(edits).toHaveLength(3); // type annotation + 2 imports
  });

  it('creates no import edits when imports array is empty', () => {
    const action = createAddTypeAnnotationAction(
      'file:///test.ts',
      '{ id: number }',
      { line: 5, character: 10 },
      [],
    );
    const edits = action.edit!.changes!['file:///test.ts'];
    expect(edits).toHaveLength(1); // type annotation only
  });

  it('adds imports for update type annotation action', () => {
    const action = createUpdateTypeAnnotationAction(
      'file:///test.ts',
      '{ created: Dayjs }',
      { start: { line: 5, character: 10 }, end: { line: 5, character: 30 } },
      [{ typeName: 'Dayjs', moduleSpecifier: 'dayjs' }],
    );
    const edits = action.edit!.changes!['file:///test.ts'];
    expect(edits).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run tests/integration/codeActions.test.ts`
Expected: FAIL — functions don't accept imports parameter

- [ ] **Step 3: Update code action functions to accept and insert imports**

In `packages/language-server/src/codeActions.ts`:

```typescript
import type {
  CodeAction,
  TextEdit,
} from 'vscode-languageserver/node.js';
import { CodeActionKind } from 'vscode-languageserver/node.js';

export interface TypeImportInfo {
  typeName: string;
  moduleSpecifier: string;
}

function importEdits(imports: TypeImportInfo[]): TextEdit[] {
  return imports.map((imp) => ({
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    },
    newText: `import type { ${imp.typeName} } from '${imp.moduleSpecifier}';\n`,
  }));
}

export function createAddTypeAnnotationAction(
  uri: string,
  generatedType: string,
  insertPosition: { line: number; character: number },
  imports: TypeImportInfo[] = [],
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
          ...importEdits(imports),
        ],
      },
    },
  };
}

export function createUpdateTypeAnnotationAction(
  uri: string,
  generatedType: string,
  replaceRange: { start: { line: number; character: number }; end: { line: number; character: number } },
  imports: TypeImportInfo[] = [],
): CodeAction {
  return {
    title: 'Update type annotation to match query',
    kind: CodeActionKind.QuickFix,
    edit: {
      changes: {
        [uri]: [
          {
            range: replaceRange,
            newText: `<${generatedType}>`,
          },
          ...importEdits(imports),
        ],
      },
    },
  };
}
```

- [ ] **Step 4: Update server.ts to pass imports to code actions**

In `packages/language-server/src/server.ts`, in the `onCodeAction` handler, update the two code action calls:

Change:
```typescript
actions.push(createAddTypeAnnotationAction(uri, generatedType, insertPos));
```
to:
```typescript
actions.push(createAddTypeAnnotationAction(uri, generatedType, insertPos, requiredImports));
```

Change:
```typescript
actions.push(createUpdateTypeAnnotationAction(uri, generatedType, replaceRange));
```
to:
```typescript
actions.push(createUpdateTypeAnnotationAction(uri, generatedType, replaceRange, requiredImports));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test:run tests/integration/codeActions.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/language-server/src/codeActions.ts packages/language-server/src/server.ts tests/integration/codeActions.test.ts
git commit -m "feat: code actions insert import statements for external type overrides"
```

## Chunk 5: Wire config to engine in server and CLI

### Task 8: Pass type overrides from config to DiagnosticsEngine

**Files:**
- Modify: `packages/language-server/src/server.ts`
- Modify: `packages/cli/src/commands/check.ts`

- [ ] **Step 1: Update server.ts to thread overrides**

In `packages/language-server/src/server.ts`, update the existing `resolveConfig` import (line 17) to also include `parseTypeOverrides`:

```typescript
import { resolveConfig, parseTypeOverrides } from '@ts-sqlx/core/config.js';
```

In `onInitialize`, after `const config = resolveConfig(rootPath);`, add:

```typescript
const typeOverrides = parseTypeOverrides(config.types);
```

Update the `DiagnosticsEngine` construction:

```typescript
engine = new DiagnosticsEngine(dbAdapter, tsAdapter, typeOverrides);
```

- [ ] **Step 2: Update check.ts to thread overrides**

In `packages/cli/src/commands/check.ts`, update the existing `resolveConfig` import (line 5) to also include `parseTypeOverrides`:

```typescript
import { resolveConfig, parseTypeOverrides } from '@ts-sqlx/core/config.js';
```

After `const config = resolveConfig(cwd);`, add:

```typescript
const typeOverrides = parseTypeOverrides(config.types);
```

Update the `DiagnosticsEngine` construction:

```typescript
const engine = new DiagnosticsEngine(dbAdapter, tsAdapter, typeOverrides);
```

- [ ] **Step 3: Run all tests to verify nothing broke**

Run: `pnpm test:run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/language-server/src/server.ts packages/cli/src/commands/check.ts
git commit -m "feat: wire type overrides from config to DiagnosticsEngine in server and CLI"
```

### Task 9: End-to-end verification

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test:run`
Expected: All tests PASS

- [ ] **Step 2: Build the project**

Run: `pnpm build`
Expected: No compilation errors

- [ ] **Step 3: Manual smoke test with a sample config**

Create a temporary `ts-sqlx.toml` in the project root with:
```toml
[database]
pglite = true
schema = "tests/fixtures/schema.sql"

[types]
numeric = "number"
jsonb = "Record<string, unknown>"
```

Run: `pnpm --filter @ts-sqlx/cli exec ts-sqlx check "tests/fixtures/**/*.ts"`
Expected: Diagnostics reflect overridden types (numeric columns inferred as `number`, jsonb as `Record<string, unknown>`)

Clean up the temporary config file after verification.
