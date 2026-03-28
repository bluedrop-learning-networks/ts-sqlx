import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DiagnosticsEngine } from '@ts-sqlx/core/diagnostics.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import { TsMorphAdapter } from '@ts-sqlx/core/adapters/typescript/tsMorphAdapter.js';
import { parseFixtureExpectations, matchDiagnostics } from '@ts-sqlx/test-utils/fixtureRunner.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('fixture tests', () => {
  let dbAdapter: PGLiteAdapter;
  let tsAdapter: TsMorphAdapter;
  let engine: DiagnosticsEngine;
  const fixturesDir = path.join(__dirname, '../fixtures');

  beforeAll(async () => {
    dbAdapter = await PGLiteAdapter.create();
    const schema = fs.readFileSync(path.join(fixturesDir, 'schema.sql'), 'utf8');
    await dbAdapter.executeSchema(schema);

    tsAdapter = new TsMorphAdapter();
    tsAdapter.loadProject(path.join(fixturesDir, 'tsconfig.json'));

    engine = new DiagnosticsEngine(dbAdapter, tsAdapter);
  });

  afterAll(async () => {
    await dbAdapter.disconnect();
  });

  const diagnosticsFixtures = [
    'diagnostics/ts001-syntax-errors.ts',
    'diagnostics/ts002-unknown-table.ts',
    'diagnostics/ts003-unknown-column.ts',
    'diagnostics/ts004-type-mismatch.ts',
    'diagnostics/ts005-wrong-param-count.ts',
    'diagnostics/ts006-missing-param-property.ts',
    'diagnostics/ts007-no-type-annotation.ts',
    'diagnostics/ts008-unable-to-analyze.ts',
    'diagnostics/ts010-declared-vs-inferred.ts',
  ];

  it('passes fixture: diagnostics/ts009-no-connection.ts', async () => {
    const noDbEngine = new DiagnosticsEngine(null, tsAdapter);
    const filePath = path.join(fixturesDir, 'diagnostics/ts009-no-connection.ts');
    const source = fs.readFileSync(filePath, 'utf8');
    const expectations = parseFixtureExpectations(source);
    const diagnostics = await noDbEngine.analyze(filePath);

    const result = matchDiagnostics(expectations, diagnostics, source);
    if (result.errors.length > 0) {
      const errorDetails = result.errors
        .map(e => `  Line ${e.line}: expected ${e.expected}, got ${e.actual ?? 'nothing'} ${e.message ? `(${e.message})` : ''}`)
        .join('\n');
      expect.fail(`${result.failed} expectation(s) failed:\n${errorDetails}`);
    }
  });

  for (const fixture of diagnosticsFixtures) {
    it(`passes fixture: ${fixture}`, async () => {
      const filePath = path.join(fixturesDir, fixture);
      const source = fs.readFileSync(filePath, 'utf8');
      const expectations = parseFixtureExpectations(source);
      const diagnostics = await engine.analyze(filePath);

      const result = matchDiagnostics(expectations, diagnostics, source);
      if (result.errors.length > 0) {
        const errorDetails = result.errors
          .map(e => `  Line ${e.line}: expected ${e.expected}, got ${e.actual ?? 'nothing'} ${e.message ? `(${e.message})` : ''}`)
          .join('\n');
        expect.fail(`${result.failed} expectation(s) failed:\n${errorDetails}`);
      }
    });
  }
});
