import { PGlite } from '@electric-sql/pglite';
import type {
  DatabaseAdapter,
  QueryTypeInfo,
  CompositeField,
} from './types.js';
import { oidToTypeName, isArrayOid, arrayElementTypeName } from './oidMap.js';

export class PGLiteAdapter implements DatabaseAdapter {
  private db: PGlite | null = null;

  private constructor() {}

  static async create(): Promise<PGLiteAdapter> {
    const adapter = new PGLiteAdapter();
    adapter.db = new PGlite();
    await adapter.db.waitReady;
    return adapter;
  }

  async connect(): Promise<void> {
    // Already connected via create()
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  isConnected(): boolean {
    return this.db !== null;
  }

  async executeSchema(sql: string): Promise<void> {
    if (!this.db) throw new Error('Not connected');

    const sanitized = sanitizeSchemaForPGLite(sql);

    // Try executing the full schema at once first (fast path)
    try {
      await this.db.exec(sanitized);
      return;
    } catch {
      // Fall back to statement-by-statement execution for pg_dump schemas
      // that may have ordering issues or unsupported features
    }

    // Split into statements and execute individually, skipping failures.
    // This handles pg_dump output where functions reference tables not yet
    // created, or where extension-specific types (e.g. PostGIS) are missing.
    const statements = splitSqlStatements(sanitized);
    const deferred: string[] = [];
    for (const stmt of statements) {
      try {
        await this.db.exec(stmt);
      } catch {
        deferred.push(stmt);
      }
    }
    // Retry failed statements once (handles forward references)
    for (const stmt of deferred) {
      try { await this.db.exec(stmt); } catch { /* skip */ }
    }
  }

  private static stmtCounter = 0;

  async describeQuery(sql: string): Promise<QueryTypeInfo> {
    if (!this.db) throw new Error('Not connected');

    // First, use PGLite's describeQuery() which handles errors gracefully.
    // This validates the SQL and gives us column names, types, and params.
    const result = await this.db.describeQuery(sql);

    const params = (result.queryParams ?? []).map((p) => {
      const isArr = isArrayOid(p.dataTypeID);
      const typeName = oidToTypeName(p.dataTypeID);
      return {
        oid: p.dataTypeID,
        name: isArr ? arrayElementTypeName(typeName) : typeName,
        isArray: isArr,
      };
    });

    const baseColumns = (result.resultFields ?? []).map((f) => {
      const isArr = isArrayOid(f.dataTypeID);
      const typeName = oidToTypeName(f.dataTypeID);
      return {
        name: f.name,
        type: {
          oid: f.dataTypeID,
          name: isArr ? arrayElementTypeName(typeName) : typeName,
          isArray: isArr,
        },
        nullable: true,
      };
    });

    // Use execProtocol to get tableID/columnID for accurate nullability.
    // describeQuery() above already validated the SQL, so execProtocol should
    // not encounter parse errors. If it does crash, we must let it propagate —
    // a WASM crash permanently corrupts the PGLite instance, so silently
    // falling back would hide the real problem.
    const stmtName = `_ts_sqlx_${++PGLiteAdapter.stmtCounter}`;
    const { fields: protoFields } = await this.describeViaProtocol(sql, stmtName);

    if (protoFields.length !== baseColumns.length) {
      return { params, columns: baseColumns };
    }

    // Look up nullability from pg_attribute using tableID/columnID
    const tableColumns = protoFields.filter(
      (f: any) => f.tableID && f.columnID,
    );

    const nullabilityMap = new Map<string, boolean>();
    if (tableColumns.length > 0) {
      const valuesList = tableColumns
        .map((tc: any) => `(${tc.tableID}, ${tc.columnID})`)
        .join(', ');
      const nullResult = await this.db.query<{
        attrelid: number;
        attnum: number;
        nullable: boolean;
      }>(
        `SELECT attrelid, attnum, NOT attnotnull AS nullable
         FROM pg_attribute
         WHERE (attrelid, attnum) IN (${valuesList})`,
      );
      for (const row of nullResult.rows) {
        nullabilityMap.set(`${row.attrelid}:${row.attnum}`, row.nullable);
      }
    }

    const columns = baseColumns.map((col, i) => {
      const pf = protoFields![i];
      const nullable =
        pf.tableID && pf.columnID
          ? nullabilityMap.get(`${pf.tableID}:${pf.columnID}`) ?? true
          : true;
      return { ...col, nullable };
    });

    return { params, columns };
  }

  /**
   * Send raw PARSE + DESCRIBE + SYNC wire protocol messages via execProtocol,
   * then clean up with CLOSE + SYNC. Returns parameter OIDs and full
   * RowDescription fields (including tableID/columnID).
   */
  private async describeViaProtocol(
    sql: string,
    stmtName: string,
  ): Promise<{ params: number[]; fields: any[] }> {
    const db = this.db!;

    // Build PARSE + DESCRIBE(Statement) + SYNC
    const parsePayload = Buffer.concat([
      Buffer.from(stmtName + '\0'),
      Buffer.from(sql + '\0'),
      Buffer.from([0, 0]), // 0 parameter type OIDs
    ]);
    const descPayload = Buffer.concat([
      Buffer.from('S'),
      Buffer.from(stmtName + '\0'),
    ]);
    const describeMsg = Buffer.concat([
      wireMsg('P', parsePayload),
      wireMsg('D', descPayload),
      wireMsg('S', Buffer.alloc(0)), // Sync
    ]);

    const result = await db.execProtocol(new Uint8Array(describeMsg));
    const messages: any[] = (result as any).messages ?? [];

    // Check for errors
    const error = messages.find((m: any) => m.name === 'error');
    if (error) {
      throw new Error(error.message ?? 'describeQuery failed');
    }

    const paramDesc = messages.find(
      (m: any) => m.name === 'parameterDescription',
    );
    const rowDesc = messages.find((m: any) => m.name === 'rowDescription');

    // Clean up: CLOSE(Statement) + SYNC
    const closePayload = Buffer.concat([
      Buffer.from('S'),
      Buffer.from(stmtName + '\0'),
    ]);
    const closeMsg = Buffer.concat([
      wireMsg('C', closePayload),
      wireMsg('S', Buffer.alloc(0)),
    ]);
    try {
      await db.execProtocol(new Uint8Array(closeMsg));
    } catch {
      // Ignore — statement may not exist if PARSE failed
    }

    return {
      params: paramDesc?.dataTypeIDs ?? [],
      fields: rowDesc?.fields ?? [],
    };
  }

  async getEnumValues(typeName: string): Promise<string[]> {
    if (!this.db) throw new Error('Not connected');
    const result = await this.db.query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum
       JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
       WHERE pg_type.typname = $1
       ORDER BY pg_enum.enumsortorder`,
      [typeName]
    );
    return result.rows.map((r) => r.enumlabel);
  }

  async getCompositeFields(typeName: string): Promise<CompositeField[]> {
    if (!this.db) throw new Error('Not connected');
    const result = await this.db.query<{
      attname: string;
      atttypid: number;
    }>(
      `SELECT a.attname, a.atttypid
       FROM pg_attribute a
       JOIN pg_type t ON a.attrelid = t.typrelid
       WHERE t.typname = $1 AND a.attnum > 0
       ORDER BY a.attnum`,
      [typeName]
    );
    return result.rows.map((r) => ({
      name: r.attname,
      type: {
        oid: r.atttypid,
        name: oidToTypeName(r.atttypid),
        isArray: isArrayOid(r.atttypid),
      },
    }));
  }
}

/**
 * Build a single PostgreSQL wire protocol message: tag (1 byte) + int32 length + payload.
 */
function wireMsg(tag: string, payload: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeInt32BE(4 + payload.length, 0);
  return Buffer.concat([Buffer.from(tag), len, payload]);
}

/**
 * Sanitize a SQL schema (potentially from pg_dump) for PGLite compatibility.
 * Strips unsupported SET commands, extension management, owner/ACL statements,
 * and adds stubs for common extension functions.
 */
function sanitizeSchemaForPGLite(sql: string): string {
  const preamble = `
    SET check_function_bodies = false;
    CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS uuid
      LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;
    CREATE OR REPLACE FUNCTION public.uuid_generate_v4() RETURNS uuid
      LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;
  `;

  const cleaned = sql
    // Strip SET commands (pg_dump preamble) but keep check_function_bodies
    .replace(/^SET\s+(?!check_function_bodies)\w+\s*=\s*[^;]*;/gm, '')
    // Strip pg_catalog.set_config calls
    .replace(/^SELECT\s+pg_catalog\.set_config\b[^;]*;/gm, '')
    // Strip extension management
    .replace(/^CREATE\s+EXTENSION\b[^;]*;/gm, '')
    .replace(/^COMMENT\s+ON\s+EXTENSION\b[^;]*;/gm, '')
    // Strip ownership and ACL statements
    .replace(/^ALTER\s+\w+\s+[^;]*\s+OWNER\s+TO\b[^;]*;/gm, '')
    .replace(/^REVOKE\b[^;]*;/gm, '')
    .replace(/^GRANT\b[^;]*;/gm, '');

  return preamble + cleaned;
}

/**
 * Split SQL text into individual statements, respecting dollar-quoted strings
 * and standard string literals so we don't split on semicolons inside them.
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;

  while (i < sql.length) {
    // Dollar-quoted string: $tag$...$tag$
    if (sql[i] === '$') {
      const tagMatch = sql.slice(i).match(/^(\$[^$]*\$)/);
      if (tagMatch) {
        const tag = tagMatch[1];
        current += tag;
        i += tag.length;
        const endIdx = sql.indexOf(tag, i);
        if (endIdx !== -1) {
          current += sql.slice(i, endIdx + tag.length);
          i = endIdx + tag.length;
        }
        continue;
      }
    }

    // Single-quoted string
    if (sql[i] === "'") {
      current += sql[i++];
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          current += "''";
          i += 2;
        } else if (sql[i] === "'") {
          current += sql[i++];
          break;
        } else {
          current += sql[i++];
        }
      }
      continue;
    }

    // Line comment
    if (sql[i] === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      if (nl === -1) { i = sql.length; continue; }
      current += sql.slice(i, nl + 1);
      i = nl + 1;
      continue;
    }

    // Statement separator
    if (sql[i] === ';') {
      current += ';';
      const trimmed = current.trim();
      if (trimmed.length > 1) {
        statements.push(trimmed);
      }
      current = '';
      i++;
      continue;
    }

    current += sql[i++];
  }

  const trimmed = current.trim();
  if (trimmed.length > 0 && trimmed !== ';') {
    statements.push(trimmed);
  }

  return statements;
}
