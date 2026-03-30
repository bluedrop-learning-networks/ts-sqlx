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
  if (targetLine < 0 || targetLine >= sourceLines.length) return [];
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
  const lineLen = sourceLines[targetLine].length;
  const maxCarets = Math.max(1, lineLen - (pos.col - 1));
  const pointer = ' '.repeat(pos.col - 1) + '^'.repeat(Math.min(spanLen, maxCarets));
  lines.push(pc.dim(`     ${' '.repeat(gutterWidth)} │ `) + COLORS[diagnostic.severity](pointer));

  // Line after
  if (targetLine + 1 < sourceLines.length) {
    const ln2 = String(targetLine + 2).padStart(gutterWidth);
    lines.push(pc.dim(`     ${ln2} │ `) + sourceLines[targetLine + 1]);
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
