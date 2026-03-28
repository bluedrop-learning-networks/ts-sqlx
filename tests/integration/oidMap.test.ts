import { describe, it, expect } from 'vitest';
import { oidToTypeName, tsTypeFromPgType, isArrayOid } from '@ts-sqlx/core/adapters/database/oidMap.js';

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
    expect(isArrayOid(1007)).toBe(true);
    expect(isArrayOid(1009)).toBe(true);
  });

  it('rejects non-array OIDs', () => {
    expect(isArrayOid(23)).toBe(false);
    expect(isArrayOid(25)).toBe(false);
  });
});
