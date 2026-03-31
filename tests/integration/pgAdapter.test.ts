import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PgAdapter } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/database/pgAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:54320/ts_sqlx_test';

describe('PgAdapter', () => {
  let adapter: PgAdapter;

  beforeAll(async () => {
    adapter = new PgAdapter(TEST_URL);
    await adapter.connect();
    // Drop existing objects so tests are idempotent
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

  it('reports connected after connect', () => {
    expect(adapter.isConnected()).toBe(true);
  });

  it('describes a simple SELECT', async () => {
    const info = await adapter.describeQuery(
      'SELECT id, email, name FROM users WHERE id = $1'
    );
    expect(info.params).toHaveLength(1);
    expect(info.params[0].name).toBe('uuid');

    expect(info.columns).toHaveLength(3);
    expect(info.columns[0].name).toBe('id');
    expect(info.columns[1].name).toBe('email');
    expect(info.columns[2].name).toBe('name');
  });

  it('describes INSERT with multiple params', async () => {
    const info = await adapter.describeQuery(
      'INSERT INTO users (id, email, name) VALUES ($1, $2, $3) RETURNING id'
    );
    expect(info.params).toHaveLength(3);
    expect(info.columns).toHaveLength(1);
    expect(info.columns[0].name).toBe('id');
  });

  it('describes INSERT without RETURNING (no columns)', async () => {
    const info = await adapter.describeQuery(
      'INSERT INTO users (id, email, name) VALUES ($1, $2, $3)'
    );
    expect(info.params).toHaveLength(3);
    expect(info.columns).toHaveLength(0);
  });

  it('returns enum values', async () => {
    const values = await adapter.getEnumValues('status_enum');
    expect(values).toEqual(['draft', 'published', 'archived']);
  });

  it('returns composite fields', async () => {
    const fields = await adapter.getCompositeFields('address');
    expect(fields).toHaveLength(3);
    expect(fields[0].name).toBe('street');
    expect(fields[1].name).toBe('city');
    expect(fields[2].name).toBe('zip');
  });

  it('throws when not connected', async () => {
    const disconnected = new PgAdapter(TEST_URL);
    await expect(disconnected.describeQuery('SELECT 1')).rejects.toThrow('Not connected');
  });

  it('reports not connected after disconnect', async () => {
    const temp = new PgAdapter(TEST_URL);
    await temp.connect();
    await temp.disconnect();
    expect(temp.isConnected()).toBe(false);
  });
});
