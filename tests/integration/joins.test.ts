import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@bluedrop-learning-networks/ts-sqlx-core/dbInferrer.js';
import { PGLiteAdapter } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('JOIN type inference', () => {
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

  describe('INNER JOIN', () => {
    it('infers columns from both tables', async () => {
      const r = await inferrer.infer(
        'SELECT u.id, u.email, p.title FROM users u INNER JOIN posts p ON p.author_id = u.id'
      );
      expect(r.columns).toHaveLength(3);
      expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[2]).toMatchObject({ name: 'title', tsType: 'string' });
    });

    it('infers three-table join', async () => {
      const r = await inferrer.infer(`
        SELECT u.email, p.title, c.content
        FROM users u
        INNER JOIN posts p ON p.author_id = u.id
        INNER JOIN comments c ON c.post_id = p.id
      `);
      expect(r.columns).toHaveLength(3);
      expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'title', tsType: 'string' });
      expect(r.columns[2]).toMatchObject({ name: 'content', tsType: 'string' });
    });
  });

  describe('LEFT JOIN', () => {
    it('infers columns from left-joined table', async () => {
      const r = await inferrer.infer(
        'SELECT u.id, u.email, p.title FROM users u LEFT JOIN posts p ON p.author_id = u.id'
      );
      expect(r.columns).toHaveLength(3);
      // p.title comes from the optional side — type should still be string
      // (nullability is a separate concern tested in joinNullability.test.ts)
      expect(r.columns[2]).toMatchObject({ name: 'title', tsType: 'string' });
    });
  });

  describe('RIGHT JOIN', () => {
    it('infers columns from right-joined table', async () => {
      const r = await inferrer.infer(
        'SELECT u.email, p.title FROM users u RIGHT JOIN posts p ON p.author_id = u.id'
      );
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'title', tsType: 'string' });
    });
  });

  describe('FULL OUTER JOIN', () => {
    it('infers columns from full outer join', async () => {
      const r = await inferrer.infer(
        'SELECT u.email, p.title FROM users u FULL OUTER JOIN posts p ON p.author_id = u.id'
      );
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'title', tsType: 'string' });
    });
  });

  describe('CROSS JOIN', () => {
    it('infers columns from cross join', async () => {
      const r = await inferrer.infer(
        'SELECT u.email, c.name FROM users u CROSS JOIN categories c'
      );
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'name', tsType: 'string' });
    });
  });

  describe('self-join', () => {
    it('infers self-join on categories', async () => {
      const r = await inferrer.infer(
        'SELECT c.name AS child, p.name AS parent FROM categories c LEFT JOIN categories p ON p.id = c.parent_id'
      );
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'child', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'parent', tsType: 'string' });
    });
  });

  describe('JOIN with aggregation', () => {
    it('infers join with COUNT', async () => {
      const r = await inferrer.infer(`
        SELECT u.email, COUNT(p.id) AS post_count
        FROM users u
        LEFT JOIN posts p ON p.author_id = u.id
        GROUP BY u.email
      `);
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'post_count', tsType: 'string' }); // COUNT returns bigint → string
    });
  });

  describe('JOIN with parameters', () => {
    it('infers param types across joins', async () => {
      const r = await inferrer.infer(`
        SELECT u.email, p.title
        FROM users u
        INNER JOIN posts p ON p.author_id = u.id
        WHERE u.is_active = $1 AND p.view_count > $2
      `);
      expect(r.params).toHaveLength(2);
      expect(r.params[0].tsType).toBe('boolean');
      expect(r.params[1].tsType).toBe('string'); // bigint → string
    });
  });
});
