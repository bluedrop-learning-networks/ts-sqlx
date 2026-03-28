import type { Diagnostic, DiagnosticCode } from '../../core/src/types.js';

export interface FixtureExpectation {
  line: number;
  code?: DiagnosticCode;
  messageSubstring?: string;
  pass?: boolean;
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

    const lineNumber = i + 1;

    if (EXPECT_PASS_PATTERN.test(line)) {
      expectations.push({ line: lineNumber, pass: true });
      continue;
    }

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
