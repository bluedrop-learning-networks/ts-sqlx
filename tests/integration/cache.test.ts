import { describe, it, expect, beforeEach } from 'vitest';
import { TypeCache } from '@ts-sqlx/core/cache.js';

describe('TypeCache', () => {
  let cache: TypeCache;

  beforeEach(() => {
    cache = new TypeCache();
  });

  it('returns undefined for cache miss', () => {
    const result = cache.get('SELECT 1');
    expect(result).toBeUndefined();
  });

  it('stores and retrieves query types', () => {
    const queryType = {
      params: [{ index: 1, pgType: 'uuid', tsType: 'string', nullable: false }],
      columns: [{ name: 'id', pgType: 'uuid', tsType: 'string', nullable: false }],
    };
    cache.set('SELECT id FROM users WHERE id = $1', queryType);

    const result = cache.get('SELECT id FROM users WHERE id = $1');
    expect(result).toBeDefined();
    expect(result!.columns[0].name).toBe('id');
    expect(result!.params[0].tsType).toBe('string');
  });

  it('clears all entries', () => {
    cache.set('SELECT 1', { params: [], columns: [] });
    cache.clear();
    expect(cache.get('SELECT 1')).toBeUndefined();
  });

  it('returns cache stats', () => {
    cache.set('SELECT 1', { params: [], columns: [] });
    cache.set('SELECT 2', { params: [], columns: [] });
    const stats = cache.stats();
    expect(stats.entries).toBe(2);
  });
});
