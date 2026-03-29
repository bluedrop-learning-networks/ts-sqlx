import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@ts-sqlx/core/dbInferrer.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('JSON operator type inference', () => {
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

  describe('arrow operators', () => {
    it('infers -> returns json/jsonb', async () => {
      const r = await inferrer.infer(
        "SELECT jsonb_col->'key' AS val FROM type_showcase"
      );
      expect(r.columns).toHaveLength(1);
      expect(r.columns[0]).toMatchObject({ name: 'val', tsType: 'unknown' }); // jsonb
    });

    it('infers ->> returns text', async () => {
      const r = await inferrer.infer(
        "SELECT jsonb_col->>'key' AS val FROM type_showcase"
      );
      expect(r.columns).toHaveLength(1);
      expect(r.columns[0]).toMatchObject({ name: 'val', tsType: 'string' }); // text
    });

    it('infers #> returns json/jsonb', async () => {
      const r = await inferrer.infer(
        "SELECT jsonb_col #> '{key,nested}' AS val FROM type_showcase"
      );
      expect(r.columns[0]).toMatchObject({ name: 'val', tsType: 'unknown' });
    });

    it('infers #>> returns text', async () => {
      const r = await inferrer.infer(
        "SELECT jsonb_col #>> '{key,nested}' AS val FROM type_showcase"
      );
      expect(r.columns[0]).toMatchObject({ name: 'val', tsType: 'string' });
    });
  });

  describe('JSON functions', () => {
    it('infers jsonb_agg returns jsonb', async () => {
      const r = await inferrer.infer(
        'SELECT jsonb_agg(email) AS emails FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'emails', tsType: 'unknown' }); // jsonb
    });

    it('infers jsonb_build_object returns jsonb', async () => {
      const r = await inferrer.infer(
        "SELECT jsonb_build_object('id', id, 'email', email) AS obj FROM users"
      );
      expect(r.columns[0]).toMatchObject({ name: 'obj', tsType: 'unknown' });
    });

    it('infers json_build_array returns json', async () => {
      const r = await inferrer.infer(
        'SELECT json_build_array(id, email, name) AS arr FROM users'
      );
      expect(r.columns[0]).toMatchObject({ name: 'arr', tsType: 'unknown' });
    });

    it('infers to_jsonb returns jsonb', async () => {
      const r = await inferrer.infer(
        'SELECT to_jsonb(u) AS user_json FROM users u'
      );
      expect(r.columns[0]).toMatchObject({ name: 'user_json', tsType: 'unknown' });
    });
  });

  describe('JSON in WHERE clause', () => {
    it('supports jsonb containment in WHERE', async () => {
      const r = await inferrer.infer(
        "SELECT id FROM type_showcase WHERE jsonb_col @> '{\"key\": \"value\"}'::jsonb"
      );
      expect(r.columns).toHaveLength(1);
      expect(r.columns[0]).toMatchObject({ name: 'id', tsType: 'number' });
    });
  });
});
