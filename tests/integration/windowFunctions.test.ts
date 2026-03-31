import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@bluedrop-learning-networks/ts-sqlx-core/dbInferrer.js';
import { PGLiteAdapter } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('window function type inference', () => {
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

  it('infers ROW_NUMBER()', async () => {
    const r = await inferrer.infer(
      'SELECT id, email, ROW_NUMBER() OVER (ORDER BY created_at) AS rn FROM users'
    );
    expect(r.columns).toHaveLength(3);
    expect(r.columns[2]).toMatchObject({ name: 'rn', tsType: 'string' }); // bigint
  });

  it('infers RANK() and DENSE_RANK()', async () => {
    const r = await inferrer.infer(`
      SELECT id,
        RANK() OVER (ORDER BY view_count DESC) AS rnk,
        DENSE_RANK() OVER (ORDER BY view_count DESC) AS drnk
      FROM posts
    `);
    expect(r.columns).toHaveLength(3);
    expect(r.columns[1]).toMatchObject({ name: 'rnk', tsType: 'string' });  // bigint
    expect(r.columns[2]).toMatchObject({ name: 'drnk', tsType: 'string' }); // bigint
  });

  it('infers LAG() and LEAD()', async () => {
    const r = await inferrer.infer(`
      SELECT id, title,
        LAG(title) OVER (ORDER BY id) AS prev_title,
        LEAD(title) OVER (ORDER BY id) AS next_title
      FROM posts
    `);
    expect(r.columns).toHaveLength(4);
    expect(r.columns[2]).toMatchObject({ name: 'prev_title', tsType: 'string' });
    expect(r.columns[3]).toMatchObject({ name: 'next_title', tsType: 'string' });
  });

  it('infers SUM() OVER window', async () => {
    const r = await inferrer.infer(`
      SELECT id, view_count,
        SUM(view_count) OVER (ORDER BY id) AS running_total
      FROM posts
    `);
    expect(r.columns).toHaveLength(3);
    expect(r.columns[2]).toMatchObject({ name: 'running_total', tsType: 'string' }); // bigint SUM
  });

  it('infers window with PARTITION BY', async () => {
    const r = await inferrer.infer(`
      SELECT author_id, title,
        ROW_NUMBER() OVER (PARTITION BY author_id ORDER BY view_count DESC) AS author_rank
      FROM posts
    `);
    expect(r.columns).toHaveLength(3);
    expect(r.columns[2]).toMatchObject({ name: 'author_rank', tsType: 'string' }); // bigint
  });

  it('infers window alongside regular columns', async () => {
    const r = await inferrer.infer(`
      SELECT u.email, p.title,
        COUNT(*) OVER () AS total_posts
      FROM users u
      INNER JOIN posts p ON p.author_id = u.id
    `);
    expect(r.columns).toHaveLength(3);
    expect(r.columns[0]).toMatchObject({ name: 'email', tsType: 'string' });
    expect(r.columns[1]).toMatchObject({ name: 'title', tsType: 'string' });
    expect(r.columns[2]).toMatchObject({ name: 'total_posts', tsType: 'string' }); // bigint
  });
});
