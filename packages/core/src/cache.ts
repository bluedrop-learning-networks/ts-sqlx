import type { InferredQueryType } from './types.js';
import * as crypto from 'crypto';

/**
 * In-memory cache of inferred query types, keyed by the combination of the
 * query SQL text AND a schema fingerprint. Callers MUST pass a stable
 * fingerprint derived from the active schema (e.g. SHA256 of the loaded
 * schema.sql contents) so that entries computed against one schema are not
 * silently reused after the schema changes.
 */
export class TypeCache {
  private entries = new Map<string, InferredQueryType>();

  constructor(_dbPath?: string) {
    // _dbPath accepted for backward compatibility but ignored
  }

  get(sql: string, schemaFingerprint: string): InferredQueryType | undefined {
    return this.entries.get(this.hashKey(sql, schemaFingerprint));
  }

  set(sql: string, schemaFingerprint: string, types: InferredQueryType): void {
    this.entries.set(this.hashKey(sql, schemaFingerprint), types);
  }

  clear(): void {
    this.entries.clear();
  }

  stats(): { entries: number } {
    return { entries: this.entries.size };
  }

  close(): void {
    this.entries.clear();
  }

  private hashKey(sql: string, schemaFingerprint: string): string {
    return crypto
      .createHash('sha256')
      .update(sql)
      .update('\0')
      .update(schemaFingerprint)
      .digest('hex');
  }
}
