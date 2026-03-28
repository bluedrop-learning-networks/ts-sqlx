import { parse, parseSync, loadModule, hasSqlDetails } from 'libpg-query';

export interface ParseResult {
  valid: boolean;
  error?: {
    message: string;
    cursorPosition?: number;
  };
}

let moduleLoaded = false;

/**
 * Ensures the libpg-query WASM module is loaded.
 * Must be called before using parseSqlSync.
 */
export async function ensureModuleLoaded(): Promise<void> {
  if (!moduleLoaded) {
    await loadModule();
    moduleLoaded = true;
  }
}

/**
 * Parse SQL asynchronously. Automatically initializes the WASM module if needed.
 */
export async function parseSqlAsync(sql: string): Promise<ParseResult> {
  const trimmed = sql.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      error: { message: 'Empty query' },
    };
  }

  try {
    await parse(trimmed);
    return { valid: true };
  } catch (e: unknown) {
    return buildErrorResult(e);
  }
}

/**
 * Parse SQL synchronously. Requires ensureModuleLoaded() to have been called first.
 */
export function parseSql(sql: string): ParseResult {
  const trimmed = sql.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      error: { message: 'Empty query' },
    };
  }

  try {
    parseSync(trimmed);
    return { valid: true };
  } catch (e: unknown) {
    return buildErrorResult(e);
  }
}

function buildErrorResult(e: unknown): ParseResult {
  const err = e as Error;
  const cursorPosition = hasSqlDetails(err)
    ? err.sqlDetails.cursorPosition
    : undefined;
  return {
    valid: false,
    error: {
      message: err.message,
      cursorPosition,
    },
  };
}
