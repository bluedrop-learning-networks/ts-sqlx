---
id: ts-2ch5
status: closed
deps: [ts-cffs]
links: []
created: 2026-03-28T14:47:07Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [test-utils]
---
# Task 6: Test Utils — Fixture Runner

Implement the fixture runner with @expect annotation parsing and diagnostic matching logic for test fixtures.

### Task 6: Test Utils — Fixture Runner (Annotation Parser)

**Files:**
- Create: `packages/test-utils/src/fixtureRunner.ts`
- Create: `tests/integration/fixtureRunner.test.ts`

The fixture runner parses `@expect` annotations from test fixture files and provides an interface for running them against diagnostics. It does NOT run the full analyzer yet — that comes later. This task implements the annotation parsing and result comparison logic.

- [ ] **Step 1: Write the test for annotation parsing**

```typescript
// tests/integration/fixtureRunner.test.ts
import { describe, it, expect } from 'vitest';
import { parseFixtureExpectations } from '@ts-sqlx/test-utils/src/fixtureRunner.js';

describe('parseFixtureExpectations', () => {
  it('parses single @expect annotation', () => {
    const source = `
db.one("SELEC * FROM users");
// @expect TS001
`.trim();
    const expectations = parseFixtureExpectations(source);
    expect(expectations).toHaveLength(1);
    expect(expectations[0].code).toBe('TS001');
    expect(expectations[0].messageSubstring).toBeUndefined();
    expect(expectations[0].line).toBe(2);
  });

  it('parses @expect with message substring', () => {
    const source = `
db.one("SELECT * FROM nonexistent");
// @expect TS002 "nonexistent"
`.trim();
    const expectations = parseFixtureExpectations(source);
    expect(expectations).toHaveLength(1);
    expect(expectations[0].code).toBe('TS002');
    expect(expectations[0].messageSubstring).toBe('nonexistent');
  });

  it('parses multiple @expect on same line', () => {
    const source = `
db.one<{ wrong: number }>("SELECT id FROM missing_table");
// @expect TS002 @expect TS010
`.trim();
    const expectations = parseFixtureExpectations(source);
    expect(expectations).toHaveLength(2);
    expect(expectations[0].code).toBe('TS002');
    expect(expectations[1].code).toBe('TS010');
  });

  it('parses @expect-pass annotation', () => {
    const source = `
db.one<{ id: number }>("SELECT id FROM users WHERE id = $1", [1]);
// @expect-pass
`.trim();
    const expectations = parseFixtureExpectations(source);
    expect(expectations).toHaveLength(1);
    expect(expectations[0].pass).toBe(true);
  });

  it('ignores non-annotation comments', () => {
    const source = `
// This is a regular comment
db.one("SELECT 1");
// Another comment
`.trim();
    const expectations = parseFixtureExpectations(source);
    expect(expectations).toHaveLength(0);
  });

  it('associates annotation with the preceding code line', () => {
    const source = `
db.one("SELECT 1");
// @expect-pass

db.one("SELEC");
// @expect TS001
`.trim();
    const expectations = parseFixtureExpectations(source);
    expect(expectations).toHaveLength(2);
    // Line numbers refer to the annotation comment line
    expect(expectations[0].line).toBe(2);
    expect(expectations[1].line).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/fixtureRunner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement fixture runner**

```typescript
// packages/test-utils/src/fixtureRunner.ts
import type { Diagnostic, DiagnosticCode } from '@ts-sqlx/core/src/types.js';
import type { DatabaseAdapter } from '@ts-sqlx/core/src/adapters/database/types.js';

export interface FixtureExpectation {
  line: number;               // Line number of the @expect comment
  code?: DiagnosticCode;      // Expected diagnostic code
  messageSubstring?: string;  // Optional message match
  pass?: boolean;             // @expect-pass
}

export interface FixtureResult {
  file: string;
  passed: number;
  failed: number;
  errors: FixtureError[];
}

export interface FixtureError {
  line: number;
  expected: string;
  actual: string | null;
  message?: string;
}

const EXPECT_PATTERN = /@expect\s+(TS\d{3})(?:\s+"([^"]*)")?/g;
const EXPECT_PASS_PATTERN = /@expect-pass/;

export function parseFixtureExpectations(source: string): FixtureExpectation[] {
  const lines = source.split('\n');
  const expectations: FixtureExpectation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line.startsWith('//')) continue;

    const lineNumber = i + 1; // 1-based

    // Check @expect-pass
    if (EXPECT_PASS_PATTERN.test(line)) {
      expectations.push({ line: lineNumber, pass: true });
      continue;
    }

    // Check @expect TS### patterns
    // Reset regex state for each line
    const regex = new RegExp(EXPECT_PATTERN.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      expectations.push({
        line: lineNumber,
        code: match[1] as DiagnosticCode,
        messageSubstring: match[2] || undefined,
      });
    }
  }

  return expectations;
}

export function matchDiagnostics(
  expectations: FixtureExpectation[],
  diagnostics: Diagnostic[],
  source: string,
): FixtureResult {
  const lines = source.split('\n');
  const errors: FixtureError[] = [];
  let passed = 0;

  for (const exp of expectations) {
    if (exp.pass) {
      // @expect-pass: no diagnostics should appear on the preceding code line
      // The preceding code line is the line before the annotation
      const codeLine = exp.line - 1;
      const codeLineStart = lines.slice(0, codeLine - 1).join('\n').length + (codeLine > 1 ? 1 : 0);
      const codeLineEnd = codeLineStart + lines[codeLine - 1].length;

      const found = diagnostics.filter(
        (d) => d.range.start >= codeLineStart && d.range.start < codeLineEnd
      );
      if (found.length === 0) {
        passed++;
      } else {
        errors.push({
          line: exp.line,
          expected: 'no diagnostics',
          actual: found.map((d) => `${d.code}: ${d.message}`).join(', '),
        });
      }
      continue;
    }

    // @expect TS###: find matching diagnostic near this line
    if (!exp.code) continue;

    const matching = diagnostics.filter((d) => d.code === exp.code);

    if (matching.length === 0) {
      errors.push({
        line: exp.line,
        expected: exp.code,
        actual: null,
        message: exp.messageSubstring
          ? `Expected ${exp.code} "${exp.messageSubstring}" but got no diagnostics`
          : `Expected ${exp.code} but got no diagnostics`,
      });
      continue;
    }

    // Check message substring if specified
    if (exp.messageSubstring) {
      const withMessage = matching.filter((d) =>
        d.message.includes(exp.messageSubstring!)
      );
      if (withMessage.length === 0) {
        errors.push({
          line: exp.line,
          expected: `${exp.code} "${exp.messageSubstring}"`,
          actual: matching.map((d) => `${d.code}: ${d.message}`).join(', '),
          message: `Found ${exp.code} but message didn't contain "${exp.messageSubstring}"`,
        });
        continue;
      }
    }

    passed++;
  }

  return { file: '', passed, failed: errors.length, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/fixtureRunner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/test-utils/src/fixtureRunner.ts tests/integration/fixtureRunner.test.ts
git commit -m "feat: add fixture runner with @expect annotation parsing"
```

## Design

Annotation parser for test fixtures. Parses @expect TS### with optional message substring, @expect-pass. matchDiagnostics does code-based matching.

## Acceptance Criteria

parseFixtureExpectations parses @expect, @expect-pass, multiple annotations; matchDiagnostics compares results; tests pass; commit created

