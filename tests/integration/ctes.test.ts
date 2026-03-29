import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@ts-sqlx/core/dbInferrer.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('CTE type inference', () => {
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

  it('infers simple CTE', async () => {
    const r = await inferrer.infer(`
      WITH active_users AS (
        SELECT id, email FROM users WHERE is_active = true
      )
      SELECT id, email FROM active_users
    `);
    expect(r.columns).toHaveLength(2);
    expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });
    expect(r.columns[1]).toMatchObject({ name: 'email', tsType: 'string' });
  });

  it('infers CTE with aggregation', async () => {
    const r = await inferrer.infer(`
      WITH user_stats AS (
        SELECT author_id, COUNT(*) AS post_count, SUM(view_count) AS total_views
        FROM posts
        GROUP BY author_id
      )
      SELECT u.email, s.post_count, s.total_views
      FROM users u
      INNER JOIN user_stats s ON s.author_id = u.id
    `);
    expect(r.columns).toHaveLength(3);
    expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
    expect(r.columns[1]).toMatchObject({ name: 'post_count', tsType: 'string' }); // bigint
    expect(r.columns[2]).toMatchObject({ name: 'total_views', tsType: 'string' }); // bigint
  });

  it('infers multiple CTEs', async () => {
    const r = await inferrer.infer(`
      WITH
        active AS (SELECT id, email FROM users WHERE is_active = true),
        recent_posts AS (SELECT author_id, title FROM posts ORDER BY published_at DESC LIMIT 10)
      SELECT a.email, rp.title
      FROM active a
      INNER JOIN recent_posts rp ON rp.author_id = a.id
    `);
    expect(r.columns).toHaveLength(2);
    expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
    expect(r.columns[1]).toMatchObject({ name: 'title', tsType: 'string' });
  });

  it('infers CTE referencing another CTE', async () => {
    const r = await inferrer.infer(`
      WITH
        post_stats AS (
          SELECT author_id, COUNT(*) AS cnt FROM posts GROUP BY author_id
        ),
        top_authors AS (
          SELECT author_id, cnt FROM post_stats WHERE cnt > 5
        )
      SELECT u.email, t.cnt
      FROM users u
      INNER JOIN top_authors t ON t.author_id = u.id
    `);
    expect(r.columns).toHaveLength(2);
    expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
    expect(r.columns[1]).toMatchObject({ name: 'cnt', tsType: 'string' }); // bigint
  });

  it('infers recursive CTE', async () => {
    const r = await inferrer.infer(`
      WITH RECURSIVE cat_tree AS (
        SELECT id, name, parent_id, 1 AS depth
        FROM categories
        WHERE parent_id IS NULL
        UNION ALL
        SELECT c.id, c.name, c.parent_id, ct.depth + 1
        FROM categories c
        INNER JOIN cat_tree ct ON ct.id = c.parent_id
      )
      SELECT id, name, depth FROM cat_tree
    `);
    expect(r.columns).toHaveLength(3);
    expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'number' });
    expect(r.columns[1]).toMatchObject({ name: 'name', tsType: 'string' });
    expect(r.columns[2]).toMatchObject({ name: 'depth', tsType: 'number' });
  });

  it('infers CTE with parameters', async () => {
    const r = await inferrer.infer(`
      WITH user_posts AS (
        SELECT title, view_count FROM posts WHERE author_id = $1
      )
      SELECT title, view_count FROM user_posts WHERE view_count > $2
    `);
    expect(r.params).toHaveLength(2);
    expect(r.params[0].tsType).toBe('string'); // uuid
    expect(r.params[1].tsType).toBe('string'); // bigint
  });
});
