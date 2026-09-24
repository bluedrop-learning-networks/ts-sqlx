import type { AnalysisResult, Diagnostic, InferredColumn, QueryAnalysis, QueryCallInfo } from './types.js';
import type { DatabaseAdapter } from './adapters/database/types.js';
import type { TypeScriptAdapter } from './adapters/typescript/types.js';
import type { TypeOverride } from './config.js';
import { QueryDetector } from './queryDetector.js';
import { extractParams } from './paramExtractor.js';
import { parseSqlAsync } from './sqlAnalyzer.js';
import { DbInferrer } from './dbInferrer.js';
import { extractNullabilityHints } from './hintExtractor.js';
import { compareTypes, generateTypeAnnotation } from './typeComparator.js';
import { perf } from './perf.js';
import { formatParamType, isParamCompatible, paramTypeFromText, type ParamTypeMember } from './paramTypes.js';

export class DiagnosticsEngine {
  private queryDetector: QueryDetector;
  private inferrer: DbInferrer | null;

  constructor(
    private dbAdapter: DatabaseAdapter | null,
    private tsAdapter: TypeScriptAdapter,
    private typeOverrides?: Map<string, TypeOverride>,
  ) {
    this.queryDetector = new QueryDetector(tsAdapter);
    this.inferrer = dbAdapter ? new DbInferrer(dbAdapter, typeOverrides) : null;
  }

  async init(): Promise<void> {
    if (this.inferrer) {
      await this.inferrer.init();
    }
  }

  async analyze(filePath: string): Promise<Diagnostic[]> {
    const result = await this.analyzeWithContext(filePath);
    return result.diagnostics;
  }

  async analyzeWithContext(filePath: string): Promise<AnalysisResult> {
    perf.reset();
    const allDiagnostics: Diagnostic[] = [];
    const queryAnalyses: QueryAnalysis[] = [];
    const queries = perf.withTiming('detectQueries', () =>
      this.queryDetector.detectQueries(filePath),
    );

    for (const query of queries) {
      const { diagnostics, inferredColumns } = await perf.withTiming('analyzeQuery', () =>
        this.analyzeQuery(query, filePath),
      );
      allDiagnostics.push(...diagnostics);
      queryAnalyses.push({ query, diagnostics, inferredColumns });
    }

    const summary = perf.summarize();
    perf.logSummary(filePath, summary);
    return { diagnostics: allDiagnostics, queries: queryAnalyses };
  }

  private async analyzeQuery(query: QueryCallInfo, filePath: string): Promise<{ diagnostics: Diagnostic[]; inferredColumns?: InferredColumn[] }> {
    const diagnostics: Diagnostic[] = [];

    // TS008: dynamic/unanalyzable SQL
    if (query.sqlText === undefined) {
      diagnostics.push({
        code: 'TS008',
        severity: 'info',
        message: 'Unable to analyze: dynamic SQL',
        range: query.position,
      });
      return { diagnostics };
    }

    // TS007: no type annotation on query that returns results
    if (!query.declaredResultType && query.method !== 'none') {
      diagnostics.push({
        code: 'TS007',
        severity: 'warning',
        message: 'Query has no type annotation',
        range: query.position,
      });
    }

    // Extract nullability hints from leading block comment
    const { cleanedSql, hints } = extractNullabilityHints(query.sqlText);

    // Extract params and check for param syntax errors
    const extracted = extractParams(cleanedSql);
    for (const err of extracted.errors) {
      diagnostics.push({
        code: 'TS001',
        severity: 'error',
        message: `SQL parameter syntax error: ${err.message}`,
        range: query.position,
      });
    }

    // TS005: Wrong parameter count (indexed params)
    const indexedParams = extracted.params.filter(p => p.kind === 'indexed');
    if (indexedParams.length > 0) {
      const maxParamNum = Math.max(...indexedParams.map(p => p.number));
      const providedCount = countArrayElements(query.paramsText);

      if (providedCount !== undefined) {
        if (providedCount !== maxParamNum) {
          diagnostics.push({
            code: 'TS005',
            severity: 'error',
            message: `Wrong parameter count: expected ${maxParamNum}, got ${providedCount}`,
            range: query.position,
          });
        }
      } else if (query.paramsArgIndex === undefined && maxParamNum > 0) {
        // No params argument at all but SQL has placeholders
        diagnostics.push({
          code: 'TS005',
          severity: 'error',
          message: `Wrong parameter count: expected ${maxParamNum}, got 0`,
          range: query.position,
        });
      }
    }

    // TS006: Missing named parameter property
    const namedParams = extracted.params.filter(p => p.kind === 'named');
    if (namedParams.length > 0 && query.paramsText) {
      const uniqueNames = [...new Set(namedParams.map(p => p.name!))];
      const providedProps = extractObjectPropertyNames(query.paramsText);
      if (providedProps !== undefined) {
        for (const name of uniqueNames) {
          if (!providedProps.includes(name)) {
            diagnostics.push({
              code: 'TS006',
              severity: 'error',
              message: `Missing parameter property: ${name}`,
              range: query.position,
            });
          }
        }
      }
    }

    // TS001: SQL syntax errors via parseSql
    const parseResult = await perf.withTiming('parseSqlAsync', () =>
      parseSqlAsync(extracted.normalized),
    );
    if (!parseResult.valid) {
      diagnostics.push({
        code: 'TS001',
        severity: 'error',
        message: `SQL syntax error: ${parseResult.error!.message}`,
        range: query.position,
      });
      return { diagnostics };
    }

    // TS009: no DB connection
    if (!this.dbAdapter || !this.dbAdapter.isConnected()) {
      diagnostics.push({
        code: 'TS009',
        severity: 'warning',
        message: 'No database connection — cannot infer types',
        range: query.position,
      });
      return { diagnostics };
    }

    let inferredColumns: InferredColumn[] | undefined;

    try {
      const inferred = await perf.withTiming('dbInfer', () =>
        this.inferrer!.infer(extracted.normalized, hints),
      );
      inferredColumns = inferred.columns;

      // TS004: Type mismatch between TS param types and inferred SQL param types
      if (indexedParams.length > 0 && query.paramsText && inferred.params.length > 0) {
        const elementTypes = inferElementTypes(query.paramsText, query.paramsElementTypes);
        if (elementTypes) {
          for (let i = 0; i < Math.min(elementTypes.length, inferred.params.length); i++) {
            const inferredParam = inferred.params[i];
            const tsType = elementTypes[i];
            if (tsType && !isParamCompatible(tsType, inferredParam)) {
              // Find the SQL column name this param is used with
              const paramColName = findParamColumnName(query.sqlText, i + 1);
              diagnostics.push({
                code: 'TS004',
                severity: 'error',
                message: paramColName
                  ? `Type mismatch for ${paramColName}: expected ${inferredParam.tsType}, got ${formatParamType(tsType)}`
                  : `Type mismatch for parameter $${i + 1}: expected ${inferredParam.tsType}, got ${formatParamType(tsType)}`,
                range: query.position,
              });
            }
          }
        }
      }

      // TS010: declared vs inferred type mismatch
      if (query.declaredResultType) {
        const declaredProps = query.resolvedTypeProperties?.length
          ? query.resolvedTypeProperties
          : perf.withTiming('getTypeProperties', () =>
              this.tsAdapter.getTypeProperties(query.declaredResultType!, filePath),
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
        } else {
          diagnostics.push({
            code: 'TS011',
            severity: 'info',
            message: `Unable to resolve type '${query.declaredResultType}' for comparison`,
            range: query.position,
          });
        }
      }
    } catch (e: unknown) {
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

    return { diagnostics, inferredColumns };
  }
}

/**
 * Count elements in an array literal text like `["a", "b", "c"]`.
 * Returns undefined if the text is not a recognizable array literal.
 */
function countArrayElements(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return undefined;
  const inner = trimmed.slice(1, -1).trim();
  if (inner === '') return 0;
  // Simple comma counting -- works for flat array literals
  return splitTopLevel(inner).length;
}

/**
 * Extract property names from an object literal text like `{ id: "123", email: "test" }`.
 * Returns undefined if the text is not a recognizable object literal.
 */
function extractObjectPropertyNames(text: string): string[] | undefined {
  const trimmed = text.trim();
  // Handle "{ ... } as Type" pattern
  const asIdx = trimmed.lastIndexOf(' as ');
  const objText = asIdx >= 0 ? trimmed.slice(0, asIdx).trim() : trimmed;

  if (!objText.startsWith('{') || !objText.endsWith('}')) return undefined;
  const inner = objText.slice(1, -1).trim();
  if (inner === '') return [];

  const parts = splitTopLevel(inner);
  return parts
    .map(p => {
      const colonIdx = p.indexOf(':');
      if (colonIdx === -1) return p.trim(); // shorthand property
      return p.slice(0, colonIdx).trim();
    })
    .filter(name => name.length > 0);
}

/**
 * Split a string by top-level commas (not inside brackets/parens/strings).
 */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let inString: string | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      current += ch;
      if (ch === inString && text[i - 1] !== '\\') {
        inString = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      current += ch;
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      current += ch;
      continue;
    }

    if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      current += ch;
      continue;
    }

    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim().length > 0) {
    parts.push(current);
  }

  return parts;
}

/**
 * The type of each element of the params array: from the type checker when the params argument
 * is an array literal or a tuple, otherwise from the literal text of each element.
 */
function inferElementTypes(
  paramsText: string | undefined,
  paramsElementTypes: ParamTypeMember[][] | undefined,
): ParamTypeMember[][] | undefined {
  if (paramsElementTypes) {
    return paramsElementTypes;
  }

  if (paramsText) {
    const trimmed = paramsText.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const inner = trimmed.slice(1, -1).trim();
      if (inner === '') return [];
      const elements = splitTopLevel(inner).map((el) => el.trim());
      // A spread hides how many values, and of what type, land at each position
      if (elements.some((el) => el.startsWith('...'))) return undefined;
      return elements.map(inferLiteralType);
    }
  }

  return undefined;
}

/**
 * Infer the TS type of a literal value from its text representation.
 */
function inferLiteralType(text: string): ParamTypeMember[] {
  if (text.startsWith('"') || text.startsWith("'")) {
    return paramTypeFromText(text);
  }
  if (text.startsWith('`')) {
    return [{ kind: 'type', text: 'string' }];
  }
  if (text === 'true' || text === 'false' || text === 'null' || text === 'undefined') {
    return paramTypeFromText(text);
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    return [{ kind: 'type', text: 'number' }];
  }
  if (text.startsWith('[')) {
    return [{ kind: 'type', text: 'array' }];
  }
  if (text.startsWith('{')) {
    return [{ kind: 'type', text: 'object' }];
  }
  return [{ kind: 'type', text: 'unknown' }];
}

/**
 * Try to find the column name that a parameter $N is being compared to in a SQL query.
 * E.g., "WHERE age = $1" -> "age" for param 1.
 */
function findParamColumnName(sql: string, paramNum: number): string | undefined {
  const pattern = new RegExp(`(\\w+)\\s*=\\s*\\$${paramNum}\\b`);
  const match = sql.match(pattern);
  return match ? match[1] : undefined;
}
