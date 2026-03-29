import type { TypeScriptAdapter, CallExpressionInfo } from './adapters/typescript/types.js';
import type { QueryCallInfo, QueryMethod, QueryLibrary } from './types.js';
import { perf } from './perf.js';

const PG_PROMISE_METHODS: Set<string> = new Set([
  'one', 'oneOrNone', 'many', 'manyOrNone', 'any',
  'none', 'result', 'query', 'multi',
]);

const NODE_PG_METHODS: Set<string> = new Set(['query']);

export class QueryDetector {
  constructor(private tsAdapter: TypeScriptAdapter) {}

  detectQueries(filePath: string): QueryCallInfo[] {
    const calls = perf.withTiming('getCallExpressions', () =>
      this.tsAdapter.getCallExpressions(filePath),
    );
    const results: QueryCallInfo[] = [];

    for (const call of calls) {
      const info = this.classifyCall(call, filePath);
      if (info) results.push(info);
    }

    return results;
  }

  private classifyCall(
    call: CallExpressionInfo,
    filePath: string,
  ): QueryCallInfo | undefined {
    let library: QueryLibrary | undefined;

    if (PG_PROMISE_METHODS.has(call.methodName) && this.isPgPromiseType(call.receiverType)) {
      library = 'pg-promise';
    } else if (NODE_PG_METHODS.has(call.methodName) && this.isNodePostgresType(call.receiverType)) {
      library = 'node-postgres';
    }

    if (!library) return undefined;

    let sqlText: string | undefined;
    if (call.arguments.length > 0) {
      const sqlArg = call.arguments[0];
      sqlText = perf.withTiming('resolveStringLiteral', () =>
        this.tsAdapter.resolveStringLiteral(filePath, sqlArg.position),
      );
      if (sqlText === undefined) {
        sqlText = this.extractStringValue(sqlArg.text);
      }
    }

    return {
      library,
      method: call.methodName as QueryMethod,
      sqlArgIndex: 0,
      paramsArgIndex: call.arguments.length > 1 ? 1 : undefined,
      sqlText,
      declaredResultType: call.typeArguments.length > 0 ? call.typeArguments[0] : undefined,
      paramsType: call.arguments.length > 1 ? call.arguments[1].type : undefined,
      paramsText: call.arguments.length > 1 ? call.arguments[1].text : undefined,
      position: call.position,
      insertTypePosition: call.insertTypePosition,
      typeArgumentRange: call.typeArgumentRange,
      resolvedTypeProperties: call.resolvedTypeProperties,
    };
  }

  private isPgPromiseType(typeText: string): boolean {
    return /\bIDatabase\b/.test(typeText) ||
           /\bITask\b/.test(typeText) ||
           /\bIBaseProtocol\b/.test(typeText) ||
           typeText.includes('pg-promise') ||
           typeText === 'any';
  }

  private isNodePostgresType(typeText: string): boolean {
    return /\b(Pool|PoolClient|Client)\b/.test(typeText) &&
           (typeText.includes('pg') || typeText.includes('node-postgres'));
  }

  private extractStringValue(text: string): string | undefined {
    if ((text.startsWith('"') && text.endsWith('"')) ||
        (text.startsWith("'") && text.endsWith("'"))) {
      return text.slice(1, -1);
    }
    if (text.startsWith('`') && text.endsWith('`') && !text.includes('${')) {
      return text.slice(1, -1);
    }
    return undefined;
  }
}
