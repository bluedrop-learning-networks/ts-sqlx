import { execSync } from 'node:child_process';
import * as path from 'node:path';
import type { SchemaSource } from './config.js';

/**
 * Resolve a SchemaSource to an absolute filesystem path.
 *
 * For string form: resolved relative to configDir.
 * For { command } form: spawns the command in configDir, treats the first
 * non-empty stdout line as the path (resolved relative to configDir).
 * stderr is inherited so logging from e.g. snapshot resolvers reaches the user.
 *
 * Returns null when schema is undefined (caller decides whether that's an error).
 */
export function resolveSchemaPath(
  schema: SchemaSource | undefined,
  configDir: string,
): string | null {
  if (!schema) return null;
  if (typeof schema === 'string') {
    return path.resolve(configDir, schema);
  }
  const stdout = execSync(schema.command, {
    cwd: configDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const firstLine = stdout.split('\n').find((l) => l.trim().length > 0);
  if (!firstLine) {
    throw new Error(
      `ts-sqlx: [database.schema] command produced no stdout: ${schema.command}`,
    );
  }
  return path.resolve(configDir, firstLine.trim());
}
