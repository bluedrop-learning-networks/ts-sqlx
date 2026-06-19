import { describe, it, expect, beforeEach } from 'vitest';
import { TypeCache } from '@bluedrop-learning-networks/ts-sqlx-core/cache.js';

const FP_A = 'schema-fingerprint-a';
const FP_B = 'schema-fingerprint-b';

describe('TypeCache', () => {
  let cache: TypeCache;

  beforeEach(() => {
    cache = new TypeCache();
  });

  it('returns undefined for cache miss', () => {
    const result = cache.get('SELECT 1', FP_A);
    expect(result).toBeUndefined();
  });

  it('stores and retrieves query types', () => {
    const queryType = {
      params: [{ index: 1, pgType: 'uuid', tsType: 'string', nullable: false }],
      columns: [{ name: 'id', pgType: 'uuid', tsType: 'string', nullable: false }],
    };
    cache.set('SELECT id FROM users WHERE id = $1', FP_A, queryType);

    const result = cache.get('SELECT id FROM users WHERE id = $1', FP_A);
    expect(result).toBeDefined();
    expect(result!.columns[0].name).toBe('id');
    expect(result!.params[0].tsType).toBe('string');
  });

  it('clears all entries', () => {
    cache.set('SELECT 1', FP_A, { params: [], columns: [] });
    cache.clear();
    expect(cache.get('SELECT 1', FP_A)).toBeUndefined();
  });

  it('returns cache stats', () => {
    cache.set('SELECT 1', FP_A, { params: [], columns: [] });
    cache.set('SELECT 2', FP_A, { params: [], columns: [] });
    const stats = cache.stats();
    expect(stats.entries).toBe(2);
  });

  it('treats identical SQL under different schema fingerprints as separate entries', () => {
    const typesA = {
      params: [],
      columns: [{ name: 'id', pgType: 'uuid', tsType: 'string', nullable: false }],
    };
    const typesB = {
      params: [],
      columns: [{ name: 'id', pgType: 'bigint', tsType: 'number', nullable: false }],
    };

    cache.set('SELECT id FROM users', FP_A, typesA);
    cache.set('SELECT id FROM users', FP_B, typesB);

    expect(cache.stats().entries).toBe(2);
    expect(cache.get('SELECT id FROM users', FP_A)!.columns[0].tsType).toBe('string');
    expect(cache.get('SELECT id FROM users', FP_B)!.columns[0].tsType).toBe('number');

    // A lookup with a fingerprint that was never set produces a miss, not a
    // cross-schema bleed-through.
    expect(cache.get('SELECT id FROM users', 'unrelated-fp')).toBeUndefined();
  });
});
