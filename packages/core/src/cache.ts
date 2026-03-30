import type { InferredQueryType } from './types.js';
import * as crypto from 'crypto';

export class TypeCache {
  private entries = new Map<string, InferredQueryType>();

  constructor(_dbPath?: string) {
    // _dbPath accepted for backward compatibility but ignored
  }

  get(sql: string): InferredQueryType | undefined {
    return this.entries.get(this.hash(sql));
  }

  set(sql: string, types: InferredQueryType): void {
    this.entries.set(this.hash(sql), types);
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

  private hash(sql: string): string {
    return crypto.createHash('sha256').update(sql).digest('hex');
  }
}
