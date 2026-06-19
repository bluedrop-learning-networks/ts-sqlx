import { describe, it, expect } from 'vitest';
import { resolveSchemaPath } from '@bluedrop-learning-networks/ts-sqlx-core/schema-source.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '../fixtures');

describe('resolveSchemaPath', () => {
  it('returns null when schema is undefined', () => {
    expect(resolveSchemaPath(undefined, fixturesDir)).toBeNull();
  });

  it('resolves string form relative to configDir', () => {
    const result = resolveSchemaPath('schema.sql', fixturesDir);
    expect(result).toBe(path.resolve(fixturesDir, 'schema.sql'));
  });

  it('resolves command form by running the command in configDir', () => {
    const result = resolveSchemaPath(
      { command: `node -e "console.log('schema.sql')"` },
      fixturesDir,
    );
    expect(result).toBe(path.resolve(fixturesDir, 'schema.sql'));
  });

  it('throws when command produces no stdout', () => {
    expect(() =>
      resolveSchemaPath({ command: `node -e ""` }, fixturesDir),
    ).toThrow(/produced no stdout/);
  });

  it('uses the first non-empty line when command emits multiple lines', () => {
    const result = resolveSchemaPath(
      { command: `node -e "console.log('schema.sql\\nignored.sql')"` },
      fixturesDir,
    );
    expect(result).toBe(path.resolve(fixturesDir, 'schema.sql'));
  });
});
