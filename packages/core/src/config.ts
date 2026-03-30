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
  types: Record<string, string>;
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
  types: {},
};

export interface TypeOverride {
  tsType: string;
  importFrom?: string;
}

export function parseTypeOverrides(
  types: Record<string, string>,
): Map<string, TypeOverride> {
  const map = new Map<string, TypeOverride>();
  for (const [pgType, value] of Object.entries(types)) {
    const hashIdx = value.indexOf('#');
    if (hashIdx === -1) {
      map.set(pgType, { tsType: value });
    } else {
      const importFrom = value.slice(0, hashIdx);
      const tsType = value.slice(hashIdx + 1);
      if (!importFrom || !tsType) {
        throw new Error(
          `Invalid type override for '${pgType}': both module and type name are required in '${value}'`,
        );
      }
      map.set(pgType, { tsType, importFrom });
    }
  }
  return map;
}

export function parseConfig(tomlText: string): TsSqlxConfig {
  const parsed = parseToml(tomlText) as Record<string, unknown>;
  const db = (parsed.database ?? {}) as Record<string, unknown>;
  const paths = (parsed.paths ?? {}) as Record<string, unknown>;
  const cache = (parsed.cache ?? {}) as Record<string, unknown>;
  const diag = (parsed.diagnostics ?? {}) as Record<string, unknown>;
  const types = (parsed.types ?? {}) as Record<string, string>;

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
    types: { ...types },
  };
}

export interface ResolvedConfig {
  config: TsSqlxConfig;
  /** Directory containing the config file (or startDir if no file found) */
  configDir: string;
}

export function resolveConfig(startDir: string): ResolvedConfig {
  let dir = startDir;
  while (true) {
    const configPath = path.join(dir, 'ts-sqlx.toml');
    if (fs.existsSync(configPath)) {
      const config = parseConfig(fs.readFileSync(configPath, 'utf8'));
      if (config.database.url?.startsWith('$')) {
        const envVar = config.database.url.slice(1);
        config.database.url = process.env[envVar] || config.database.url;
      }
      return { config, configDir: dir };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const defaults = { ...DEFAULTS, database: { ...DEFAULTS.database } };

  if (process.env.DATABASE_URL) {
    defaults.database.url = process.env.DATABASE_URL;
    return { config: defaults, configDir: startDir };
  }

  const schemaPath = path.join(startDir, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    defaults.database.pglite = true;
    defaults.database.schema = 'schema.sql';
    return { config: defaults, configDir: startDir };
  }

  return { config: defaults, configDir: startDir };
}
