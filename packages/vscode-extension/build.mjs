import * as esbuild from 'esbuild';
import { execSync } from 'child_process';

// Extension client: esbuild (must externalize vscode)
await esbuild.build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  external: ['vscode'],
});

// Language server: ncc (bundles all deps into a self-contained directory)
execSync(
  'ncc build ../language-server/dist/index.js -o dist/server --no-source-map-register',
  { stdio: 'inherit' },
);

// ncc outputs ESM but bundled deps (ts-morph) use __filename/__dirname which
// don't exist in ESM scope. Prepend a shim that derives them from import.meta.url.
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let serverJs = readFileSync('dist/server/index.js', 'utf8');
// Strip shebang — server is spawned by the extension, not run directly
serverJs = serverJs.replace(/^#!.*\n/, '');
const shim = `import { fileURLToPath as __esm_fileURLToPath } from 'url';
import { dirname as __esm_dirname } from 'path';
const __filename = __esm_fileURLToPath(import.meta.url);
const __dirname = __esm_dirname(__filename);
`;
writeFileSync('dist/server/index.js', shim + serverJs);
writeFileSync('dist/server/package.json', '{"type":"module"}\n');

// Copy WASM assets that ncc doesn't detect — resolve from core package
const coreRequire = createRequire(new URL('../core/package.json', import.meta.url));
const libpgQueryEntry = coreRequire.resolve('libpg-query');
const libpgQueryPkg = libpgQueryEntry.replace(/[/\\][^/\\]+$/, '');
copyFileSync(`${libpgQueryPkg}/libpg-query.wasm`, 'dist/server/libpg-query.wasm');
