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
