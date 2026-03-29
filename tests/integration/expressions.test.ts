import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@ts-sqlx/core/dbInferrer.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('expression type inference', () => {
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

  describe('CASE expressions', () => {
    it('infers CASE with string branches', async () => {
      const r = await inferrer.infer(`
        SELECT CASE
          WHEN is_active THEN 'active'
          ELSE 'inactive'
        END AS status
        FROM users
      `);
      expect(r.columns[0]).toMatchObject({ name: 'status', tsType: 'string' });
    });

    it('infers CASE with numeric branches', async () => {
      const r = await inferrer.infer(`
        SELECT CASE
          WHEN view_count > 100 THEN 1
          WHEN view_count > 10 THEN 2
          ELSE 3
        END AS tier
        FROM posts
      `);
      expect(r.columns[0]).toMatchObject({ name: 'tier', tsType: 'number' });
    });

    it('infers CASE returning column value', async () => {
      const r = await inferrer.infer(`
        SELECT CASE
          WHEN is_active THEN age
          ELSE NULL
        END AS maybe_age
        FROM users
      `);
      expect(r.columns[0]).toMatchObject({ name: 'maybe_age', tsType: 'number' });
    });
  });

  describe('string operations', () => {
    it('infers string concatenation with ||', async () => {
      const r = await inferrer.infer(
        "SELECT name || ' <' || email || '>' AS display FROM users"
      );
      expect(r.columns[0]).toMatchObject({ name: 'display', tsType: 'string' });
    });

    it('infers CONCAT function', async () => {
      const r = await inferrer.infer(
        "SELECT CONCAT(name, ' ', email) AS display FROM users"
      );
      expect(r.columns[0]).toMatchObject({ name: 'display', tsType: 'string' });
    });

    it('infers UPPER/LOWER', async () => {
      const r = await inferrer.infer(
        'SELECT UPPER(email) AS upper_email, LOWER(name) AS lower_name FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'upper_email', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'lower_name', tsType: 'string' });
    });

    it('infers LENGTH returns integer', async () => {
      const r = await inferrer.infer(
        'SELECT LENGTH(email) AS len FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'len', tsType: 'number' });
    });

    it('infers SUBSTRING', async () => {
      const r = await inferrer.infer(
        'SELECT SUBSTRING(email FROM 1 FOR 5) AS prefix FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'prefix', tsType: 'string' });
    });
  });

  describe('math operations', () => {
    it('infers arithmetic on integers', async () => {
      const r = await inferrer.infer(
        'SELECT regular_int + 1 AS plus_one, regular_int * 2 AS doubled FROM type_showcase'
      );
      expect(r.columns[0]).toMatchObject({ name: 'plus_one', tsType: 'number' });
      expect(r.columns[1]).toMatchObject({ name: 'doubled', tsType: 'number' });
    });

    it('infers ROUND/FLOOR/CEIL', async () => {
      const r = await inferrer.infer(
        'SELECT ROUND(numeric_val) AS rounded, FLOOR(real_num) AS floored, CEIL(double_num) AS ceiled FROM type_showcase'
      );
      expect(r.columns[0]).toMatchObject({ name: 'rounded', tsType: 'string' }); // numeric
      expect(r.columns[1]).toMatchObject({ name: 'floored', tsType: 'number' });  // real
      expect(r.columns[2]).toMatchObject({ name: 'ceiled', tsType: 'number' });   // double
    });

    it('infers ABS', async () => {
      const r = await inferrer.infer(
        'SELECT ABS(regular_int) AS abs_val FROM type_showcase'
      );
      expect(r.columns[0]).toMatchObject({ name: 'abs_val', tsType: 'number' });
    });
  });

  describe('date/time functions', () => {
    it('infers EXTRACT returns numeric', async () => {
      const r = await inferrer.infer(
        'SELECT EXTRACT(YEAR FROM created_at) AS yr FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'yr', tsType: 'string' }); // numeric
    });

    it('infers DATE_TRUNC returns timestamp', async () => {
      const r = await inferrer.infer(
        "SELECT DATE_TRUNC('month', created_at) AS month_start FROM users"
      );
      expect(r.columns[0]).toMatchObject({ name: 'month_start', tsType: 'Date' });
    });

    it('infers AGE returns interval', async () => {
      const r = await inferrer.infer(
        'SELECT AGE(created_at) AS account_age FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'account_age', tsType: 'string' }); // interval
    });

    it('infers NOW()', async () => {
      const r = await inferrer.infer('SELECT NOW() AS current_time');
      expect(r.columns[0]).toMatchObject({ name: 'current_time', tsType: 'Date' });
    });
  });

  describe('boolean expressions', () => {
    it('infers comparison operators return boolean', async () => {
      const r = await inferrer.infer(
        'SELECT (age > 18) AS is_adult, (name IS NOT NULL) AS has_name FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'is_adult', tsType: 'boolean' });
      expect(r.columns[1]).toMatchObject({ name: 'has_name', tsType: 'boolean' });
    });

    it('infers EXISTS returns boolean', async () => {
      const r = await inferrer.infer(`
        SELECT u.email,
          EXISTS(SELECT 1 FROM posts p WHERE p.author_id = u.id) AS has_posts
        FROM users u
      `);
      expect(r.columns).toHaveLength(2);
      expect(r.columns[1]).toMatchObject({ name: 'has_posts', tsType: 'boolean' });
    });

    it('infers IN returns boolean', async () => {
      const r = await inferrer.infer(
        "SELECT email, (age IN (18, 21, 25)) AS is_special_age FROM users"
      );
      expect(r.columns[1]).toMatchObject({ name: 'is_special_age', tsType: 'boolean' });
    });
  });

  describe('subquery varieties', () => {
    it('infers scalar subquery in SELECT', async () => {
      const r = await inferrer.infer(`
        SELECT u.email,
          (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id) AS post_count
        FROM users u
      `);
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'post_count', tsType: 'string' }); // bigint
    });

    it('infers derived table (subquery in FROM)', async () => {
      const r = await inferrer.infer(`
        SELECT sq.email, sq.cnt
        FROM (
          SELECT u.email, COUNT(p.id) AS cnt
          FROM users u
          LEFT JOIN posts p ON p.author_id = u.id
          GROUP BY u.email
        ) sq
      `);
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'cnt', tsType: 'string' }); // bigint
    });

    it('infers subquery with IN', async () => {
      const r = await inferrer.infer(`
        SELECT id, email FROM users
        WHERE id IN (SELECT author_id FROM posts WHERE view_count > $1)
      `);
      expect(r.columns).toHaveLength(2);
      expect(r.params).toHaveLength(1);
      expect(r.params[0].tsType).toBe('string'); // bigint
    });
  });

  describe('type casting', () => {
    it('infers ::text cast', async () => {
      const r = await inferrer.infer('SELECT id::text AS id_text FROM posts');
      expect(r.columns[0]).toMatchObject({ name: 'id_text', tsType: 'string' });
    });

    it('infers CAST(x AS type)', async () => {
      const r = await inferrer.infer(
        'SELECT CAST(view_count AS INTEGER) AS vc FROM posts'
      );
      expect(r.columns[0]).toMatchObject({ name: 'vc', tsType: 'number' });
    });

    it('infers ::integer cast', async () => {
      const r = await inferrer.infer(
        "SELECT '42'::integer AS num"
      );
      expect(r.columns[0]).toMatchObject({ name: 'num', tsType: 'number' });
    });
  });

  describe('GREATEST / LEAST', () => {
    it('infers GREATEST with integers', async () => {
      const r = await inferrer.infer(
        'SELECT GREATEST(regular_int, small_int, 0) AS max_val FROM type_showcase'
      );
      expect(r.columns[0]).toMatchObject({ name: 'max_val', tsType: 'number' });
    });

    it('infers LEAST with timestamps', async () => {
      const r = await inferrer.infer(
        'SELECT LEAST(created_at, updated_at) AS earliest FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'earliest', tsType: 'Date' });
    });
  });

  describe('BETWEEN and LIKE', () => {
    it('infers query with BETWEEN parameter', async () => {
      const r = await inferrer.infer(
        'SELECT id, email FROM users WHERE age BETWEEN $1 AND $2'
      );
      expect(r.params).toHaveLength(2);
      expect(r.params[0].tsType).toBe('number'); // integer
      expect(r.params[1].tsType).toBe('number');
    });

    it('infers query with LIKE parameter', async () => {
      const r = await inferrer.infer(
        'SELECT id, email FROM users WHERE email LIKE $1'
      );
      expect(r.params).toHaveLength(1);
      expect(r.params[0].tsType).toBe('string');
    });

    it('infers query with ILIKE', async () => {
      const r = await inferrer.infer(
        'SELECT id, name FROM users WHERE name ILIKE $1'
      );
      expect(r.params).toHaveLength(1);
      expect(r.params[0].tsType).toBe('string');
    });
  });
});
