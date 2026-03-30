# CLI Output Redesign

**Date**: 2026-03-30
**Issue**: ts-ijl
**Status**: Approved

## Problem

The `ts-sqlx check` CLI output is plain text with no colors, icons, or visual hierarchy. Diagnostics are a flat list of one-liners with no grouping. The output is functional but hard to scan.

## Design

### Output Modes

Two modes controlled by a `--verbose` flag:

**Compact (default)** — diagnostics grouped by file, one line each:

```
src/app.ts
  ✖ TS001 error: SQL syntax error: syntax error at or near "FORM"  :12:5
  ✖ TS002 error: Unknown table: bad_table  :28:5

src/db.ts
  ⚠ TS007 warning: Query has no type annotation  :7:3

src/queries.ts
  ℹ TS008 info: Unable to analyze (dynamic SQL)  :15:1

✖ 2 errors  ⚠ 1 warning  ℹ 1 info
```

**Verbose (`--verbose`)** — same grouping, plus source snippets with gutter and pointer:

```
src/app.ts
  ✖ TS001 error: SQL syntax error: syntax error at or near "FORM"  :12:5
     11 │ const users = sql`
     12 │   SELECT * FORM users
        │            ^^^^
     13 │ `;

  ✖ TS002 error: Unknown table: bad_table  :28:5
     27 │ const data = sql`
     28 │   SELECT * FROM bad_table
        │                 ^^^^^^^^^
     29 │ `;

✖ 2 errors
```

**No issues:**

```
✔ No issues found.
```

### Color Scheme

| Element | Color |
|---------|-------|
| File paths | bold white |
| `error` + `✖` | red |
| `warning` + `⚠` | yellow |
| `info` + `ℹ` | cyan |
| Line/col numbers (`:12:5`) | dim |
| Snippet gutter (line numbers + `│`) | dim |
| Summary counts | colored by severity |

Unicode symbols are always used (no ASCII fallback).

`NO_COLOR` and `FORCE_COLOR` are respected automatically via `picocolors`.

### Icons

| Severity | Icon |
|----------|------|
| error | `✖` |
| warning | `⚠` |
| info | `ℹ` |
| success | `✔` |

### Summary Line

Shows a breakdown by severity, omitting zero counts:

```
✖ 2 errors  ⚠ 1 warning  ℹ 1 info
```

If only errors: `✖ 2 errors`. If no issues: `✔ No issues found.`

### Sorting

- Files: alphabetical by relative path
- Diagnostics within a file: by line number, then column number

## Architecture

### New File: `packages/cli/src/reporter.ts`

Single exported function:

```ts
function formatDiagnostics(
  diagnostics: Diagnostic[],
  options: { verbose: boolean; cwd: string }
): string
```

- Takes the flat diagnostic array from core analysis
- Groups by file, sorts by path, then by line/col within each file
- Returns a fully formatted string (caller does `console.log(result)`)
- For verbose mode, reads source files to extract snippet context (1 line before, target line, 1 line after)

Internal helper for snippet extraction takes file path, line, column and returns formatted gutter lines.

### Changes to `packages/cli/src/commands/check.ts`

- Import and call `formatDiagnostics` instead of inline `console.log` loop
- Add `--verbose` flag via `cmd-ts`
- Summary logic moves into the reporter

### New Dependency

`picocolors` added to `@ts-sqlx/cli` package.json. Chosen for minimal size (< 3KB), zero dependencies, and automatic `NO_COLOR`/`FORCE_COLOR` support.

### Unchanged

`packages/core/src/perf.ts` — debug output on stderr, separate concern, left as-is.

## Edge Cases

- Zero diagnostics: output `✔ No issues found.`
- Single file, one diagnostic: still uses grouped format
- Verbose mode, source file unreadable: skip snippet, show diagnostic line only
- Summary omits zero-count severities

## Testing

New test file: `packages/cli/src/__tests__/reporter.test.ts`

Tests `formatDiagnostics` with mock diagnostic arrays. Uses `picocolors`'s `createColors({ useColor: false })` to strip ANSI codes for simple string comparison assertions.

Test cases:
- Single file, single error (compact)
- Multiple files, mixed severities (compact)
- Zero diagnostics
- Verbose mode with snippet
- Verbose mode with unreadable source file
- Summary line composition (omitting zero counts)
