import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@bluedrop-learning-networks/ts-sqlx-core/dbInferrer.js';
import { PGLiteAdapter } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('return type inference', () => {
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

  describe('scalar types', () => {
    it('maps integer types', async () => {
      const r = await inferrer.infer('SELECT small_int, regular_int, big_int FROM type_showcase');
      expect(r.columns[0].tsType).toBe('number');  // smallint
      expect(r.columns[1].tsType).toBe('number');  // int
      expect(r.columns[2].tsType).toBe('string');   // bigint
    });

    it('maps float types', async () => {
      const r = await inferrer.infer('SELECT real_num, double_num, numeric_val FROM type_showcase');
      expect(r.columns[0].tsType).toBe('number');
      expect(r.columns[1].tsType).toBe('number');
      expect(r.columns[2].tsType).toBe('string');
    });

    it('maps text types', async () => {
      const r = await inferrer.infer('SELECT char_col, varchar_col, text_col FROM type_showcase');
      expect(r.columns[0].tsType).toBe('string');
      expect(r.columns[1].tsType).toBe('string');
      expect(r.columns[2].tsType).toBe('string');
    });

    it('maps boolean', async () => {
      const r = await inferrer.infer('SELECT bool_col FROM type_showcase');
      expect(r.columns[0].tsType).toBe('boolean');
    });

    it('maps uuid', async () => {
      const r = await inferrer.infer('SELECT uuid_col FROM type_showcase');
      expect(r.columns[0].tsType).toBe('string');
    });

    it('maps date/time types', async () => {
      const r = await inferrer.infer(
        'SELECT date_col, timestamp_col, timestamptz_col, time_col, interval_col FROM type_showcase'
      );
      expect(r.columns[0].tsType).toBe('Date');
      expect(r.columns[1].tsType).toBe('Date');
      expect(r.columns[2].tsType).toBe('Date');
      expect(r.columns[3].tsType).toBe('string');
      expect(r.columns[4].tsType).toBe('string');
    });

    it('maps json/jsonb to unknown', async () => {
      const r = await inferrer.infer('SELECT json_col, jsonb_col FROM type_showcase');
      expect(r.columns[0].tsType).toBe('unknown');
      expect(r.columns[1].tsType).toBe('unknown');
    });

    it('maps bytea to Buffer', async () => {
      const r = await inferrer.infer('SELECT bytes FROM type_showcase');
      expect(r.columns[0].tsType).toBe('Buffer');
    });
  });

  describe('array types', () => {
    it('maps integer arrays', async () => {
      const r = await inferrer.infer('SELECT int_array FROM type_showcase');
      expect(r.columns[0].tsType).toBe('number[]');
    });

    it('maps text arrays', async () => {
      const r = await inferrer.infer('SELECT text_array FROM type_showcase');
      expect(r.columns[0].tsType).toBe('string[]');
    });
  });

  describe('expressions', () => {
    it('infers COUNT as string (bigint)', async () => {
      const r = await inferrer.infer('SELECT COUNT(*) as cnt FROM users');
      expect(r.columns[0].tsType).toBe('string');
    });

    it('infers aliased columns', async () => {
      const r = await inferrer.infer('SELECT id AS user_id FROM users');
      expect(r.columns[0].name).toBe('user_id');
    });
  });
});
