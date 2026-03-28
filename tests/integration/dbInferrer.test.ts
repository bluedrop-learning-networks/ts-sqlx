import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@ts-sqlx/core/dbInferrer.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('DbInferrer', () => {
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

  it('infers simple SELECT columns', async () => {
    const result = await inferrer.infer('SELECT id, email, name FROM users');
    expect(result.columns).toHaveLength(3);
    expect(result.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });
    expect(result.columns[1]).toMatchObject({ name: 'email', tsType: 'string' });
    expect(result.columns[2]).toMatchObject({ name: 'name', tsType: 'string' });
  });

  it('infers parameter types', async () => {
    const result = await inferrer.infer('SELECT * FROM users WHERE id = $1');
    expect(result.params).toHaveLength(1);
    expect(result.params[0].tsType).toBe('string');
  });

  it('infers numeric types correctly', async () => {
    const result = await inferrer.infer(
      'SELECT regular_int, big_int, numeric_val FROM type_showcase'
    );
    expect(result.columns[0].tsType).toBe('number');
    expect(result.columns[1].tsType).toBe('string');
    expect(result.columns[2].tsType).toBe('string');
  });

  it('infers boolean type', async () => {
    const result = await inferrer.infer('SELECT bool_col FROM type_showcase');
    expect(result.columns[0].tsType).toBe('boolean');
  });

  it('infers date/time types', async () => {
    const result = await inferrer.infer(
      'SELECT date_col, timestamptz_col, time_col, interval_col FROM type_showcase'
    );
    expect(result.columns[0].tsType).toBe('Date');
    expect(result.columns[1].tsType).toBe('Date');
    expect(result.columns[2].tsType).toBe('string');
    expect(result.columns[3].tsType).toBe('string');
  });

  it('infers json as unknown', async () => {
    const result = await inferrer.infer('SELECT json_col, jsonb_col FROM type_showcase');
    expect(result.columns[0].tsType).toBe('unknown');
    expect(result.columns[1].tsType).toBe('unknown');
  });

  it('infers array types', async () => {
    const result = await inferrer.infer('SELECT int_array, text_array FROM type_showcase');
    expect(result.columns[0].tsType).toBe('number[]');
    expect(result.columns[1].tsType).toBe('string[]');
  });

  it('infers INSERT RETURNING', async () => {
    const result = await inferrer.infer(
      'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id, created_at'
    );
    expect(result.params).toHaveLength(2);
    expect(result.columns).toHaveLength(2);
    expect(result.columns[0]).toMatchObject({ name: 'id', tsType: 'string' });
    expect(result.columns[1]).toMatchObject({ name: 'created_at', tsType: 'Date' });
  });
});
