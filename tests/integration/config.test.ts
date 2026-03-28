import { describe, it, expect } from 'vitest';
import { parseConfig, resolveConfig } from '@ts-sqlx/core/config.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('parseConfig', () => {
  it('parses a basic config', () => {
    const config = parseConfig(`
[database]
url = "$DATABASE_URL"

[paths]
include = ["src/**/*.ts"]
exclude = ["**/*.test.ts"]

[cache]
path = ".ts-sqlx/cache.db"

[diagnostics]
untyped = "warning"
unable_to_analyze = "info"
no_connection = "warning"
`);
    expect(config.database.url).toBe('$DATABASE_URL');
    expect(config.paths.include).toEqual(['src/**/*.ts']);
    expect(config.paths.exclude).toEqual(['**/*.test.ts']);
    expect(config.diagnostics.untyped).toBe('warning');
  });

  it('parses pglite config', () => {
    const config = parseConfig(`
[database]
pglite = true
schema = "schema.sql"
`);
    expect(config.database.pglite).toBe(true);
    expect(config.database.schema).toBe('schema.sql');
  });
});

describe('resolveConfig', () => {
  it('finds config in fixtures directory', () => {
    const fixturesDir = path.join(__dirname, '../fixtures');
    const config = resolveConfig(fixturesDir);
    expect(config).toBeDefined();
  });

  it('returns defaults when no config found', () => {
    const config = resolveConfig('/tmp/nonexistent');
    expect(config).toBeDefined();
    expect(config.paths.include).toEqual(['**/*.ts']);
  });
});
