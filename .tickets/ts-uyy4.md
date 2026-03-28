---
id: ts-uyy4
status: closed
deps: [ts-w2b0]
links: []
created: 2026-03-28T14:47:34Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [core, sql]
---
# Task 9: SQL Analyzer (libpg-query)

Implement the SQL analyzer wrapper around libpg-query for syntax validation with error reporting.

### Task 9: SQL Analyzer (libpg-query wrapper)

**Files:**
- Create: `packages/core/src/sqlAnalyzer.ts`
- Create: `tests/integration/sqlAnalyzer.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/sqlAnalyzer.test.ts
import { describe, it, expect } from 'vitest';
import { parseSql } from '@ts-sqlx/core/src/sqlAnalyzer.js';

describe('parseSql', () => {
  it('parses valid SELECT', () => {
    const result = parseSql('SELECT id, name FROM users WHERE id = $1');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('parses valid INSERT', () => {
    const result = parseSql('INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id');
    expect(result.valid).toBe(true);
  });

  it('reports syntax error for typo', () => {
    const result = parseSql('SELEC * FROM users');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.message).toBeTruthy();
  });

  it('reports error for invalid syntax', () => {
    const result = parseSql('SELECT * FROM users WHERE AND id = 1');
    expect(result.valid).toBe(false);
  });

  it('reports error for empty query', () => {
    const result = parseSql('');
    expect(result.valid).toBe(false);
  });

  it('reports error for whitespace-only query', () => {
    const result = parseSql('   ');
    expect(result.valid).toBe(false);
  });

  it('parses valid UPDATE', () => {
    const result = parseSql('UPDATE users SET name = $1 WHERE id = $2');
    expect(result.valid).toBe(true);
  });

  it('parses valid DELETE', () => {
    const result = parseSql('DELETE FROM users WHERE id = $1');
    expect(result.valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/sqlAnalyzer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement SQL analyzer**

```typescript
// packages/core/src/sqlAnalyzer.ts
import { parseQuerySync } from 'libpg-query';

export interface ParseResult {
  valid: boolean;
  error?: {
    message: string;
    cursorPosition?: number;
  };
}

export function parseSql(sql: string): ParseResult {
  const trimmed = sql.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      error: { message: 'Empty query' },
    };
  }

  try {
    parseQuerySync(trimmed);
    return { valid: true };
  } catch (e: unknown) {
    const err = e as Error & { cursorPosition?: number };
    return {
      valid: false,
      error: {
        message: err.message,
        cursorPosition: err.cursorPosition,
      },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/sqlAnalyzer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sqlAnalyzer.ts tests/integration/sqlAnalyzer.test.ts
git commit -m "feat: add SQL analyzer using libpg-query"
```

## Design

Wraps libpg-query parseQuerySync. Returns ParseResult with valid flag and error details including cursor position.

## Acceptance Criteria

parseSql validates SQL via libpg-query; reports errors for typos, invalid syntax, empty/whitespace queries; tests pass; commit created

