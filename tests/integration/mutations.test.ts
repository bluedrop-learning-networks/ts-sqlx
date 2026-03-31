import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@bluedrop-learning-networks/ts-sqlx-core/dbInferrer.js';
import { PGLiteAdapter } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('mutation type inference', () => {
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

  describe('UPDATE', () => {
    it('infers UPDATE without RETURNING (no columns)', async () => {
      const r = await inferrer.infer(
        'UPDATE users SET name = $1 WHERE id = $2'
      );
      expect(r.columns).toHaveLength(0);
      expect(r.params).toHaveLength(2);
      expect(r.params[0].tsType).toBe('string'); // text
      expect(r.params[1].tsType).toBe('string'); // uuid
    });

    it('infers UPDATE with RETURNING', async () => {
      const r = await inferrer.infer(
        'UPDATE users SET name = $1 WHERE id = $2 RETURNING id, email, name'
      );
      expect(r.columns).toHaveLength(3);
      expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[2]).toMatchObject({ name: 'name', tsType: 'string' });
    });

    it('infers UPDATE with FROM clause', async () => {
      const r = await inferrer.infer(`
        UPDATE posts SET title = $1
        FROM users
        WHERE posts.author_id = users.id AND users.email = $2
        RETURNING posts.id, posts.title
      `);
      expect(r.params).toHaveLength(2);
      expect(r.params[0].tsType).toBe('string'); // text
      expect(r.params[1].tsType).toBe('string'); // text
      expect(r.columns).toHaveLength(2);
    });

    it('infers UPDATE RETURNING *', async () => {
      const r = await inferrer.infer(
        'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING *'
      );
      expect(r.params).toHaveLength(2);
      // Should return all columns from users table
      expect(r.columns.length).toBeGreaterThanOrEqual(7);
    });
  });

  describe('DELETE', () => {
    it('infers DELETE without RETURNING (no columns)', async () => {
      const r = await inferrer.infer('DELETE FROM users WHERE id = $1');
      expect(r.columns).toHaveLength(0);
      expect(r.params).toHaveLength(1);
      expect(r.params[0].tsType).toBe('string'); // uuid
    });

    it('infers DELETE with RETURNING', async () => {
      const r = await inferrer.infer(
        'DELETE FROM users WHERE id = $1 RETURNING id, email'
      );
      expect(r.columns).toHaveLength(2);
      expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'email', tsType: 'string' });
    });

    it('infers DELETE with complex WHERE', async () => {
      const r = await inferrer.infer(`
        DELETE FROM posts
        WHERE author_id = $1 AND view_count < $2
        RETURNING id, title
      `);
      expect(r.params).toHaveLength(2);
      expect(r.params[0].tsType).toBe('string'); // uuid
      expect(r.params[1].tsType).toBe('string'); // bigint
    });
  });

  describe('INSERT ON CONFLICT (UPSERT)', () => {
    it('infers INSERT ON CONFLICT DO NOTHING', async () => {
      const r = await inferrer.infer(`
        INSERT INTO users (id, email, name)
        VALUES ($1, $2, $3)
        ON CONFLICT (email) DO NOTHING
        RETURNING id
      `);
      expect(r.params).toHaveLength(3);
      expect(r.columns).toHaveLength(1);
      expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });
    });

    it('infers INSERT ON CONFLICT DO UPDATE', async () => {
      const r = await inferrer.infer(`
        INSERT INTO users (id, email, name)
        VALUES ($1, $2, $3)
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
        RETURNING id, email, name
      `);
      expect(r.params).toHaveLength(3);
      expect(r.columns).toHaveLength(3);
      expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });
      expect(r.columns[1]).toMatchObject({ name: 'email', tsType: 'string' });
      expect(r.columns[2]).toMatchObject({ name: 'name', tsType: 'string' });
    });

    it('infers INSERT ON CONFLICT with WHERE clause', async () => {
      const r = await inferrer.infer(`
        INSERT INTO posts (author_id, title, body)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title
        WHERE posts.view_count < 100
        RETURNING id, title
      `);
      expect(r.params).toHaveLength(3);
      expect(r.columns).toHaveLength(2);
    });
  });
});
