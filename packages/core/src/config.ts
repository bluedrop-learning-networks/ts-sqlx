import { parse as parseToml } from 'smol-toml';
import * as fs from 'fs';
import * as path from 'path';

export interface TsSqlxConfig {
  database: {
    url?: string;
    pglite?: boolean;
    schema?: string;
  };
  paths: {
    include: string[];
    exclude: string[];
  };
  cache: {
    path: string;
  };
  diagnostics: {
    untyped: 'error' | 'warning' | 'info' | 'off';
    unable_to_analyze: 'error' | 'warning' | 'info' | 'off';
    no_connection: 'error' | 'warning' | 'info' | 'off';
  };
}

const DEFAULTS: TsSqlxConfig = {
  database: {},
  paths: {
    include: ['**/*.ts'],
    exclude: ['**/node_modules/**', '**/*.test.ts', '**/*.spec.ts'],
  },
  cache: {
    path: '.ts-sqlx/cache.db',
  },
  diagnostics: {
    untyped: 'warning',
    unable_to_analyze: 'info',
    no_connection: 'warning',
  },
};

export function parseConfig(tomlText: string): TsSqlxConfig {
  const parsed = parseToml(tomlText) as Record<string, unknown>;
  const db = (parsed.database ?? {}) as Record<string, unknown>;
  const paths = (parsed.paths ?? {}) as Record<string, unknown>;
  const cache = (parsed.cache ?? {}) as Record<string, unknown>;
  const diag = (parsed.diagnostics ?? {}) as Record<string, unknown>;

  return {
    database: {
      url: db.url as string | undefined,
      pglite: db.pglite as boolean | undefined,
      schema: db.schema as string | undefined,
    },
    paths: {
      include: (paths.include as string[]) ?? DEFAULTS.paths.include,
      exclude: (paths.exclude as string[]) ?? DEFAULTS.paths.exclude,
    },
    cache: {
      path: (cache.path as string) ?? DEFAULTS.cache.path,
    },
    diagnostics: {
      untyped: (diag.untyped as TsSqlxConfig['diagnostics']['untyped']) ?? DEFAULTS.diagnostics.untyped,
      unable_to_analyze: (diag.unable_to_analyze as TsSqlxConfig['diagnostics']['unable_to_analyze']) ?? DEFAULTS.diagnostics.unable_to_analyze,
      no_connection: (diag.no_connection as TsSqlxConfig['diagnostics']['no_connection']) ?? DEFAULTS.diagnostics.no_connection,
    },
  };
}

export function resolveConfig(startDir: string): TsSqlxConfig {
  let dir = startDir;
  while (true) {
    const configPath = path.join(dir, 'ts-sqlx.toml');
    if (fs.existsSync(configPath)) {
      const config = parseConfig(fs.readFileSync(configPath, 'utf8'));
      if (config.database.url?.startsWith('$')) {
        const envVar = config.database.url.slice(1);
        config.database.url = process.env[envVar] || config.database.url;
      }
      return config;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const defaults = { ...DEFAULTS, database: { ...DEFAULTS.database } };

  if (process.env.DATABASE_URL) {
    defaults.database.url = process.env.DATABASE_URL;
    return defaults;
  }

  const schemaPath = path.join(startDir, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    defaults.database.pglite = true;
    defaults.database.schema = 'schema.sql';
    return defaults;
  }

  return defaults;
}
