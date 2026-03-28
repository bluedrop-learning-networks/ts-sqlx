---
id: ts-8etz
status: closed
deps: [ts-cffs]
links: []
created: 2026-03-28T14:47:51Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [core, types]
---
# Task 14: Type Comparator

Type Comparator - Compare inferred database column types against declared TypeScript types with nullability handling.

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

## Design

Chunk 4: Type Comparator + Diagnostics. Compares InferredColumn[] against DeclaredProperty[]. Normalizes types for comparison.

## Acceptance Criteria

compareTypes detects missing/extra properties, type mismatches, nullable columns missing null union; generateTypeAnnotation produces correct inline type; tests pass; commit created

