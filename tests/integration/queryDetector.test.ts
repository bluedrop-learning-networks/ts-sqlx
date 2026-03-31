import { describe, it, expect, beforeAll } from 'vitest';
import { QueryDetector } from '@bluedrop-learning-networks/ts-sqlx-core/queryDetector.js';
import { TsMorphAdapter } from '@bluedrop-learning-networks/ts-sqlx-core/adapters/typescript/tsMorphAdapter.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('QueryDetector', () => {
  let tsAdapter: TsMorphAdapter;
  let detector: QueryDetector;
  const fixturesDir = path.join(__dirname, '../fixtures');

  beforeAll(() => {
    tsAdapter = new TsMorphAdapter();
    tsAdapter.loadProject(path.join(fixturesDir, 'tsconfig.json'));
    detector = new QueryDetector(tsAdapter);
  });

  it('detects pg-promise db.one calls', () => {
    const queries = detector.detectQueries(
      path.join(fixturesDir, 'diagnostics/ts001-syntax-errors.ts')
    );
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.some(q => q.method === 'one')).toBe(true);
    expect(queries.every(q => q.library === 'pg-promise')).toBe(true);
  });

  it('extracts SQL text from string literals', () => {
    const queries = detector.detectQueries(
      path.join(fixturesDir, 'diagnostics/ts001-syntax-errors.ts')
    );
    const withSql = queries.filter(q => q.sqlText !== undefined);
    expect(withSql.length).toBeGreaterThan(0);
  });

  it('extracts declared result type when present', () => {
    const queries = detector.detectQueries(
      path.join(fixturesDir, 'diagnostics/ts010-declared-vs-inferred.ts')
    );
    const withType = queries.filter(q => q.declaredResultType !== undefined);
    expect(withType.length).toBeGreaterThan(0);
  });

  it('returns undefined sqlText for dynamic queries', () => {
    const queries = detector.detectQueries(
      path.join(fixturesDir, 'diagnostics/ts008-unable-to-analyze.ts')
    );
    const dynamic = queries.filter(q => q.sqlText === undefined);
    expect(dynamic.length).toBeGreaterThan(0);
  });
});
