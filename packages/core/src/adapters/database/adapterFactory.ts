import type { TsSqlxConfig } from '../../config.js';
import type { DatabaseAdapter } from './types.js';
import { PGLiteAdapter } from './pgliteAdapter.js';
import { PgAdapter } from './pgAdapter.js';

export async function createDatabaseAdapter(
  config: TsSqlxConfig
): Promise<DatabaseAdapter | null> {
  if (config.database.pglite) {
    return PGLiteAdapter.create();
  }

  if (config.database.url) {
    const adapter = new PgAdapter(config.database.url);
    await adapter.connect();
    return adapter;
  }

  return null;
}
