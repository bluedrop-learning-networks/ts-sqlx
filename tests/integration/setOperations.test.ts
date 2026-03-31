import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@bluedrop-learning-networks/ts-sqlx-core/dbInferrer.js';
import { PGLiteAdapter } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('set operation type inference', () => {
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

  it('infers UNION column types', async () => {
    const r = await inferrer.infer(`
      SELECT id, email AS contact FROM users
      UNION
      SELECT id, email AS contact FROM users WHERE is_active = true
    `);
    expect(r.columns).toHaveLength(2);
    expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });
    expect(r.columns[1]).toMatchObject({ name: 'contact', tsType: 'string' });
  });

  it('infers UNION ALL preserves types', async () => {
    const r = await inferrer.infer(`
      SELECT id, title FROM posts WHERE view_count > 100
      UNION ALL
      SELECT id, title FROM posts WHERE view_count <= 100
    `);
    expect(r.columns).toHaveLength(2);
    expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'number' });
    expect(r.columns[1]).toMatchObject({ name: 'title', tsType: 'string' });
  });

  it('infers INTERSECT', async () => {
    const r = await inferrer.infer(`
      SELECT id FROM users WHERE is_active = true
      INTERSECT
      SELECT user_id AS id FROM comments
    `);
    expect(r.columns).toHaveLength(1);
    expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'string' }); // uuid
  });

  it('infers EXCEPT', async () => {
    const r = await inferrer.infer(`
      SELECT id FROM users
      EXCEPT
      SELECT author_id AS id FROM posts
    `);
    expect(r.columns).toHaveLength(1);
    expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });
  });

  it('infers UNION with different column counts fails gracefully', async () => {
    // PostgreSQL rejects this at parse time — should produce an error
    await expect(
      inferrer.infer('SELECT id, email FROM users UNION SELECT id FROM users')
    ).rejects.toThrow();
  });

  it('infers UNION with parameters', async () => {
    const r = await inferrer.infer(`
      SELECT id, email FROM users WHERE age > $1
      UNION
      SELECT id, email FROM users WHERE is_active = $2
    `);
    expect(r.params).toHaveLength(2);
    expect(r.params[0].tsType).toBe('number');  // integer
    expect(r.params[1].tsType).toBe('boolean');
  });

  it('infers multi-branch UNION', async () => {
    const r = await inferrer.infer(`
      SELECT 'user' AS entity_type, id::text AS entity_id FROM users
      UNION ALL
      SELECT 'post' AS entity_type, id::text AS entity_id FROM posts
      UNION ALL
      SELECT 'comment' AS entity_type, id::text AS entity_id FROM comments
    `);
    expect(r.columns).toHaveLength(2);
    expect(r.columns[0]).toMatchObject({ name: 'entity_type', tsType: 'string' });
    expect(r.columns[1]).toMatchObject({ name: 'entity_id', tsType: 'string' });
  });
});
