import { describe, it, expect, beforeAll } from 'vitest';
import { TsMorphAdapter } from '@ts-sqlx/core/adapters/typescript/tsMorphAdapter.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('TsMorphAdapter', () => {
  let adapter: TsMorphAdapter;
  const fixturesDir = path.join(__dirname, '../fixtures');

  beforeAll(() => {
    adapter = new TsMorphAdapter();
    adapter.loadProject(path.join(fixturesDir, 'tsconfig.json'));
  });

  it('lists project files', () => {
    const files = adapter.getProjectFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.some(f => f.includes('param-types.ts'))).toBe(true);
  });

  it('resolves string literal from source', () => {
    adapter.updateFile(
      path.join(fixturesDir, '_test_resolve.ts'),
      'const sql = "SELECT id FROM users";'
    );
    const resolved = adapter.resolveStringLiteral(
      path.join(fixturesDir, '_test_resolve.ts'),
      13
    );
    expect(resolved).toBe('SELECT id FROM users');
  });

  it('gets call expressions from fixture file', () => {
    const calls = adapter.getCallExpressions(
      path.join(fixturesDir, 'diagnostics/ts001-syntax-errors.ts')
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some(c => c.methodName === 'one' || c.methodName === 'many' || c.methodName === 'none' || c.methodName === 'any')).toBe(true);
  });
});
