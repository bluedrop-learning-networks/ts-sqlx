import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DbInferrer } from '@ts-sqlx/core/dbInferrer.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import type { NullabilityHint } from '@ts-sqlx/core/hintExtractor.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('DbInferrer with nullability hints', () => {
  let adapter: PGLiteAdapter;
  let inferrer: DbInferrer;

  beforeAll(async () => {
    adapter = await PGLiteAdapter.create();
    const schema = fs.readFileSync(
      path.join(__dirname, '../fixtures/schema.sql'),
      'utf8',
    );
    await adapter.executeSchema(schema);
    inferrer = new DbInferrer(adapter);
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  it('overrides inferred nullability with @not-null hint', async () => {
    const hints = new Map<string, NullabilityHint>([['name', 'not-null']]);
    const result = await inferrer.infer('SELECT name FROM users', hints);
    const col = result.columns.find((c) => c.name === 'name')!;
    expect(col.nullable).toBe(false);
  });

  it('overrides inferred nullability with @nullable hint', async () => {
    const hints = new Map<string, NullabilityHint>([['email', 'nullable']]);
    const result = await inferrer.infer('SELECT email FROM users', hints);
    const col = result.columns.find((c) => c.name === 'email')!;
    expect(col.nullable).toBe(true);
  });

  it('leaves unhinted columns unchanged', async () => {
    const hints = new Map<string, NullabilityHint>([['name', 'not-null']]);
    const result = await inferrer.infer('SELECT name, age FROM users', hints);
    const name = result.columns.find((c) => c.name === 'name')!;
    const age = result.columns.find((c) => c.name === 'age')!;
    expect(name.nullable).toBe(false);
    expect(age.nullable).toBe(true);
  });

  it('silently ignores hints for columns not in the result set', async () => {
    const hints = new Map<string, NullabilityHint>([
      ['nonexistent', 'not-null'],
    ]);
    const result = await inferrer.infer('SELECT id FROM users', hints);
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].name).toBe('id');
  });

  it('works with parameterized queries', async () => {
    const hints = new Map<string, NullabilityHint>([['name', 'not-null']]);
    const result = await inferrer.infer(
      'SELECT name FROM users WHERE id = $1',
      hints,
    );
    const col = result.columns.find((c) => c.name === 'name')!;
    expect(col.nullable).toBe(false);
  });

  it('works with no hints (backward compatible)', async () => {
    const result = await inferrer.infer('SELECT id, email FROM users');
    expect(result.columns).toHaveLength(2);
    expect(result.columns[0].nullable).toBe(true);
  });
});
