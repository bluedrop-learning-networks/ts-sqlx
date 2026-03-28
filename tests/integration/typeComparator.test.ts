import { describe, it, expect } from 'vitest';
import { compareTypes } from '@ts-sqlx/core/typeComparator.js';
import type { InferredColumn } from '@ts-sqlx/core/types.js';

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
