import { describe, it, expect } from 'vitest';
import { queryEnumTypes } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/database/shared.js';
import type { EnumTypeInfo } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/database/types.js';
import { DbInferrer } from '@bluedrop-learning-networks/ts-sqlx-core/dbInferrer.js';
import type { DatabaseAdapter } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/database/types.js';
import { parseTypeOverrides } from '@bluedrop-learning-networks/ts-sqlx-core/config.js';

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

import { PgAdapter } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/database/pgAdapter.js';

describe('PgAdapter.resolveOid', () => {
  it('resolves built-in OIDs to their type name', () => {
    const adapter = new PgAdapter('postgresql://fake');
    const resolve = (adapter as any).resolveOid.bind(adapter);
    expect(resolve(23)).toEqual({ name: 'int4', isArray: false });
    expect(resolve(1007)).toEqual({ name: 'int4', isArray: true });
  });

  it('resolves unknown OIDs to unknown', () => {
    const adapter = new PgAdapter('postgresql://fake');
    const resolve = (adapter as any).resolveOid.bind(adapter);
    expect(resolve(99999)).toEqual({ name: 'unknown', isArray: false });
  });

  it('resolves enum OIDs after discoverEnums', async () => {
    const adapter = new PgAdapter('postgresql://fake');
    const enumInfo = {
      oid: 16400, arrayOid: 16405, name: 'status_enum',
      schema: 'public', labels: ['draft', 'published', 'archived'],
    };
    (adapter as any).enumsByOid = new Map([[16400, enumInfo], [16405, enumInfo]]);
    const resolve = (adapter as any).resolveOid.bind(adapter);
    expect(resolve(16400)).toEqual({ name: 'status_enum', isArray: false });
    expect(resolve(16405)).toEqual({ name: 'status_enum', isArray: true });
  });
});

describe('DbInferrer enum resolution', () => {
  function makeInferrer(enumMap: Map<string, EnumTypeInfo>, typeOverrides?: Map<string, any>) {
    const mockAdapter = {} as DatabaseAdapter;
    const inferrer = new DbInferrer(mockAdapter, typeOverrides);
    (inferrer as any).enumMap = enumMap;
    return inferrer;
  }

  const enumMap = new Map([
    ['status_enum', {
      oid: 16400, arrayOid: 16405, name: 'status_enum',
      schema: 'public', labels: ['draft', 'published', 'archived'],
    }],
  ]);

  it('resolves enum type to string union', () => {
    const inferrer = makeInferrer(enumMap);
    const result = (inferrer as any).resolveType('status_enum', false);
    expect(result.tsType).toBe("'draft' | 'published' | 'archived'");
  });

  it('resolves array enum type to union array', () => {
    const inferrer = makeInferrer(enumMap);
    const result = (inferrer as any).resolveType('status_enum', true);
    expect(result.tsType).toBe("('draft' | 'published' | 'archived')[]");
  });

  it('manual override wins over enum', () => {
    const overrides = parseTypeOverrides({ status_enum: 'string' });
    const inferrer = makeInferrer(enumMap, overrides);
    const result = (inferrer as any).resolveType('status_enum', false);
    expect(result.tsType).toBe('string');
  });

  it('falls back to PG_TO_TS for non-enum types', () => {
    const inferrer = makeInferrer(enumMap);
    const result = (inferrer as any).resolveType('text', false);
    expect(result.tsType).toBe('string');
  });

  it('escapes single quotes in enum labels', () => {
    const mapWithQuotes = new Map([
      ['quirky_enum', {
        oid: 16500, arrayOid: 16505, name: 'quirky_enum',
        schema: 'public', labels: ["it's", "they're"],
      }],
    ]);
    const inferrer = makeInferrer(mapWithQuotes);
    const result = (inferrer as any).resolveType('quirky_enum', false);
    expect(result.tsType).toBe("'it\\'s' | 'they\\'re'");
  });
});

import { beforeAll, afterAll } from 'vitest';
import { createPGLiteFixture } from '@bluedrop-learning-networks/ts-sqlx-test-utils';
import type { PGLiteFixture } from '@bluedrop-learning-networks/ts-sqlx-test-utils';

describe('enum inference integration', () => {
  let fixture: PGLiteFixture;
  let inferrer: DbInferrer;

  beforeAll(async () => {
    fixture = await createPGLiteFixture();
    await fixture.setup();
    inferrer = new DbInferrer(fixture.adapter);
    await inferrer.init();
  }, 30_000);

  afterAll(async () => {
    await fixture.teardown();
  });

  it('infers status_enum as string union from type_showcase', async () => {
    const result = await inferrer.infer('SELECT status FROM type_showcase');
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].tsType).toBe("'draft' | 'published' | 'archived'");
  });

  it('infers status_enum as string union from orders', async () => {
    const result = await inferrer.infer('SELECT status FROM orders');
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].tsType).toBe("'draft' | 'published' | 'archived'");
  });

  it('still resolves built-in types correctly alongside enums', async () => {
    const result = await inferrer.infer('SELECT id, status FROM orders');
    expect(result.columns).toHaveLength(2);
    expect(result.columns[0].tsType).toBe('number');
    expect(result.columns[1].tsType).toBe("'draft' | 'published' | 'archived'");
  });

  it('resolves enum used as parameter type', async () => {
    const result = await inferrer.infer('SELECT id FROM orders WHERE status = $1');
    expect(result.params).toHaveLength(1);
    expect(result.params[0].pgType).toBe('status_enum');
  });

  it('infers nullable enum column correctly', async () => {
    const result = await inferrer.infer(
      'SELECT CASE WHEN id > 0 THEN status ELSE NULL END AS maybe_status FROM orders',
    );
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].tsType).toBe("'draft' | 'published' | 'archived'");
    expect(result.columns[0].nullable).toBe(true);
  });
});
