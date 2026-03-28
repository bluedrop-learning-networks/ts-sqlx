---
id: ts-t8ix
status: closed
deps: [ts-b8y3, ts-2ch5]
links: []
created: 2026-03-28T14:47:51Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [testing, integration]
---
# Task 16: Fixture-Based Integration Tests

Fixture-Based Integration Tests - Full end-to-end validation of the diagnostics pipeline against all diagnostic fixture files.

### Task 16: Fixture-Based Integration Tests

Run the full fixture test suite against all diagnostic fixtures. This validates the end-to-end pipeline: query detection → param extraction → SQL parsing → DB inference → type comparison → diagnostics.

**Files:**
- Create: `tests/integration/fixtures.test.ts`

- [ ] **Step 1: Write the fixture integration test**

```typescript
// tests/integration/fixtures.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DiagnosticsEngine } from '@ts-sqlx/core/src/diagnostics.js';
import { PGLiteAdapter } from '@ts-sqlx/core/src/adapters/database/pgliteAdapter.js';
import { TsMorphAdapter } from '@ts-sqlx/core/src/adapters/typescript/tsMorphAdapter.js';
import { parseFixtureExpectations, matchDiagnostics } from '@ts-sqlx/test-utils/src/fixtureRunner.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('fixture tests', () => {
  let dbAdapter: PGLiteAdapter;
  let tsAdapter: TsMorphAdapter;
  let engine: DiagnosticsEngine;
  const fixturesDir = path.join(__dirname, '../fixtures');

  beforeAll(async () => {
    dbAdapter = await PGLiteAdapter.create();
    const schema = fs.readFileSync(path.join(fixturesDir, 'schema.sql'), 'utf8');
    await dbAdapter.executeSchema(schema);

    tsAdapter = new TsMorphAdapter();
    tsAdapter.loadProject(path.join(fixturesDir, 'tsconfig.json'));

    engine = new DiagnosticsEngine(dbAdapter, tsAdapter);
  });

  afterAll(async () => {
    await dbAdapter.disconnect();
  });

  const diagnosticsFixtures = [
    'diagnostics/ts001-syntax-errors.ts',
    'diagnostics/ts002-unknown-table.ts',
    'diagnostics/ts003-unknown-column.ts',
    'diagnostics/ts004-type-mismatch.ts',
    'diagnostics/ts005-wrong-param-count.ts',
    'diagnostics/ts006-missing-param-property.ts',
    'diagnostics/ts007-no-type-annotation.ts',
    'diagnostics/ts008-unable-to-analyze.ts',
    'diagnostics/ts010-declared-vs-inferred.ts',
  ];

  // ts009 needs special handling — requires engine with no DB connection
  it('passes fixture: diagnostics/ts009-no-connection.ts', async () => {
    const noDbEngine = new DiagnosticsEngine(null, tsAdapter);
    const filePath = path.join(fixturesDir, 'diagnostics/ts009-no-connection.ts');
    const source = fs.readFileSync(filePath, 'utf8');
    const expectations = parseFixtureExpectations(source);
    const diagnostics = await noDbEngine.analyze(filePath);

    const result = matchDiagnostics(expectations, diagnostics, source);
    if (result.errors.length > 0) {
      const errorDetails = result.errors
        .map(e => `  Line ${e.line}: expected ${e.expected}, got ${e.actual ?? 'nothing'} ${e.message ? `(${e.message})` : ''}`)
        .join('\n');
      expect.fail(
        `${result.failed} expectation(s) failed in ts009:\n${errorDetails}`
      );
    }
  });

  for (const fixture of diagnosticsFixtures) {
    it(`passes fixture: ${fixture}`, async () => {
      const filePath = path.join(fixturesDir, fixture);
      const source = fs.readFileSync(filePath, 'utf8');
      const expectations = parseFixtureExpectations(source);
      const diagnostics = await engine.analyze(filePath);

      const result = matchDiagnostics(expectations, diagnostics, source);

      if (result.errors.length > 0) {
        const errorDetails = result.errors
          .map(e => `  Line ${e.line}: expected ${e.expected}, got ${e.actual ?? 'nothing'} ${e.message ? `(${e.message})` : ''}`)
          .join('\n');
        expect.fail(
          `${result.failed} expectation(s) failed in ${fixture}:\n${errorDetails}`
        );
      }
    });
  }
});
```

- [ ] **Step 2: Run tests — expect some failures initially**

Run: `pnpm vitest run tests/integration/fixtures.test.ts`
Expected: Some fixtures may fail as the diagnostics engine may need refinement. Use failures to iterate.

- [ ] **Step 3: Fix any failures, iterate**

Adjust `diagnostics.ts`, `queryDetector.ts`, or other components based on specific fixture failures. The red-green cycle here is: read failure → understand gap → fix implementation → re-run.

- [ ] **Step 4: Commit when all diagnostic fixtures pass**

```bash
git add tests/integration/fixtures.test.ts
git commit -m "feat: add fixture-based integration tests for all diagnostics"
```

## Design

End-to-end validation: query detection→param extraction→SQL parsing→DB inference→type comparison→diagnostics against all fixture files.

## Acceptance Criteria

All diagnostic fixtures (ts001-ts010) pass including ts009 with no-DB engine; @expect annotations matched against actual diagnostics; commit created

