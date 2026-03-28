---
id: ts-28xs
status: closed
deps: [ts-b8y3, ts-gfa1, ts-qgsr]
links: []
created: 2026-03-28T14:48:18Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [cli]
---
# Task 20: CLI Package

CLI Package - Command-line interface with check, generate (stub), and cache commands for batch SQL analysis.

### Task 20: CLI Package

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/commands/check.ts`
- Create: `packages/cli/src/commands/generate.ts`
- Create: `packages/cli/src/commands/cache.ts`

- [ ] **Step 1: Create `packages/cli/package.json`**

```json
{
  "name": "@ts-sqlx/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "ts-sqlx": "dist/index.js"
  },
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@ts-sqlx/core": "workspace:*",
    "cmd-ts": "^0.13.0",
    "glob": "^11.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create `packages/cli/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Implement check command**

```typescript
// packages/cli/src/commands/check.ts
import { command, positional, flag, string, optional } from 'cmd-ts';
import { DiagnosticsEngine } from '@ts-sqlx/core/src/diagnostics.js';
import { PGLiteAdapter } from '@ts-sqlx/core/src/adapters/database/pgliteAdapter.js';
import { TsMorphAdapter } from '@ts-sqlx/core/src/adapters/typescript/tsMorphAdapter.js';
import { resolveConfig } from '@ts-sqlx/core/src/config.js';
import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';

export const checkCommand = command({
  name: 'check',
  description: 'Check SQL queries for errors',
  args: {
    pattern: positional({ type: optional(string), displayName: 'glob' }),
    staged: flag({ long: 'staged', description: 'Check staged files only' }),
    changed: flag({ long: 'changed', description: 'Check changed files' }),
  },
  async handler({ pattern, staged, changed }) {
    const cwd = process.cwd();
    const config = resolveConfig(cwd);

    // Set up TypeScript adapter
    const tsAdapter = new TsMorphAdapter();
    const tsConfigPath = path.join(cwd, 'tsconfig.json');
    if (fs.existsSync(tsConfigPath)) {
      tsAdapter.loadProject(tsConfigPath);
    }

    // Set up database adapter
    let dbAdapter = null;
    if (config.database.pglite && config.database.schema) {
      const adapter = await PGLiteAdapter.create();
      const schemaPath = path.resolve(cwd, config.database.schema);
      if (fs.existsSync(schemaPath)) {
        await adapter.executeSchema(fs.readFileSync(schemaPath, 'utf8'));
      }
      dbAdapter = adapter;
    }

    const engine = new DiagnosticsEngine(dbAdapter, tsAdapter);

    // Resolve files
    const patterns = pattern ? [pattern] : config.paths.include;
    const files = await glob(patterns, {
      cwd,
      ignore: config.paths.exclude,
      absolute: true,
    });

    let totalErrors = 0;
    for (const file of files) {
      if (!file.endsWith('.ts')) continue;
      const diagnostics = await engine.analyze(file);

      for (const d of diagnostics) {
        const relPath = path.relative(cwd, file);
        console.log(`${relPath}: ${d.code} ${d.severity}: ${d.message}`);
      }

      totalErrors += diagnostics.filter(d => d.severity === 'error').length;
    }

    if (dbAdapter) await dbAdapter.disconnect();

    if (totalErrors > 0) {
      console.log(`\n${totalErrors} error(s) found.`);
      process.exit(1);
    } else {
      console.log('No errors found.');
    }
  },
});
```

- [ ] **Step 4: Implement cache command**

```typescript
// packages/cli/src/commands/cache.ts
import { command, subcommands } from 'cmd-ts';
import { TypeCache } from '@ts-sqlx/core/src/cache.js';
import { resolveConfig } from '@ts-sqlx/core/src/config.js';
import * as path from 'path';

const statusCommand = command({
  name: 'status',
  description: 'Show cache status',
  args: {},
  handler() {
    const config = resolveConfig(process.cwd());
    const cachePath = path.resolve(process.cwd(), config.cache.path);
    const cache = new TypeCache(cachePath);
    const stats = cache.stats();
    console.log(`Cache: ${cachePath}`);
    console.log(`Entries: ${stats.entries}`);
    cache.close();
  },
});

const clearCommand = command({
  name: 'clear',
  description: 'Clear type cache',
  args: {},
  handler() {
    const config = resolveConfig(process.cwd());
    const cachePath = path.resolve(process.cwd(), config.cache.path);
    const cache = new TypeCache(cachePath);
    cache.clear();
    console.log('Cache cleared.');
    cache.close();
  },
});

export const cacheCommand = subcommands({
  name: 'cache',
  cmds: { status: statusCommand, clear: clearCommand },
});
```

- [ ] **Step 5: Implement generate command (deferred -- v1.1)**

The `generate` command requires file rewriting with code actions, which is complex. It's deferred to v1.1 per spec priorities. The stub exits with a clear message.

```typescript
// packages/cli/src/commands/generate.ts
import { command, positional, string, optional } from 'cmd-ts';

export const generateCommand = command({
  name: 'generate',
  description: 'Generate/update type annotations (coming in v1.1)',
  args: {
    pattern: positional({ type: optional(string), displayName: 'glob' }),
  },
  async handler({ pattern }) {
    console.error('ts-sqlx generate is not yet implemented. Use the LSP code actions in your editor for now.');
    process.exit(2);
  },
});
```

- [ ] **Step 6: Create CLI entry point**

```typescript
// packages/cli/src/index.ts
#!/usr/bin/env node
import { run, subcommands } from 'cmd-ts';
import { checkCommand } from './commands/check.js';
import { generateCommand } from './commands/generate.js';
import { cacheCommand } from './commands/cache.js';

const app = subcommands({
  name: 'ts-sqlx',
  cmds: {
    check: checkCommand,
    generate: generateCommand,
    cache: cacheCommand,
  },
});

run(app, process.argv.slice(2));
```

- [ ] **Step 7: Install deps and verify build**

Run: `pnpm install && pnpm -r build`
Expected: No build errors.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/
git commit -m "feat: add CLI with check, generate, and cache commands"
```

## Design

Uses cmd-ts for type-safe CLI. check command uses glob patterns from config. generate explicitly deferred to v1.1.

## Acceptance Criteria

ts-sqlx check analyzes files and reports diagnostics; ts-sqlx cache status/clear work; generate command shows deferred message; exit code 1 for errors, 0 for clean; build succeeds; commit created

