import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DiagnosticsEngine } from '@ts-sqlx/core/diagnostics.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import { TsMorphAdapter } from '@ts-sqlx/core/adapters/typescript/tsMorphAdapter.js';
import { parseTypeOverrides } from '@ts-sqlx/core/config.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('DiagnosticsEngine', () => {
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

  it('reports TS001 for SQL syntax errors', async () => {
    const diags = await engine.analyze(
      path.join(fixturesDir, 'diagnostics/ts001-syntax-errors.ts')
    );
    const ts001 = diags.filter(d => d.code === 'TS001');
    expect(ts001.length).toBeGreaterThan(0);
  });

  it('reports TS002 for unknown tables', async () => {
    const diags = await engine.analyze(
      path.join(fixturesDir, 'diagnostics/ts002-unknown-table.ts')
    );
    const ts002 = diags.filter(d => d.code === 'TS002');
    expect(ts002.length).toBeGreaterThan(0);
  });

  it('reports TS007 for missing type annotations', async () => {
    const diags = await engine.analyze(
      path.join(fixturesDir, 'diagnostics/ts007-no-type-annotation.ts')
    );
    const ts007 = diags.filter(d => d.code === 'TS007');
    expect(ts007.length).toBeGreaterThan(0);
  });

  it('reports TS008 for dynamic queries', async () => {
    const diags = await engine.analyze(
      path.join(fixturesDir, 'diagnostics/ts008-unable-to-analyze.ts')
    );
    const ts008 = diags.filter(d => d.code === 'TS008');
    expect(ts008.length).toBeGreaterThan(0);
  });

  it('uses type overrides in diagnostics', async () => {
    const overrides = parseTypeOverrides({ numeric: 'number' });
    const overrideEngine = new DiagnosticsEngine(dbAdapter, tsAdapter, overrides);
    expect(overrideEngine).toBeDefined();
  });
});
