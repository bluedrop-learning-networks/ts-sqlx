import { describe, it, expect } from 'vitest';
import { queryEnumTypes } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/database/shared.js';
import type { EnumTypeInfo } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/database/types.js';

describe('queryEnumTypes', () => {
  it('parses enum rows into Map<string, EnumTypeInfo>', async () => {
    const mockQueryFn = async <T extends Record<string, unknown>>(
      _sql: string,
      _params?: unknown[],
    ): Promise<{ rows: T[] }> => {
      return {
        rows: [
          {
            oid: 16400,
            typname: 'status_enum',
            typarray: 16405,
            nspname: 'public',
            labels: ['draft', 'published', 'archived'],
          },
          {
            oid: 16410,
            typname: 'priority_level',
            typarray: 16415,
            nspname: 'public',
            labels: ['low', 'medium', 'high'],
          },
        ] as unknown as T[],
      };
    };

    const result = await queryEnumTypes(mockQueryFn);

    expect(result.size).toBe(2);

    const status = result.get('status_enum');
    expect(status).toBeDefined();
    expect(status!.oid).toBe(16400);
    expect(status!.arrayOid).toBe(16405);
    expect(status!.name).toBe('status_enum');
    expect(status!.schema).toBe('public');
    expect(status!.labels).toEqual(['draft', 'published', 'archived']);

    const priority = result.get('priority_level');
    expect(priority).toBeDefined();
    expect(priority!.labels).toEqual(['low', 'medium', 'high']);
  });

  it('returns empty map when no enums exist', async () => {
    const mockQueryFn = async <T extends Record<string, unknown>>(
      _sql: string,
      _params?: unknown[],
    ): Promise<{ rows: T[] }> => {
      return { rows: [] };
    };

    const result = await queryEnumTypes(mockQueryFn);
    expect(result.size).toBe(0);
  });
});
