import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGLiteAdapter } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('PGLiteAdapter', () => {
  let adapter: PGLiteAdapter;

  beforeAll(async () => {
    adapter = await PGLiteAdapter.create();
    const schema = fs.readFileSync(
      path.join(__dirname, '../fixtures/schema.sql'),
      'utf8'
    );
    await adapter.executeSchema(schema);
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  it('reports connected after create', () => {
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

  it('returns enum values', async () => {
    const values = await adapter.getEnumValues('status_enum');
    expect(values).toEqual(['draft', 'published', 'archived']);
  });

  it('reports not connected after disconnect', async () => {
    const temp = await PGLiteAdapter.create();
    await temp.disconnect();
    expect(temp.isConnected()).toBe(false);
  });
});
