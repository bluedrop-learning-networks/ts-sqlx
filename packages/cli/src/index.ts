#!/usr/bin/env node
import { run, subcommands } from 'cmd-ts';
import { checkCommand } from './commands/check.js';
import { cacheCommand } from './commands/cache.js';

const app = subcommands({
  name: 'ts-sqlx',
  cmds: {
    check: checkCommand,
    cache: cacheCommand,
  },
});

run(app, process.argv.slice(2));
