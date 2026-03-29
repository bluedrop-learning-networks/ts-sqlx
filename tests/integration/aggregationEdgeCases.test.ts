import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@ts-sqlx/core/dbInferrer.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('aggregation edge cases', () => {
  let adapter: PGLiteAdapter;
  let inferrer: DbInferrer;

  beforeAll(async () => {
    adapter = await PGLiteAdapter.create();
    const schema = fs.readFileSync(
      path.join(__dirname, '../fixtures/schema.sql'),
      'utf8'
    );
    await adapter.executeSchema(schema);
    inferrer = new DbInferrer(adapter);
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  describe('aggregate return types', () => {
    it('infers SUM of integer returns bigint (string)', async () => {
      const r = await inferrer.infer(
        'SELECT SUM(regular_int) AS total FROM type_showcase'
      );
      expect(r.columns[0]).toMatchObject({ name: 'total', tsType: 'string' }); // SUM(int) → bigint
    });

    it('infers AVG returns string (numeric)', async () => {
      const r = await inferrer.infer(
        'SELECT AVG(regular_int) AS avg_val FROM type_showcase'
      );
      expect(r.columns[0]).toMatchObject({ name: 'avg_val', tsType: 'string' }); // AVG → numeric
    });

    it('infers MIN/MAX preserve input type', async () => {
      const r = await inferrer.infer(
        'SELECT MIN(regular_int) AS min_val, MAX(regular_int) AS max_val FROM type_showcase'
      );
      expect(r.columns[0]).toMatchObject({ name: 'min_val', tsType: 'number' }); // int → int
      expect(r.columns[1]).toMatchObject({ name: 'max_val', tsType: 'number' });
    });

    it('infers BOOL_AND/BOOL_OR return boolean', async () => {
      const r = await inferrer.infer(
        'SELECT BOOL_AND(is_active) AS all_active, BOOL_OR(is_active) AS any_active FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'all_active', tsType: 'boolean' });
      expect(r.columns[1]).toMatchObject({ name: 'any_active', tsType: 'boolean' });
    });
  });

  describe('STRING_AGG and ARRAY_AGG', () => {
    it('infers STRING_AGG returns string', async () => {
      const r = await inferrer.infer(
        "SELECT STRING_AGG(email, ', ') AS emails FROM users"
      );
      expect(r.columns[0]).toMatchObject({ name: 'emails', tsType: 'string' });
    });

    it('infers ARRAY_AGG returns array', async () => {
      const r = await inferrer.infer(
        'SELECT ARRAY_AGG(email) AS emails FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'emails', tsType: 'string[]' });
    });

    it('infers ARRAY_AGG with ORDER BY', async () => {
      const r = await inferrer.infer(
        'SELECT ARRAY_AGG(title ORDER BY view_count DESC) AS titles FROM posts'
      );
      expect(r.columns[0]).toMatchObject({ name: 'titles', tsType: 'string[]' });
    });
  });

  describe('COALESCE with aggregates', () => {
    it('infers COALESCE(COUNT(*), 0)', async () => {
      const r = await inferrer.infer(
        'SELECT COALESCE(COUNT(*), 0) AS cnt FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'cnt', tsType: 'string' }); // bigint
    });

    it('infers COALESCE(SUM(int), 0)', async () => {
      const r = await inferrer.infer(
        'SELECT COALESCE(SUM(regular_int), 0) AS total FROM type_showcase'
      );
      // SUM(int) returns bigint → string; COALESCE preserves that
      expect(r.columns[0]).toMatchObject({ name: 'total', tsType: 'string' });
    });

    it('infers COALESCE on nullable column with fallback', async () => {
      const r = await inferrer.infer(
        "SELECT COALESCE(name, 'Anonymous') AS display_name FROM users"
      );
      expect(r.columns[0]).toMatchObject({ name: 'display_name', tsType: 'string' });
    });
  });

  describe('FILTER clause', () => {
    it('infers COUNT with FILTER', async () => {
      const r = await inferrer.infer(
        'SELECT COUNT(*) FILTER (WHERE is_active) AS active_count FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'active_count', tsType: 'string' }); // bigint
    });

    it('infers SUM with FILTER', async () => {
      const r = await inferrer.infer(
        'SELECT SUM(view_count) FILTER (WHERE view_count > 0) AS total FROM posts'
      );
      expect(r.columns[0]).toMatchObject({ name: 'total', tsType: 'string' }); // bigint
    });
  });

  describe('GROUP BY + HAVING', () => {
    it('infers GROUP BY with multiple columns', async () => {
      const r = await inferrer.infer(`
        SELECT author_id, COUNT(*) AS cnt
        FROM posts
        GROUP BY author_id
        HAVING COUNT(*) > 1
      `);
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'author_id', tsType: 'string' }); // uuid
      expect(r.columns[1]).toMatchObject({ name: 'cnt', tsType: 'string' }); // bigint
    });

    it('infers GROUP BY with CASE', async () => {
      const r = await inferrer.infer(`
        SELECT
          CASE WHEN view_count > 100 THEN 'popular' ELSE 'normal' END AS category,
          COUNT(*) AS cnt
        FROM posts
        GROUP BY 1
      `);
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'category', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'cnt', tsType: 'string' });
    });
  });
});
