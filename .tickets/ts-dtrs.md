---
id: ts-dtrs
status: closed
deps: [ts-b8y3, ts-qgsr, ts-gfa1]
links: []
created: 2026-03-28T14:48:31Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [core]
---
# Task 21: Update Core Exports

Update Core Exports and Final Wiring - Update the core package index.ts to export all public API modules.

### Task 21: Update Core Exports and Final Wiring

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Update core index with all exports**

```typescript
// packages/core/src/index.ts
export * from './types.js';
export * from './adapters/database/types.js';
export * from './adapters/database/oidMap.js';
export { PGLiteAdapter } from './adapters/database/pgliteAdapter.js';
export * from './adapters/typescript/types.js';
export { TsMorphAdapter } from './adapters/typescript/tsMorphAdapter.js';
export { extractParams } from './paramExtractor.js';
export { parseSql } from './sqlAnalyzer.js';
export { QueryDetector } from './queryDetector.js';
export { DbInferrer } from './dbInferrer.js';
export { compareTypes, generateTypeAnnotation } from './typeComparator.js';
export { DiagnosticsEngine } from './diagnostics.js';
export { TypeCache } from './cache.js';
export { parseConfig, resolveConfig } from './config.js';
```

- [ ] **Step 2: Run all tests**

Run: `pnpm vitest run`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat: update core exports with all public API"
```

## Design

Final wiring of core package public API.

## Acceptance Criteria

packages/core/src/index.ts exports all public API (types, adapters, paramExtractor, sqlAnalyzer, queryDetector, dbInferrer, typeComparator, diagnostics, cache, config); all tests pass; commit created

