import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PgAdapter } from '@ts-sqlx/core/adapters/database/pgAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:54320/ts_sqlx_test';

describe('JOIN nullability (PgAdapter)', () => {
  let adapter: PgAdapter;

  beforeAll(async () => {
    adapter = new PgAdapter(TEST_URL);
    await adapter.connect();
    await adapter.executeSchema('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const schema = fs.readFileSync(
      path.join(__dirname, '../fixtures/schema.sql'),
      'utf8'
    );
    await adapter.executeSchema(schema);
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  // NOTE: PostgreSQL's prepared-statement Describe protocol reports column
  // nullability based on the underlying table definition, NOT adjusted for
  // JOIN type. LEFT/RIGHT/FULL OUTER JOINs can produce NULL for NOT NULL
  // columns at runtime, but the protocol doesn't reflect this. These tests
  // document that current behavior — they will need updating if ts-sqlx adds
  // its own JOIN-aware nullability analysis layer.

  it('INNER JOIN preserves NOT NULL from both sides', async () => {
    const info = await adapter.describeQuery(
      'SELECT u.email, p.title FROM users u INNER JOIN posts p ON p.author_id = u.id'
    );
    const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));
    expect(byName.email.nullable).toBe(false);
    expect(byName.title.nullable).toBe(false);
  });

  it('LEFT JOIN reports table-level nullability (not join-adjusted)', async () => {
    const info = await adapter.describeQuery(
      'SELECT u.email, p.title FROM users u LEFT JOIN posts p ON p.author_id = u.id'
    );
    const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));
    expect(byName.email.nullable).toBe(false);
    // p.title is NOT NULL in schema — PG describe doesn't adjust for LEFT JOIN
    expect(byName.title.nullable).toBe(false);
  });

  it('RIGHT JOIN reports table-level nullability (not join-adjusted)', async () => {
    const info = await adapter.describeQuery(
      'SELECT u.email, p.title FROM users u RIGHT JOIN posts p ON p.author_id = u.id'
    );
    const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));
    // u.email is NOT NULL in schema — PG describe doesn't adjust for RIGHT JOIN
    expect(byName.email.nullable).toBe(false);
    expect(byName.title.nullable).toBe(false);
  });

  it('FULL OUTER JOIN reports table-level nullability (not join-adjusted)', async () => {
    const info = await adapter.describeQuery(
      'SELECT u.email, p.title FROM users u FULL OUTER JOIN posts p ON p.author_id = u.id'
    );
    const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));
    // Both are NOT NULL in schema — PG describe doesn't adjust for FULL OUTER
    expect(byName.email.nullable).toBe(false);
    expect(byName.title.nullable).toBe(false);
  });

  it('CROSS JOIN preserves original nullability', async () => {
    const info = await adapter.describeQuery(
      'SELECT u.email, u.name FROM users u CROSS JOIN categories c'
    );
    const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));
    expect(byName.email.nullable).toBe(false); // NOT NULL
    expect(byName.name.nullable).toBe(true);   // nullable
  });

  it('multi-level LEFT JOIN reports table-level nullability', async () => {
    const info = await adapter.describeQuery(`
      SELECT u.email, p.title, c.content
      FROM users u
      LEFT JOIN posts p ON p.author_id = u.id
      LEFT JOIN comments c ON c.post_id = p.id
    `);
    const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));
    expect(byName.email.nullable).toBe(false);
    // title and content are NOT NULL in schema — PG describe doesn't adjust
    expect(byName.title.nullable).toBe(false);
    expect(byName.content.nullable).toBe(false);
  });
});
