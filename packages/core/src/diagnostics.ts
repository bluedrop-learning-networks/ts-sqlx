import type { Diagnostic, DiagnosticCode, DiagnosticSeverity, QueryCallInfo, ParamRef } from './types.js';
import type { DatabaseAdapter } from './adapters/database/types.js';
import type { TypeScriptAdapter } from './adapters/typescript/types.js';
import { QueryDetector } from './queryDetector.js';
import { extractParams } from './paramExtractor.js';
import { parseSqlAsync } from './sqlAnalyzer.js';
import { DbInferrer } from './dbInferrer.js';
import { compareTypes, generateTypeAnnotation } from './typeComparator.js';

export class DiagnosticsEngine {
  private queryDetector: QueryDetector;
  private inferrer: DbInferrer | null;

  constructor(
    private dbAdapter: DatabaseAdapter | null,
    private tsAdapter: TypeScriptAdapter,
  ) {
    this.queryDetector = new QueryDetector(tsAdapter);
    this.inferrer = dbAdapter ? new DbInferrer(dbAdapter) : null;
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

  private async analyzeQuery(query: QueryCallInfo, filePath: string): Promise<Diagnostic[]> {
    const diagnostics: Diagnostic[] = [];

    // TS008: dynamic/unanalyzable SQL
    if (query.sqlText === undefined) {
      diagnostics.push({
        code: 'TS008',
        severity: 'info',
        message: 'Unable to analyze: dynamic SQL',
        range: query.position,
      });
      return diagnostics;
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

    // Extract params and check for param syntax errors
    const extracted = extractParams(query.sqlText);
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
    const parseResult = await parseSqlAsync(extracted.normalized);
    if (!parseResult.valid) {
      diagnostics.push({
        code: 'TS001',
        severity: 'error',
        message: `SQL syntax error: ${parseResult.error!.message}`,
        range: query.position,
      });
      return diagnostics;
    }

    // TS009: no DB connection
    if (!this.dbAdapter || !this.dbAdapter.isConnected()) {
      diagnostics.push({
        code: 'TS009',
        severity: 'warning',
        message: 'No database connection — cannot infer types',
        range: query.position,
      });
      return diagnostics;
    }

    try {
      const inferred = await this.inferrer!.infer(extracted.normalized);

      // TS004: Type mismatch between TS param types and inferred SQL param types
      if (indexedParams.length > 0 && query.paramsText && inferred.params.length > 0) {
        const elementTypes = inferElementTypes(query.paramsText, query.paramsType);
        if (elementTypes) {
          for (let i = 0; i < Math.min(elementTypes.length, inferred.params.length); i++) {
            const inferredParam = inferred.params[i];
            const tsType = elementTypes[i];
            if (tsType && !isParamTypeCompatible(tsType, inferredParam.tsType)) {
              // Find the SQL column name this param is used with
              const paramColName = findParamColumnName(query.sqlText, i + 1);
              diagnostics.push({
                code: 'TS004',
                severity: 'error',
                message: paramColName
                  ? `Type mismatch for ${paramColName}: expected ${inferredParam.tsType}, got ${tsType}`
                  : `Type mismatch for parameter $${i + 1}: expected ${inferredParam.tsType}, got ${tsType}`,
                range: query.position,
              });
            }
          }
        }
      }

      // TS010: declared vs inferred type mismatch
      if (query.declaredResultType) {
        const declaredProps = this.tsAdapter.getTypeProperties(query.declaredResultType, filePath);
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
 * Infer element types from params text and/or params type.
 * Tries to determine the TS type of each element in the params array.
 */
function inferElementTypes(paramsText: string | undefined, paramsType: string | undefined): string[] | undefined {
  // First try tuple types from TS: [string, number]
  if (paramsType) {
    const trimmed = paramsType.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const inner = trimmed.slice(1, -1).trim();
      if (inner === '') return [];
      return splitTopLevel(inner).map(t => t.trim());
    }
  }

  // Infer types from literal values in the params text
  if (paramsText) {
    const trimmed = paramsText.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const inner = trimmed.slice(1, -1).trim();
      if (inner === '') return [];
      const elements = splitTopLevel(inner);
      return elements.map(el => inferLiteralType(el.trim()));
    }
  }

  // Fall back to array element type: string[] -> all elements are string
  if (paramsType) {
    const match = paramsType.match(/^(\w+)\[\]$/);
    if (match) {
      // Can't determine individual element types from a uniform array type
      return undefined;
    }
  }

  return undefined;
}

/**
 * Infer the TS type of a literal value from its text representation.
 */
function inferLiteralType(text: string): string {
  if (text.startsWith('"') || text.startsWith("'") || text.startsWith('`')) {
    return 'string';
  }
  if (text === 'true' || text === 'false') {
    return 'boolean';
  }
  if (text === 'null') {
    return 'null';
  }
  if (text === 'undefined') {
    return 'undefined';
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    return 'number';
  }
  if (text.startsWith('[')) {
    return 'array';
  }
  if (text.startsWith('{')) {
    return 'object';
  }
  return 'unknown';
}

/**
 * Check if a TS type is compatible with an expected SQL param type.
 */
function isParamTypeCompatible(tsType: string, expectedType: string): boolean {
  const normalizedTs = tsType.replace(/\s+/g, '').toLowerCase();
  const normalizedExpected = expectedType.replace(/\s+/g, '').toLowerCase();

  if (normalizedTs === normalizedExpected) return true;

  // string is compatible with string
  // number is compatible with number
  // "not a number" literal type -> string, not compatible with number
  if (normalizedTs.startsWith('"') || normalizedTs.startsWith("'")) {
    // String literal type -- compatible with string
    return normalizedExpected === 'string';
  }

  if (/^\d+$/.test(normalizedTs)) {
    // Number literal type -- compatible with number
    return normalizedExpected === 'number';
  }

  if (normalizedTs === 'true' || normalizedTs === 'false') {
    return normalizedExpected === 'boolean';
  }

  return false;
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
