import { describe, it, expect } from 'vitest';
import { createDatabaseAdapter } from '@ts-sqlx/core/adapters/database/adapterFactory.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import { PgAdapter } from '@ts-sqlx/core/adapters/database/pgAdapter.js';
import type { TsSqlxConfig } from '@ts-sqlx/core/config.js';

function makeConfig(db: TsSqlxConfig['database']): TsSqlxConfig {
  return {
    database: db,
    paths: { include: [], exclude: [] },
    cache: { path: '' },
    diagnostics: { untyped: 'warning', unable_to_analyze: 'info', no_connection: 'warning' },
  };
}

describe('createDatabaseAdapter', () => {
  it('returns PGLiteAdapter when pglite is true', async () => {
    const adapter = await createDatabaseAdapter(
      makeConfig({ pglite: true, schema: 'schema.sql' })
    );
    expect(adapter).toBeInstanceOf(PGLiteAdapter);
    await adapter!.disconnect();
  });

  it('returns PgAdapter when url is set', async () => {
    const url = process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:54320/ts_sqlx_test';
    const adapter = await createDatabaseAdapter(makeConfig({ url }));
    expect(adapter).toBeInstanceOf(PgAdapter);
    await adapter!.disconnect();
  });

  it('returns null when no database configured', async () => {
    const adapter = await createDatabaseAdapter(makeConfig({}));
    expect(adapter).toBeNull();
  });

  it('prefers pglite when both pglite and url are set', async () => {
    const adapter = await createDatabaseAdapter(
      makeConfig({ pglite: true, schema: 'schema.sql', url: 'postgresql://unused' })
    );
    expect(adapter).toBeInstanceOf(PGLiteAdapter);
    await adapter!.disconnect();
  });
});
