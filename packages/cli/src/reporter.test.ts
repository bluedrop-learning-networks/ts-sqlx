import { describe, it, expect } from 'vitest';
import { formatDiagnostics } from './reporter.js';
import type { Diagnostic } from '@ts-sqlx/core/types.js';

function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('formatDiagnostics', () => {
  it('formats a single error in compact mode', () => {
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
      readFile: () => 'line one\nline 2\n    SELECT * FORM users\nline four\n',
    });

    const plain = strip(result);
    expect(plain).toContain('src/app.ts');
    expect(plain).toContain('✖ TS001 error:');
    expect(plain).toContain(':3:5');
  });

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
});
