import { command, subcommands } from 'cmd-ts';
import { TypeCache } from '@bluedrop-learning-networks/ts-sqlx-core/cache.js';
import { resolveConfig } from '@bluedrop-learning-networks/ts-sqlx-core/config.js';
import * as path from 'path';

const statusCommand = command({
  name: 'status',
  description: 'Show cache status',
  args: {},
  handler() {
    const { config, configDir } = resolveConfig(process.cwd());
    const cachePath = path.resolve(configDir, config.cache.path);
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
    const { config, configDir } = resolveConfig(process.cwd());
    const cachePath = path.resolve(configDir, config.cache.path);
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
