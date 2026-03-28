---
id: ts-w2b0
status: closed
deps: []
links: []
created: 2026-03-28T14:46:49Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [scaffolding]
---
# Task 1: Monorepo Scaffolding

Scaffold the monorepo with pnpm workspaces, shared tsconfig, vitest config, and core/test-utils packages.

### Task 1: Monorepo Scaffolding

**Files:**
- Create: `package.json` (workspace root)
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/test-utils/package.json`
- Create: `packages/test-utils/tsconfig.json`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "ts-sqlx",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest",
    "test:run": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@ts-sqlx/core': path.resolve(__dirname, 'packages/core'),
      '@ts-sqlx/test-utils': path.resolve(__dirname, 'packages/test-utils'),
    },
  },
});
```

Note: vitest.config.ts is CommonJS-compatible (vitest handles it), so `__dirname` is fine here. All other source/test files use ESM and must use `import.meta.url` with `fileURLToPath` instead of `__dirname`.

- [ ] **Step 5: Create `packages/core/package.json`**

```json
{
  "name": "@ts-sqlx/core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@electric-sql/pglite": "^0.2.0",
    "better-sqlite3": "^11.0.0",
    "libpg-query": "^15.2.0",
    "pg": "^8.13.0",
    "ts-morph": "^25.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/pg": "^8.11.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 6: Create `packages/core/tsconfig.json`**

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

- [ ] **Step 7: Create `packages/test-utils/package.json`**

```json
{
  "name": "@ts-sqlx/test-utils",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@ts-sqlx/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 8: Create `packages/test-utils/tsconfig.json`**

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

- [ ] **Step 9: Install dependencies**

Run: `pnpm install`
Expected: All packages install, workspace links created.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.config.ts packages/core/package.json packages/core/tsconfig.json packages/test-utils/package.json packages/test-utils/tsconfig.json pnpm-lock.yaml
git commit -m "feat: scaffold monorepo with core and test-utils packages"
```

## Design

Chunk 1: Project Scaffolding + Test Utils + PGLite Adapter. Monorepo with pnpm workspaces, ESM modules, vitest for testing. All test files use import.meta.url for __dirname.

## Acceptance Criteria

pnpm install succeeds; all package.json and tsconfig.json files created; vitest.config.ts with resolve aliases; commit created

