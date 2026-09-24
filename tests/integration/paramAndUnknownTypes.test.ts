import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DiagnosticsEngine } from '@bluedrop-learning-networks/ts-sqlx-core/diagnostics.js';
import { PGLiteAdapter } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/database/pgliteAdapter.js';
import { TsMorphAdapter } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/typescript/tsMorphAdapter.js';
import type { Diagnostic } from '@bluedrop-learning-networks/ts-sqlx-core/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '../fixtures');
const fixturePath = path.join(fixturesDir, 'diagnostics/param-and-unknown-types.ts');

describe('variable params and unknown declared types', () => {
  let dbAdapter: PGLiteAdapter;
  let diagnostics: Diagnostic[];
  const source = fs.readFileSync(fixturePath, 'utf8');

  // Diagnostics whose range starts inside `export const <name> = ...;`
  const diagnosticsFor = (name: string) => {
    const start = source.indexOf(`export const ${name} =`);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(';\n', start);
    return diagnostics
      .filter((d) => d.range.start >= start && d.range.start < end)
      .map((d) => `${d.code}: ${d.message}`);
  };

  beforeAll(async () => {
    dbAdapter = await PGLiteAdapter.create();
    await dbAdapter.executeSchema(fs.readFileSync(path.join(fixturesDir, 'schema.sql'), 'utf8'));
    const tsAdapter = new TsMorphAdapter();
    tsAdapter.loadProject(path.join(fixturesDir, 'tsconfig.json'));
    const engine = new DiagnosticsEngine(dbAdapter, tsAdapter);
    await engine.init();
    diagnostics = await engine.analyze(fixturePath);
  });

  afterAll(async () => {
    await dbAdapter.disconnect();
  });

  it.each([
    'numberVariable',
    'stringVariable',
    'nullableVariable',
    'optionalVariable',
    'mixedVariableAndLiteral',
    'anyVariable',
    'stringForJson',
    'literalForEnum',
    'literalUnionForEnum',
    'inlineLiteralForEnum',
  ])(
    'accepts a variable of a matching type: %s',
    (name) => {
      expect(diagnosticsFor(name)).toEqual([]);
    },
  );

  it('rejects a variable whose type does not match the parameter', () => {
    expect(diagnosticsFor('stringVariableForInt')).toEqual([
      'TS004: Type mismatch for age: expected number, got string',
    ]);
  });

  it('rejects a plain string for an enum parameter', () => {
    expect(diagnosticsFor('stringForEnum')).toEqual([
      "TS004: Type mismatch for status: expected 'draft' | 'published' | 'archived', got string",
    ]);
  });

  it('rejects a variable typed unknown', () => {
    expect(diagnosticsFor('unknownVariable')).toEqual([
      'TS004: Type mismatch for age: expected number, got unknown',
    ]);
  });

  it.each(['nullableJsonAsUnknown', 'nullableJsonAsUnknownOrNull', 'nonNullJsonAsUnknown'])(
    'accepts unknown for a json column: %s',
    (name) => {
      expect(diagnosticsFor(name)).toEqual([]);
    },
  );

  it('still rejects a narrower declared type for a json column', () => {
    expect(diagnosticsFor('nullableJsonAsObject')).toEqual([
      "TS010: property 'json_col': type mismatch — inferred 'unknown | null', declared 'Record<string, unknown> | null'",
    ]);
  });
});
