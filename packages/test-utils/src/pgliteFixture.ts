import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import type { DatabaseAdapter } from '@ts-sqlx/core/adapters/database/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../tests/fixtures');

export interface PGLiteFixture {
  adapter: DatabaseAdapter;
  setup(): Promise<void>;
  teardown(): Promise<void>;
}

export async function createPGLiteFixture(
  schemaPath?: string
): Promise<PGLiteFixture> {
  const resolvedSchema = schemaPath ?? path.join(FIXTURES_DIR, 'schema.sql');
  const adapter = await PGLiteAdapter.create();

  return {
    adapter,
    async setup() {
      const schema = fs.readFileSync(resolvedSchema, 'utf8');
      await adapter.executeSchema(schema);
    },
    async teardown() {
      await adapter.disconnect();
    },
  };
}
