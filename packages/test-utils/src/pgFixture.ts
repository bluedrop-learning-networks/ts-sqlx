import { PgAdapter } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/database/pgAdapter.js';
import type { DatabaseAdapter } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/database/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../tests/fixtures');

const DEFAULT_TEST_URL = 'postgresql://test:test@localhost:54320/ts_sqlx_test';

export interface PgFixture {
  adapter: DatabaseAdapter;
  connectionUrl: string;
  setup(): Promise<void>;
  teardown(): Promise<void>;
}

/**
 * Ensure the test Docker Postgres is running.
 * Starts it if not already up. Requires Docker.
 */
function ensurePostgresRunning(): void {
  try {
    execSync(
      'docker compose -f docker-compose.test.yml up -d --wait',
      { cwd: path.resolve(__dirname, '../../..'), stdio: 'pipe', timeout: 60000 }
    );
  } catch (e) {
    throw new Error(
      `Failed to start test PostgreSQL. Is Docker running?\n${(e as Error).message}`
    );
  }
}

export async function createPgFixture(
  schemaPath?: string,
  connectionUrl?: string
): Promise<PgFixture> {
  const resolvedSchema = schemaPath ?? path.join(FIXTURES_DIR, 'schema.sql');
  const url = connectionUrl ?? process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_URL;

  // Auto-start Docker Postgres if TEST_DATABASE_URL is not explicitly set
  if (!process.env.TEST_DATABASE_URL) {
    ensurePostgresRunning();
  }

  const adapter = new PgAdapter(url);

  return {
    adapter,
    connectionUrl: url,
    async setup() {
      await adapter.connect();
      // Drop and recreate public schema for isolation between test suites
      await adapter.executeSchema('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      const schema = fs.readFileSync(resolvedSchema, 'utf8');
      await adapter.executeSchema(schema);
    },
    async teardown() {
      await adapter.disconnect();
    },
  };
}
