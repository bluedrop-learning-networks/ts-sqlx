---
id: ts-gfa1
status: closed
deps: [ts-w2b0]
links: []
created: 2026-03-28T14:47:34Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [core, config]
---
# Task 11: Config Parser

Implement the TOML config parser with defaults, environment variable resolution, and zero-config fallbacks.

### Task 11: Config Parser

**Files:**
- Create: `packages/core/src/config.ts`
- Create: `tests/integration/config.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/config.test.ts
import { describe, it, expect } from 'vitest';
import { parseConfig, resolveConfig } from '@ts-sqlx/core/src/config.js';
import * as path from 'path';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/config.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement config parser**

We'll use a simple TOML parser. Add `smol-toml` to core dependencies.

```typescript
// packages/core/src/config.ts
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
  // 1. Look for ts-sqlx.toml in directory tree
  let dir = startDir;
  while (true) {
    const configPath = path.join(dir, 'ts-sqlx.toml');
    if (fs.existsSync(configPath)) {
      const config = parseConfig(fs.readFileSync(configPath, 'utf8'));
      // Resolve $ENV_VAR syntax in database.url
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

  // 2. Zero-config fallbacks (spec: Database Configuration Priority)
  const defaults = { ...DEFAULTS, database: { ...DEFAULTS.database } };

  // Check DATABASE_URL env var
  if (process.env.DATABASE_URL) {
    defaults.database.url = process.env.DATABASE_URL;
    return defaults;
  }

  // Check for schema.sql in project root → use PGLite
  const schemaPath = path.join(startDir, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    defaults.database.pglite = true;
    defaults.database.schema = 'schema.sql';
    return defaults;
  }

  return defaults;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config.ts tests/integration/config.test.ts
git commit -m "feat: add TOML config parser with defaults and resolution"
```

## Design

Chunk 3: TypeScript Adapter + Query Detector + Config. Uses smol-toml. Implements spec's 5-level database config priority and zero-config fallbacks.

## Acceptance Criteria

parseConfig parses TOML; resolveConfig walks directories, resolves $ENV_VAR, falls back to DATABASE_URL env then schema.sql PGLite; tests pass; commit created

