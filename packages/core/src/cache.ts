import Database from 'better-sqlite3';
import type { InferredQueryType } from './types.js';
import * as crypto from 'crypto';

export class TypeCache {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS query_types (
        sql_hash TEXT PRIMARY KEY,
        sql_text TEXT NOT NULL,
        params TEXT NOT NULL,
        columns TEXT NOT NULL,
        schema_hash TEXT NOT NULL DEFAULT '',
        inferred_at INTEGER NOT NULL
      );
    `);
  }

  get(sql: string): InferredQueryType | undefined {
    const hash = this.hash(sql);
    const row = this.db
      .prepare('SELECT params, columns FROM query_types WHERE sql_hash = ?')
      .get(hash) as { params: string; columns: string } | undefined;

    if (!row) return undefined;

    return {
      params: JSON.parse(row.params),
      columns: JSON.parse(row.columns),
    };
  }

  set(sql: string, types: InferredQueryType): void {
    const hash = this.hash(sql);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO query_types (sql_hash, sql_text, params, columns, inferred_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        hash,
        sql,
        JSON.stringify(types.params),
        JSON.stringify(types.columns),
        Date.now(),
      );
  }

  clear(): void {
    this.db.exec('DELETE FROM query_types');
  }

  stats(): { entries: number } {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM query_types')
      .get() as { count: number };
    return { entries: row.count };
  }

  close(): void {
    this.db.close();
  }

  private hash(sql: string): string {
    return crypto.createHash('sha256').update(sql).digest('hex');
  }
}
