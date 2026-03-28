---
id: ts-1pak
status: closed
deps: [ts-qssr, ts-cffs]
links: []
created: 2026-03-28T14:47:51Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [core, detection]
---
# Task 13: Query Detector

Query Detector - Type-based detection of pg-promise and node-postgres query calls with SQL text extraction.

### Task 13: Query Detector

**Files:**
- Create: `packages/core/src/queryDetector.ts`
- Create: `tests/integration/queryDetector.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/queryDetector.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { QueryDetector } from '@ts-sqlx/core/src/queryDetector.js';
import { TsMorphAdapter } from '@ts-sqlx/core/src/adapters/typescript/tsMorphAdapter.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('QueryDetector', () => {
  let tsAdapter: TsMorphAdapter;
  let detector: QueryDetector;
  const fixturesDir = path.join(__dirname, '../fixtures');

  beforeAll(() => {
    tsAdapter = new TsMorphAdapter();
    tsAdapter.loadProject(path.join(fixturesDir, 'tsconfig.json'));
    detector = new QueryDetector(tsAdapter);
  });

  it('detects pg-promise db.one calls', () => {
    const queries = detector.detectQueries(
      path.join(fixturesDir, 'diagnostics/ts001-syntax-errors.ts')
    );
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.some(q => q.method === 'one')).toBe(true);
    expect(queries.every(q => q.library === 'pg-promise')).toBe(true);
  });

  it('extracts SQL text from string literals', () => {
    const queries = detector.detectQueries(
      path.join(fixturesDir, 'diagnostics/ts001-syntax-errors.ts')
    );
    // First query should have SQL text
    const withSql = queries.filter(q => q.sqlText !== undefined);
    expect(withSql.length).toBeGreaterThan(0);
  });

  it('extracts declared result type when present', () => {
    const queries = detector.detectQueries(
      path.join(fixturesDir, 'diagnostics/ts010-declared-vs-inferred.ts')
    );
    const withType = queries.filter(q => q.declaredResultType !== undefined);
    expect(withType.length).toBeGreaterThan(0);
  });

  it('returns undefined sqlText for dynamic queries', () => {
    const queries = detector.detectQueries(
      path.join(fixturesDir, 'diagnostics/ts008-unable-to-analyze.ts')
    );
    const dynamic = queries.filter(q => q.sqlText === undefined);
    expect(dynamic.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/queryDetector.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement query detector**

```typescript
// packages/core/src/queryDetector.ts
import type { TypeScriptAdapter, CallExpressionInfo } from './adapters/typescript/types.js';
import type { QueryCallInfo, QueryMethod, QueryLibrary } from './types.js';

const PG_PROMISE_METHODS: Set<string> = new Set([
  'one', 'oneOrNone', 'many', 'manyOrNone', 'any',
  'none', 'result', 'query', 'multi',
]);

const NODE_PG_METHODS: Set<string> = new Set(['query']);

export class QueryDetector {
  constructor(private tsAdapter: TypeScriptAdapter) {}

  detectQueries(filePath: string): QueryCallInfo[] {
    const calls = this.tsAdapter.getCallExpressions(filePath);
    const results: QueryCallInfo[] = [];

    for (const call of calls) {
      const info = this.classifyCall(call, filePath);
      if (info) results.push(info);
    }

    return results;
  }

  private classifyCall(
    call: CallExpressionInfo,
    filePath: string,
  ): QueryCallInfo | undefined {
    let library: QueryLibrary | undefined;

    if (PG_PROMISE_METHODS.has(call.methodName) && this.isPgPromiseType(call.receiverType)) {
      library = 'pg-promise';
    } else if (NODE_PG_METHODS.has(call.methodName) && this.isNodePostgresType(call.receiverType)) {
      library = 'node-postgres';
    }

    if (!library) return undefined;

    // Resolve SQL text from first argument using TypeScript adapter
    let sqlText: string | undefined;
    if (call.arguments.length > 0) {
      const sqlArg = call.arguments[0];
      // Use adapter to resolve: handles string literals, const variables, template literals
      sqlText = this.tsAdapter.resolveStringLiteral(filePath, sqlArg.position);
      // Fallback to naive parsing if adapter can't resolve (e.g., no source file loaded)
      if (sqlText === undefined) {
        sqlText = this.extractStringValue(sqlArg.text);
      }
    }

    return {
      library,
      method: call.methodName as QueryMethod,
      sqlArgIndex: 0,
      paramsArgIndex: call.arguments.length > 1 ? 1 : undefined,
      sqlText,
      declaredResultType: call.typeArguments.length > 0 ? call.typeArguments[0] : undefined,
      paramsType: call.arguments.length > 1 ? call.arguments[1].type : undefined,
      position: call.position,
    };
  }

  private isPgPromiseType(typeText: string): boolean {
    return /\b(IDatabase|ITask|IBaseProtocol)\b/.test(typeText) ||
           typeText.includes('pg-promise') ||
           // Match our test fixture IDatabase type
           typeText === 'IDatabase';
  }

  private isNodePostgresType(typeText: string): boolean {
    // Use word boundaries to avoid matching "pg" substring in unrelated types
    return /\b(Pool|PoolClient|Client)\b/.test(typeText) &&
           (typeText.includes('pg') || typeText.includes('node-postgres'));
  }

  private extractStringValue(text: string): string | undefined {
    // Direct string literal: "..." or '...'
    if ((text.startsWith('"') && text.endsWith('"')) ||
        (text.startsWith("'") && text.endsWith("'"))) {
      return text.slice(1, -1);
    }
    // Template literal without interpolation: `...`
    if (text.startsWith('`') && text.endsWith('`') && !text.includes('${')) {
      return text.slice(1, -1);
    }
    // Dynamic — cannot resolve
    return undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/queryDetector.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/queryDetector.ts tests/integration/queryDetector.test.ts
git commit -m "feat: add type-based query detector for pg-promise and node-postgres"
```

## Design

Chunk 3. Type-based detection checks receiver type text for IDatabase/ITask/IBaseProtocol (pg-promise) or Pool/PoolClient/Client with pg substring (node-postgres).

## Acceptance Criteria

QueryDetector detects pg-promise calls by receiver type; extracts SQL text via resolveStringLiteral then fallback; extracts declared result type; returns undefined sqlText for dynamic queries; isNodePostgresType uses strict matching; tests pass; commit created

