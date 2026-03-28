---
id: ts-2uuv
status: closed
deps: [ts-78uo]
links: []
created: 2026-03-28T14:47:07Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [test-utils]
---
# Task 5: Test Utils — PGLite Fixture Helper

Create a PGLite test fixture helper for easy schema loading and adapter lifecycle in tests.

### Task 5: Test Utils — PGLite Fixture Helper

**Files:**
- Create: `packages/test-utils/src/pgliteFixture.ts`

- [ ] **Step 1: Implement PGLite fixture helper**

```typescript
// packages/test-utils/src/pgliteFixture.ts
import { PGLiteAdapter } from '@ts-sqlx/core/src/adapters/database/pgliteAdapter.js';
import type { DatabaseAdapter } from '@ts-sqlx/core/src/adapters/database/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../tests/fixtures');

export interface PGLiteFixture {
  adapter: DatabaseAdapter;
  setup(): Promise<void>;
  teardown(): Promise<void>;
}

export async function createPGLiteFixture(
  schemaPath?: string
): Promise<PGLiteFixture> {
  const resolvedSchema = schemaPath ?? path.join(FIXTURES_DIR, 'schema.sql');
  const adapter = await PGLiteAdapter.create();

  return {
    adapter,
    async setup() {
      const schema = fs.readFileSync(resolvedSchema, 'utf8');
      await adapter.executeSchema(schema);
    },
    async teardown() {
      await adapter.disconnect();
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/test-utils/src/pgliteFixture.ts
git commit -m "feat: add PGLite test fixture helper"
```

## Design

Helper to create PGLite adapter with fixture schema loaded. Uses fileURLToPath for ESM compat.

## Acceptance Criteria

pgliteFixture.ts created with createPGLiteFixture(); uses import.meta.url for paths; commit created

