# CLI Output Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace plain-text CLI diagnostic output with colored, icon-based, file-grouped output using picocolors.

**Architecture:** New `reporter.ts` module in `@ts-sqlx/cli` handles all formatting. `check.ts` collects all diagnostics with file paths, then delegates to the reporter. A `--verbose` flag enables source snippets.

**Tech Stack:** picocolors, cmd-ts, vitest

**Spec:** `docs/superpowers/specs/2026-03-30-cli-output-design.md`

---

## Chunk 1: Reporter Module with Compact Output

### Task 1: Add picocolors dependency

**Files:**
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Install picocolors**

Run: `cd /Users/donalmacanri/projects/ts-sqlx/main && pnpm add picocolors --filter @ts-sqlx/cli`
Expected: picocolors added to dependencies in `packages/cli/package.json`

- [ ] **Step 2: Commit**

```bash
git add packages/cli/package.json pnpm-lock.yaml
git commit -m "chore(cli): add picocolors dependency"
```

### Task 2: Create reporter with compact formatting — tests first

**Files:**
- Create: `packages/cli/src/reporter.ts`
- Create: `packages/cli/src/reporter.test.ts`

**Key context:**
- `Diagnostic` type (from `@ts-sqlx/core/types.js`) has: `code: DiagnosticCode`, `severity: DiagnosticSeverity`, `message: string`, `range: TextRange` (byte offsets `start`/`end`)
- The reporter needs file paths alongside diagnostics. Define a `FileDiagnostic` type: `{ filePath: string; diagnostic: Diagnostic }`. Note: the spec's signature shows `Diagnostic[]` but `Diagnostic` has no file path, so `FileDiagnostic[]` is the actual interface.
- Byte offset → line:col conversion requires reading the source file content. For compact mode, we need line:col for the location suffix. The reporter will read the file and compute offsets.
- `picocolors` exports a default object with methods: `red()`, `yellow()`, `cyan()`, `bold()`, `dim()`, `green()`
- To test without ANSI codes, use `createColors(false)` from `picocolors/picocolors.js` — or simpler: strip ANSI with a regex in tests

- [ ] **Step 1: Write failing test for single-file single-error compact output**

Create `packages/cli/src/reporter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatDiagnostics } from './reporter.js';
import type { Diagnostic } from '@ts-sqlx/core/types.js';

// Strip ANSI escape codes for assertions
function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('formatDiagnostics', () => {
  it('formats a single error in compact mode', () => {
    // "SELECT * FORM users" starts at byte 20, line 3 col 5 in the fake content
    const diagnostics: { filePath: string; diagnostic: Diagnostic }[] = [
      {
        filePath: '/project/src/app.ts',
        diagnostic: {
          code: 'TS001',
          severity: 'error',
          message: 'SQL syntax error: syntax error at or near "FORM"',
          range: { start: 20, end: 40 },
        },
      },
    ];

    const result = formatDiagnostics(diagnostics, {
      verbose: false,
      cwd: '/project',
      readFile: () => 'line one\nline two\n    SELECT * FORM users\nline four\n',
    });

    const plain = strip(result);
    expect(plain).toContain('src/app.ts');
    expect(plain).toContain('✖ TS001 error:');
    expect(plain).toContain(':3:5');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/donalmacanri/projects/ts-sqlx/main && pnpm vitest run packages/cli/src/reporter.test.ts`
Expected: FAIL — module `./reporter.js` not found

- [ ] **Step 3: Write minimal reporter implementation**

Create `packages/cli/src/reporter.ts`:

```ts
import pc from 'picocolors';
import * as path from 'path';
import * as fs from 'fs';
import type { Diagnostic, DiagnosticSeverity } from '@ts-sqlx/core/types.js';

export interface FileDiagnostic {
  filePath: string;
  diagnostic: Diagnostic;
}

export interface FormatOptions {
  verbose: boolean;
  cwd: string;
  /** Injectable file reader for testing. Defaults to fs.readFileSync. */
  readFile?: (filePath: string) => string;
}

const ICONS: Record<DiagnosticSeverity, string> = {
  error: '✖',
  warning: '⚠',
  info: 'ℹ',
};

const COLORS: Record<DiagnosticSeverity, (s: string) => string> = {
  error: pc.red,
  warning: pc.yellow,
  info: pc.cyan,
};

interface Position {
  line: number;
  col: number;
}

function offsetToPosition(content: string, offset: number): Position {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

export function formatDiagnostics(
  diagnostics: FileDiagnostic[],
  options: FormatOptions,
): string {
  if (diagnostics.length === 0) {
    return pc.green('✔ No issues found.');
  }

  const readFile = options.readFile ?? ((p: string) => fs.readFileSync(p, 'utf8'));

  // Group by file
  const byFile = new Map<string, Diagnostic[]>();
  for (const { filePath, diagnostic } of diagnostics) {
    if (!byFile.has(filePath)) {
      byFile.set(filePath, []);
    }
    byFile.get(filePath)!.push(diagnostic);
  }

  // Read file contents once per file, sort files alphabetically
  const fileContents = new Map<string, string>();
  for (const filePath of byFile.keys()) {
    try {
      fileContents.set(filePath, readFile(filePath));
    } catch {
      fileContents.set(filePath, '');
    }
  }

  const sortedFiles = [...byFile.keys()].sort((a, b) =>
    path.relative(options.cwd, a).localeCompare(path.relative(options.cwd, b)),
  );

  const lines: string[] = [];

  for (const filePath of sortedFiles) {
    const relPath = path.relative(options.cwd, filePath);
    lines.push(pc.bold(pc.white(relPath)));

    const content = fileContents.get(filePath) ?? '';
    const entries = byFile.get(filePath)!;

    // Sort by position
    entries.sort((a, b) => a.range.start - b.range.start);

    for (const d of entries) {
      const pos = content ? offsetToPosition(content, d.range.start) : null;
      const color = COLORS[d.severity];
      const icon = ICONS[d.severity];
      const location = pos ? pc.dim(`:${pos.line}:${pos.col}`) : '';
      lines.push(`  ${color(icon)} ${color(`${d.code} ${d.severity}:`)} ${d.message}  ${location}`);

      if (options.verbose && content) {
        lines.push(...formatSnippet(content, d, pos!));
        lines.push('');
      }
    }

    lines.push('');
  }

  // Summary
  lines.push(formatSummary(diagnostics.map(d => d.diagnostic)));

  return lines.join('\n');
}

function formatSnippet(
  content: string,
  diagnostic: Diagnostic,
  pos: Position,
): string[] {
  const sourceLines = content.split('\n');
  const targetLine = pos.line - 1; // 0-indexed
  const lines: string[] = [];
  const gutterWidth = String(Math.min(targetLine + 2, sourceLines.length)).length;

  // Line before
  if (targetLine > 0) {
    const ln = String(targetLine).padStart(gutterWidth);
    lines.push(pc.dim(`     ${ln} │ `) + sourceLines[targetLine - 1]);
  }

  // Target line
  const ln = String(targetLine + 1).padStart(gutterWidth);
  lines.push(pc.dim(`     ${ln} │ `) + sourceLines[targetLine]);

  // Pointer line
  const spanLen = Math.max(1, diagnostic.range.end - diagnostic.range.start);
  const pointer = ' '.repeat(pos.col - 1) + '^'.repeat(Math.min(spanLen, sourceLines[targetLine]?.length ?? spanLen));
  lines.push(pc.dim(`     ${' '.repeat(gutterWidth)} │ `) + COLORS[diagnostic.severity](pointer));

  // Line after
  if (targetLine + 1 < sourceLines.length) {
    const ln = String(targetLine + 2).padStart(gutterWidth);
    lines.push(pc.dim(`     ${ln} │ `) + sourceLines[targetLine + 1]);
  }

  return lines;
}

function formatSummary(diagnostics: Diagnostic[]): string {
  const counts: Record<DiagnosticSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const d of diagnostics) {
    counts[d.severity]++;
  }

  const parts: string[] = [];
  if (counts.error > 0) {
    parts.push(pc.red(`✖ ${counts.error} error${counts.error !== 1 ? 's' : ''}`));
  }
  if (counts.warning > 0) {
    parts.push(pc.yellow(`⚠ ${counts.warning} warning${counts.warning !== 1 ? 's' : ''}`));
  }
  if (counts.info > 0) {
    parts.push(pc.cyan(`ℹ ${counts.info} info`));
  }

  return parts.join('  ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/donalmacanri/projects/ts-sqlx/main && pnpm vitest run packages/cli/src/reporter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/reporter.ts packages/cli/src/reporter.test.ts
git commit -m "feat(cli): add reporter module with compact diagnostic formatting"
```

### Task 3: Add remaining compact mode tests

**Files:**
- Modify: `packages/cli/src/reporter.test.ts`

- [ ] **Step 1: Write test for multiple files with mixed severities**

Add to `reporter.test.ts`:

```ts
  it('groups by file and sorts alphabetically', () => {
    const diagnostics: { filePath: string; diagnostic: Diagnostic }[] = [
      {
        filePath: '/project/src/db.ts',
        diagnostic: { code: 'TS007', severity: 'warning', message: 'Query has no type annotation', range: { start: 10, end: 20 } },
      },
      {
        filePath: '/project/src/app.ts',
        diagnostic: { code: 'TS001', severity: 'error', message: 'SQL syntax error', range: { start: 5, end: 15 } },
      },
      {
        filePath: '/project/src/app.ts',
        diagnostic: { code: 'TS002', severity: 'error', message: 'Unknown table: bad_table', range: { start: 50, end: 60 } },
      },
    ];

    const result = formatDiagnostics(diagnostics, {
      verbose: false,
      cwd: '/project',
      readFile: () => 'x'.repeat(100),
    });

    const plain = strip(result);
    const appIdx = plain.indexOf('src/app.ts');
    const dbIdx = plain.indexOf('src/db.ts');
    expect(appIdx).toBeLessThan(dbIdx); // alphabetical

    expect(plain).toContain('✖ TS001 error:');
    expect(plain).toContain('✖ TS002 error:');
    expect(plain).toContain('⚠ TS007 warning:');
  });

  it('formats zero diagnostics as success', () => {
    const result = formatDiagnostics([], {
      verbose: false,
      cwd: '/project',
    });

    const plain = strip(result);
    expect(plain).toBe('✔ No issues found.');
  });

  it('summary omits zero-count severities', () => {
    const diagnostics: { filePath: string; diagnostic: Diagnostic }[] = [
      {
        filePath: '/project/src/app.ts',
        diagnostic: { code: 'TS001', severity: 'error', message: 'err', range: { start: 0, end: 5 } },
      },
      {
        filePath: '/project/src/app.ts',
        diagnostic: { code: 'TS007', severity: 'warning', message: 'warn', range: { start: 10, end: 15 } },
      },
    ];

    const result = formatDiagnostics(diagnostics, {
      verbose: false,
      cwd: '/project',
      readFile: () => 'x'.repeat(100),
    });

    const plain = strip(result);
    expect(plain).toContain('✖ 1 error');
    expect(plain).toContain('⚠ 1 warning');
    expect(plain).not.toContain('ℹ');
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /Users/donalmacanri/projects/ts-sqlx/main && pnpm vitest run packages/cli/src/reporter.test.ts`
Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/reporter.test.ts
git commit -m "test(cli): add compact mode reporter tests"
```

## Chunk 2: Verbose Mode and Edge Cases

### Task 4: Add verbose mode tests

**Files:**
- Modify: `packages/cli/src/reporter.test.ts`

- [ ] **Step 1: Write test for verbose mode with snippet**

Add to `reporter.test.ts`:

```ts
  it('shows source snippet in verbose mode', () => {
    const diagnostics: { filePath: string; diagnostic: Diagnostic }[] = [
      {
        filePath: '/project/src/app.ts',
        diagnostic: {
          code: 'TS001',
          severity: 'error',
          message: 'SQL syntax error',
          range: { start: 30, end: 34 },
        },
      },
    ];

    const fileContent = 'const users = sql`\n  SELECT * FORM users\n`;';
    //                    0123456789012345678 9 0123456789012345678 9 01
    // Line 1: "const users = sql`"  (0..18, then \n at 18)
    // Line 2: "  SELECT * FORM users" (19..39, then \n at 39)
    // Line 3: "`;" (40..41)
    // start=30 is 'F' in FORM on line 2, col 12

    const result = formatDiagnostics(diagnostics, {
      verbose: true,
      cwd: '/project',
      readFile: () => fileContent,
    });

    const plain = strip(result);
    expect(plain).toContain('│ const users = sql`');    // line before
    expect(plain).toContain('│   SELECT * FORM users'); // target line
    expect(plain).toContain('^^^^');                     // pointer
    expect(plain).toContain('│ `;');                     // line after
  });

  it('skips snippet when file is unreadable in verbose mode', () => {
    const diagnostics: { filePath: string; diagnostic: Diagnostic }[] = [
      {
        filePath: '/project/src/gone.ts',
        diagnostic: {
          code: 'TS001',
          severity: 'error',
          message: 'SQL syntax error',
          range: { start: 0, end: 5 },
        },
      },
    ];

    const result = formatDiagnostics(diagnostics, {
      verbose: true,
      cwd: '/project',
      readFile: () => { throw new Error('ENOENT'); },
    });

    const plain = strip(result);
    expect(plain).toContain('✖ TS001 error:');
    expect(plain).not.toContain('│'); // no snippet
  });
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/donalmacanri/projects/ts-sqlx/main && pnpm vitest run packages/cli/src/reporter.test.ts`
Expected: PASS (snippet logic already implemented in Task 2)

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/reporter.test.ts
git commit -m "test(cli): add verbose mode and edge case reporter tests"
```

## Chunk 3: Integrate Reporter into check Command

### Task 5: Wire reporter into check.ts and add --verbose flag

**Files:**
- Modify: `packages/cli/src/commands/check.ts`

**Key context:**
- `cmd-ts` flags: `flag({ long: 'verbose', description: '...' })` creates a boolean flag
- Current code iterates files one at a time and logs inline. Refactor to collect all `FileDiagnostic[]` first, then call `formatDiagnostics` once.
- Keep the same exit code behavior: exit 1 if any errors, exit 0 otherwise

- [ ] **Step 1: Replace check.ts entirely**

Replace the full contents of `packages/cli/src/commands/check.ts` with the following (the only changes are: added `verbose` flag, collect `FileDiagnostic[]` instead of logging inline, call `formatDiagnostics` at the end):

```ts
import { command, positional, flag, string, optional } from 'cmd-ts';
import { DiagnosticsEngine } from '@ts-sqlx/core/diagnostics.js';
import { createDatabaseAdapter } from '@ts-sqlx/core/adapters/database/adapterFactory.js';
import { TsMorphAdapter } from '@ts-sqlx/core/adapters/typescript/tsMorphAdapter.js';
import { resolveConfig, parseTypeOverrides } from '@ts-sqlx/core/config.js';
import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { formatDiagnostics, type FileDiagnostic } from '../reporter.js';

export const checkCommand = command({
  name: 'check',
  description: 'Check SQL queries for errors',
  args: {
    pattern: positional({ type: optional(string), displayName: 'glob' }),
    staged: flag({ long: 'staged', description: 'Check staged files only' }),
    changed: flag({ long: 'changed', description: 'Check changed files' }),
    verbose: flag({ long: 'verbose', description: 'Show source snippets for diagnostics' }),
  },
  async handler({ pattern, staged, changed, verbose }) {
    const cwd = process.cwd();
    const { config, configDir } = resolveConfig(cwd);

    const tsAdapter = new TsMorphAdapter();
    const tsConfigPath = path.join(cwd, 'tsconfig.json');
    if (fs.existsSync(tsConfigPath)) {
      tsAdapter.loadProject(tsConfigPath);
    }

    let dbAdapter = null;
    try {
      dbAdapter = await createDatabaseAdapter(config);
      if (dbAdapter && config.database.pglite && config.database.schema) {
        const schemaPath = path.resolve(configDir, config.database.schema);
        if (fs.existsSync(schemaPath)) {
          await dbAdapter.executeSchema(fs.readFileSync(schemaPath, 'utf8'));
        }
      }
    } catch (e) {
      console.error(`Failed to initialize database: ${(e as Error).message}`);
      process.exit(1);
    }

    const typeOverrides = parseTypeOverrides(config.types);
    const engine = new DiagnosticsEngine(dbAdapter, tsAdapter, typeOverrides);

    const patterns = pattern ? [pattern] : config.paths.include;
    const files = await glob(patterns, {
      cwd,
      ignore: config.paths.exclude,
      absolute: true,
    });

    const allDiagnostics: FileDiagnostic[] = [];
    for (const file of files) {
      if (!file.endsWith('.ts')) continue;
      const diagnostics = await engine.analyze(file);
      for (const d of diagnostics) {
        allDiagnostics.push({ filePath: file, diagnostic: d });
      }
    }

    if (dbAdapter) await dbAdapter.disconnect();

    console.log(formatDiagnostics(allDiagnostics, { verbose, cwd }));

    const hasErrors = allDiagnostics.some(d => d.diagnostic.severity === 'error');
    if (hasErrors) {
      process.exit(1);
    }
  },
});
```

- [ ] **Step 2: Build to verify no type errors**

Run: `cd /Users/donalmacanri/projects/ts-sqlx/main && pnpm build`
Expected: builds successfully

- [ ] **Step 3: Run all tests to verify nothing is broken**

Run: `cd /Users/donalmacanri/projects/ts-sqlx/main && pnpm vitest run`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/check.ts
git commit -m "feat(cli): wire reporter into check command with --verbose flag"
```

### Task 6: Manual smoke test

- [ ] **Step 1: Run check against test fixtures**

Run: `cd /Users/donalmacanri/projects/ts-sqlx/main && pnpm ts-sqlx check 'tests/fixtures/**/*.ts'`
Expected: colored, grouped output with icons and summary

- [ ] **Step 2: Run with --verbose**

Run: `cd /Users/donalmacanri/projects/ts-sqlx/main && pnpm ts-sqlx check 'tests/fixtures/**/*.ts' --verbose`
Expected: same output plus source snippets with gutter and pointer

- [ ] **Step 3: Run with NO_COLOR=1**

Run: `cd /Users/donalmacanri/projects/ts-sqlx/main && NO_COLOR=1 pnpm ts-sqlx check 'tests/fixtures/**/*.ts'`
Expected: same structure but no ANSI color codes
