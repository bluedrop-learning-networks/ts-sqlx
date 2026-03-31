import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PgAdapter } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/database/pgAdapter.js';
import { PGLiteAdapter } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:54320/ts_sqlx_test';

describe('Nullability: PgAdapter vs PGLite', () => {
  let pgAdapter: PgAdapter;
  let pgliteAdapter: PGLiteAdapter;
  let schema: string;

  beforeAll(async () => {
    schema = fs.readFileSync(
      path.join(__dirname, '../fixtures/schema.sql'),
      'utf8'
    );

    pgAdapter = new PgAdapter(TEST_URL);
    await pgAdapter.connect();
    await pgAdapter.executeSchema('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await pgAdapter.executeSchema(schema);

    pgliteAdapter = await PGLiteAdapter.create();
    await pgliteAdapter.executeSchema(schema);
  });

  afterAll(async () => {
    await pgAdapter.disconnect();
    await pgliteAdapter.disconnect();
  });

  describe('PgAdapter returns accurate nullability', () => {
    it('NOT NULL columns are non-nullable', async () => {
      const info = await pgAdapter.describeQuery(
        'SELECT id, email, is_active, created_at FROM users'
      );
      const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));

      expect(byName.id.nullable).toBe(false);
      expect(byName.email.nullable).toBe(false);
      expect(byName.is_active.nullable).toBe(false);
      expect(byName.created_at.nullable).toBe(false);
    });

    it('nullable columns are nullable', async () => {
      const info = await pgAdapter.describeQuery(
        'SELECT name, age, updated_at FROM users'
      );
      const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));

      expect(byName.name.nullable).toBe(true);
      expect(byName.age.nullable).toBe(true);
      expect(byName.updated_at.nullable).toBe(true);
    });

    it('mixed nullability in one query', async () => {
      const info = await pgAdapter.describeQuery(
        'SELECT id, title, body, view_count FROM posts'
      );
      const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));

      expect(byName.id.nullable).toBe(false);
      expect(byName.title.nullable).toBe(false);
      expect(byName.body.nullable).toBe(true);
      expect(byName.view_count.nullable).toBe(false);
    });

    it('type_showcase NOT NULL vs nullable', async () => {
      const info = await pgAdapter.describeQuery(
        'SELECT regular_int, small_int, text_col, char_col, bool_col, json_col, jsonb_col, timestamptz_col FROM type_showcase'
      );
      const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));

      expect(byName.regular_int.nullable).toBe(false);
      expect(byName.small_int.nullable).toBe(true);
      expect(byName.text_col.nullable).toBe(false);
      expect(byName.char_col.nullable).toBe(true);
      expect(byName.bool_col.nullable).toBe(false);
      expect(byName.json_col.nullable).toBe(true);
      expect(byName.jsonb_col.nullable).toBe(false);
      expect(byName.timestamptz_col.nullable).toBe(false);
    });

    it('expressions default to nullable', async () => {
      const info = await pgAdapter.describeQuery(
        'SELECT COUNT(*) AS cnt, now() AS current_time FROM users'
      );
      const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));

      expect(byName.cnt.nullable).toBe(true);
      expect(byName.current_time.nullable).toBe(true);
    });

    it('INSERT RETURNING preserves nullability', async () => {
      const info = await pgAdapter.describeQuery(
        'INSERT INTO users (id, email, name) VALUES ($1, $2, $3) RETURNING id, email, name'
      );
      const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));

      expect(byName.id.nullable).toBe(false);
      expect(byName.email.nullable).toBe(false);
      expect(byName.name.nullable).toBe(true);
    });
  });

  describe('PGLite returns accurate nullability via execProtocol', () => {
    it('NOT NULL columns are reported as non-nullable', async () => {
      const info = await pgliteAdapter.describeQuery(
        'SELECT id, email, is_active FROM users'
      );
      for (const col of info.columns) {
        expect(col.nullable).toBe(false);
      }
    });
  });
});
