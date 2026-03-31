import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Extension client: esbuild CJS (must externalize vscode)
await esbuild.build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  external: ['vscode'],
});

// Language server: esbuild ESM (bundles all deps)
// Must be ESM so import.meta.url works for PGLite WASM asset resolution
await esbuild.build({
  entryPoints: ['../language-server/dist/index.js'],
  outfile: 'dist/server.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  sourcemap: true,
  banner: {
    // Provide __filename/__dirname for bundled CJS deps (ts-morph)
    js: `import { fileURLToPath as __esbuild_fileURLToPath } from 'url';
import { dirname as __esbuild_dirname } from 'path';
import { createRequire as __esbuild_createRequire } from 'module';
const __filename = __esbuild_fileURLToPath(import.meta.url);
const __dirname = __esbuild_dirname(__filename);
const require = __esbuild_createRequire(import.meta.url);`,
  },
  external: [],
});

// Copy WASM/data assets that esbuild can't inline
mkdirSync(join(__dirname, 'dist'), { recursive: true });

// libpg-query WASM
const coreRequire = createRequire(join(__dirname, '..', 'core', 'package.json'));
const libpgDir = dirname(coreRequire.resolve('libpg-query'));
copyFileSync(join(libpgDir, 'libpg-query.wasm'), join(__dirname, 'dist', 'libpg-query.wasm'));

// PGLite WASM + data
const pgliteEntry = coreRequire.resolve('@electric-sql/pglite');
const pgliteDir = dirname(pgliteEntry);
for (const file of readdirSync(pgliteDir)) {
  if (file.endsWith('.wasm') || file.endsWith('.data') || file.endsWith('.tar.gz')) {
    copyFileSync(join(pgliteDir, file), join(__dirname, 'dist', file));
  }
}
