import type { Diagnostic, DiagnosticCode, DiagnosticSeverity, QueryCallInfo } from './types.js';
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
