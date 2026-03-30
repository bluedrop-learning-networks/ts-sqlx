import { describe, it, expect } from 'vitest';
import { parseConfig, resolveConfig, parseTypeOverrides } from '@ts-sqlx/core/config.js';
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

  it('parses simple type overrides', () => {
    const config = parseConfig(`
[types]
numeric = "number"
int8 = "bigint"
jsonb = "Record<string, unknown>"
`);
    expect(config.types).toEqual({
      numeric: 'number',
      int8: 'bigint',
      jsonb: 'Record<string, unknown>',
    });
  });

  it('defaults to empty types when section is absent', () => {
    const config = parseConfig(`
[database]
url = "$DATABASE_URL"
`);
    expect(config.types).toEqual({});
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
    const { config, configDir } = resolveConfig(fixturesDir);
    expect(config).toBeDefined();
    expect(configDir).toBe(fixturesDir);
  });

  it('returns defaults when no config found', () => {
    const { config } = resolveConfig('/tmp/nonexistent');
    expect(config).toBeDefined();
    expect(config.paths.include).toEqual(['**/*.ts']);
  });

  it('resolves configDir to the directory containing the config file', () => {
    // fixtures dir has ts-sqlx.toml; a subdirectory should still resolve to fixtures
    const fixturesDir = path.join(__dirname, '../fixtures');
    const subDir = path.join(fixturesDir, 'sub');
    // Even if sub doesn't exist, resolveConfig walks up and finds fixtures/ts-sqlx.toml
    const { configDir } = resolveConfig(subDir);
    expect(configDir).toBe(fixturesDir);
  });
});

describe('parseTypeOverrides', () => {
  it('parses built-in type (no import)', () => {
    const overrides = parseTypeOverrides({ numeric: 'number' });
    expect(overrides.get('numeric')).toEqual({ tsType: 'number' });
  });

  it('parses external type import with # syntax', () => {
    const overrides = parseTypeOverrides({ timestamptz: 'dayjs#Dayjs' });
    expect(overrides.get('timestamptz')).toEqual({
      tsType: 'Dayjs',
      importFrom: 'dayjs',
    });
  });

  it('parses scoped package import', () => {
    const overrides = parseTypeOverrides({ money: '@prisma/client/runtime#Decimal' });
    expect(overrides.get('money')).toEqual({
      tsType: 'Decimal',
      importFrom: '@prisma/client/runtime',
    });
  });

  it('parses relative path import', () => {
    const overrides = parseTypeOverrides({ point: './src/types/geo#Point' });
    expect(overrides.get('point')).toEqual({
      tsType: 'Point',
      importFrom: './src/types/geo',
    });
  });

  it('returns empty map for empty input', () => {
    const overrides = parseTypeOverrides({});
    expect(overrides.size).toBe(0);
  });

  it('throws on empty type name after #', () => {
    expect(() => parseTypeOverrides({ numeric: 'decimal.js#' }))
      .toThrow('Invalid type override');
  });

  it('throws on empty module before #', () => {
    expect(() => parseTypeOverrides({ numeric: '#Decimal' }))
      .toThrow('Invalid type override');
  });
});
