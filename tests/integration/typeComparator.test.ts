import { describe, it, expect } from 'vitest';
import { compareTypes, generateTypeAnnotation } from '@bluedrop-learning-networks/ts-sqlx-core/typeComparator.js';
import type { InferredColumn } from '@bluedrop-learning-networks/ts-sqlx-core/types.js';

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

  it('keeps distinct types from the same module', () => {
    const columns: InferredColumn[] = [
      { name: 'created', pgType: 'timestamptz', tsType: 'Dayjs', nullable: false, importFrom: 'dayjs' },
      { name: 'config', pgType: 'jsonb', tsType: 'ConfigType', nullable: false, importFrom: 'dayjs' },
    ];
    const result = generateTypeAnnotation(columns);
    expect(result.imports).toHaveLength(2);
    expect(result.imports).toContainEqual({ typeName: 'Dayjs', moduleSpecifier: 'dayjs' });
    expect(result.imports).toContainEqual({ typeName: 'ConfigType', moduleSpecifier: 'dayjs' });
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
