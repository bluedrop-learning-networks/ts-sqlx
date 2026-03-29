import { command, positional, flag, string, optional } from 'cmd-ts';
import { DiagnosticsEngine } from '@ts-sqlx/core/diagnostics.js';
import { createDatabaseAdapter } from '@ts-sqlx/core/adapters/database/adapterFactory.js';
import { TsMorphAdapter } from '@ts-sqlx/core/adapters/typescript/tsMorphAdapter.js';
import { resolveConfig } from '@ts-sqlx/core/config.js';
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

    const tsAdapter = new TsMorphAdapter();
    const tsConfigPath = path.join(cwd, 'tsconfig.json');
    if (fs.existsSync(tsConfigPath)) {
      tsAdapter.loadProject(tsConfigPath);
    }

    let dbAdapter = null;
    try {
      dbAdapter = await createDatabaseAdapter(config);
      if (dbAdapter && config.database.pglite && config.database.schema) {
        const schemaPath = path.resolve(cwd, config.database.schema);
        if (fs.existsSync(schemaPath)) {
          await dbAdapter.executeSchema(fs.readFileSync(schemaPath, 'utf8'));
        }
      }
    } catch (e) {
      console.error(`Failed to initialize database: ${(e as Error).message}`);
      process.exit(1);
    }

    const engine = new DiagnosticsEngine(dbAdapter, tsAdapter);

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
