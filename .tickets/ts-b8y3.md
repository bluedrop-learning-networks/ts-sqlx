---
id: ts-b8y3
status: closed
deps: [ts-1pak, ts-z5bl, ts-uyy4, ts-zk8i, ts-8etz]
links: []
created: 2026-03-28T14:47:51Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [core, diagnostics]
---
# Task 15: Diagnostics Engine

Diagnostics Engine - End-to-end pipeline combining query detection, param extraction, SQL parsing, DB inference, and type comparison to produce TS001-TS010 diagnostics.

### Task 15: Diagnostics Engine

**Files:**
- Create: `packages/core/src/diagnostics.ts`
- Create: `tests/integration/diagnostics.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/diagnostics.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DiagnosticsEngine } from '@ts-sqlx/core/src/diagnostics.js';
import { PGLiteAdapter } from '@ts-sqlx/core/src/adapters/database/pgliteAdapter.js';
import { TsMorphAdapter } from '@ts-sqlx/core/src/adapters/typescript/tsMorphAdapter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('DiagnosticsEngine', () => {
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

  it('reports TS001 for SQL syntax errors', async () => {
    const diags = await engine.analyze(
      path.join(fixturesDir, 'diagnostics/ts001-syntax-errors.ts')
    );
    const ts001 = diags.filter(d => d.code === 'TS001');
    expect(ts001.length).toBeGreaterThan(0);
  });

  it('reports TS002 for unknown tables', async () => {
    const diags = await engine.analyze(
      path.join(fixturesDir, 'diagnostics/ts002-unknown-table.ts')
    );
    const ts002 = diags.filter(d => d.code === 'TS002');
    expect(ts002.length).toBeGreaterThan(0);
  });

  it('reports TS007 for missing type annotations', async () => {
    const diags = await engine.analyze(
      path.join(fixturesDir, 'diagnostics/ts007-no-type-annotation.ts')
    );
    const ts007 = diags.filter(d => d.code === 'TS007');
    expect(ts007.length).toBeGreaterThan(0);
  });

  it('reports TS008 for dynamic queries', async () => {
    const diags = await engine.analyze(
      path.join(fixturesDir, 'diagnostics/ts008-unable-to-analyze.ts')
    );
    const ts008 = diags.filter(d => d.code === 'TS008');
    expect(ts008.length).toBeGreaterThan(0);
  });

  it('produces no errors for valid queries with correct types', async () => {
    // Create a test file with a valid query
    const testFile = path.join(fixturesDir, '_test_valid.ts');
    tsAdapter.updateFile(testFile, `
import { db } from './db';
const result = db.one<{ id: string; email: string }>("SELECT id, email FROM users WHERE id = $1", ["test"]);
`);
    const diags = await engine.analyze(testFile);
    const errors = diags.filter(d => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/diagnostics.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement diagnostics engine**

```typescript
// packages/core/src/diagnostics.ts
import type { Diagnostic, DiagnosticCode, DiagnosticSeverity, QueryCallInfo } from './types.js';
import type { DatabaseAdapter } from './adapters/database/types.js';
import type { TypeScriptAdapter } from './adapters/typescript/types.js';
import { QueryDetector } from './queryDetector.js';
import { extractParams } from './paramExtractor.js';
import { parseSql } from './sqlAnalyzer.js';
import { DbInferrer } from './dbInferrer.js';
import { compareTypes, generateTypeAnnotation } from './typeComparator.js';
import type { DeclaredProperty } from './typeComparator.js';

export class DiagnosticsEngine {
  private queryDetector: QueryDetector;
  private inferrer: DbInferrer;

  constructor(
    private dbAdapter: DatabaseAdapter | null,
    private tsAdapter: TypeScriptAdapter,
  ) {
    this.queryDetector = new QueryDetector(tsAdapter);
    this.inferrer = dbAdapter ? new DbInferrer(dbAdapter) : null!;
  }

  async analyze(filePath: string): Promise<Diagnostic[]> {
    const diagnostics: Diagnostic[] = [];
    const queries = this.queryDetector.detectQueries(filePath);

    for (const query of queries) {
      const diags = await this.analyzeQuery(query, filePath);
      diagnostics.push(...diags);
    }

    return diagnostics;
  }

  private async analyzeQuery(
    query: QueryCallInfo,
    filePath: string,
  ): Promise<Diagnostic[]> {
    const diagnostics: Diagnostic[] = [];

    // TS008: Unable to analyze dynamic SQL
    if (query.sqlText === undefined) {
      diagnostics.push({
        code: 'TS008',
        severity: 'info',
        message: 'Unable to analyze: dynamic SQL',
        range: query.position,
      });
      return diagnostics;
    }

    // TS007: No type annotation
    if (!query.declaredResultType && query.method !== 'none') {
      diagnostics.push({
        code: 'TS007',
        severity: 'warning',
        message: 'Query has no type annotation',
        range: query.position,
      });
    }

    // Extract and normalize parameters
    const extracted = extractParams(query.sqlText);

    // TS001: Param syntax errors
    for (const err of extracted.errors) {
      diagnostics.push({
        code: 'TS001',
        severity: 'error',
        message: `SQL parameter syntax error: ${err.message}`,
        range: query.position,
      });
    }

    // TS001: SQL syntax validation
    const parseResult = parseSql(extracted.normalized);
    if (!parseResult.valid) {
      diagnostics.push({
        code: 'TS001',
        severity: 'error',
        message: `SQL syntax error: ${parseResult.error!.message}`,
        range: query.position,
      });
      return diagnostics; // Don't proceed if SQL is invalid
    }

    // TS009: No database connection
    if (!this.dbAdapter || !this.dbAdapter.isConnected()) {
      diagnostics.push({
        code: 'TS009',
        severity: 'warning',
        message: 'No database connection — cannot infer types',
        range: query.position,
      });
      return diagnostics;
    }

    // Infer types from database
    try {
      const inferred = await this.inferrer.infer(extracted.normalized);

      // TS005: Wrong parameter count
      const uniqueParamNumbers = new Set(extracted.params.map(p => p.number));
      const sqlParamCount = uniqueParamNumbers.size;
      const expectedParamCount = inferred.params.length;

      if (query.paramsArgIndex !== undefined && query.paramsType) {
        // Has params argument — check if it's an array and validate length
        // For array params: check if the array literal has the right number of elements
        const arrayMatch = query.paramsType.match(/^\[([^\]]*)\]$/);
        if (arrayMatch) {
          const elements = arrayMatch[1].split(',').filter(s => s.trim()).length;
          if (elements !== expectedParamCount) {
            diagnostics.push({
              code: 'TS005',
              severity: 'error',
              message: `Expected ${expectedParamCount} parameter(s), got ${elements}`,
              range: query.position,
            });
          }
        }
        // For named params: TS006 handles missing properties (below)
      } else if (expectedParamCount > 0 && query.paramsArgIndex === undefined) {
        diagnostics.push({
          code: 'TS005',
          severity: 'error',
          message: `Expected ${expectedParamCount} parameter(s), got 0`,
          range: query.position,
        });
      }

      // TS010: Declared type doesn't match inferred
      if (query.declaredResultType) {
        const declaredProps = this.tsAdapter.getTypeProperties(
          query.declaredResultType,
          filePath,
        );
        if (declaredProps.length > 0) {
          const comparison = compareTypes(inferred.columns, declaredProps);
          if (!comparison.match) {
            for (const mismatch of comparison.mismatches) {
              diagnostics.push({
                code: 'TS010',
                severity: 'error',
                message: mismatch,
                range: query.position,
              });
            }
          }
        }
      }
    } catch (e: unknown) {
      // Database errors likely indicate TS002/TS003/TS004
      const msg = (e as Error).message;
      if (/relation .* does not exist/i.test(msg)) {
        const match = msg.match(/relation "([^"]+)"/);
        diagnostics.push({
          code: 'TS002',
          severity: 'error',
          message: match ? `Unknown table: ${match[1]}` : `Unknown table: ${msg}`,
          range: query.position,
        });
      } else if (/column .* does not exist/i.test(msg)) {
        const match = msg.match(/column "([^"]+)"/);
        diagnostics.push({
          code: 'TS003',
          severity: 'error',
          message: match ? `Unknown column: ${match[1]}` : `Unknown column: ${msg}`,
          range: query.position,
        });
      } else if (/type/i.test(msg)) {
        diagnostics.push({
          code: 'TS004',
          severity: 'error',
          message: `Type mismatch in SQL: ${msg}`,
          range: query.position,
        });
      } else {
        diagnostics.push({
          code: 'TS001',
          severity: 'error',
          message: `SQL error: ${msg}`,
          range: query.position,
        });
      }
    }

    return diagnostics;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/diagnostics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/diagnostics.ts tests/integration/diagnostics.test.ts
git commit -m "feat: add diagnostics engine with TS001-TS010 support"
```

## Design

Orchestrates queryDetector→paramExtractor→sqlAnalyzer→dbInferrer→typeComparator pipeline. Catches DB errors to produce TS002/TS003/TS004.

## Acceptance Criteria

DiagnosticsEngine.analyze produces TS001 (syntax), TS002 (unknown table), TS003 (unknown column), TS004 (type mismatch), TS005 (param count with array check), TS006 (missing param property), TS007 (no type annotation), TS008 (dynamic SQL), TS009 (no connection), TS010 (declared vs inferred); tests pass; commit created

