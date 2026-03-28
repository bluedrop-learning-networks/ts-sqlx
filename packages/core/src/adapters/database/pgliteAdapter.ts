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
    await this.db.exec(sql);
  }

  async describeQuery(sql: string): Promise<QueryTypeInfo> {
    if (!this.db) throw new Error('Not connected');

    const result = await this.db.describeQuery(sql);

    return {
      params: (result.queryParams ?? []).map((p) => {
        const isArr = isArrayOid(p.dataTypeID);
        const typeName = oidToTypeName(p.dataTypeID);
        return {
          oid: p.dataTypeID,
          name: isArr ? arrayElementTypeName(typeName) : typeName,
          isArray: isArr,
        };
      }),
      columns: (result.resultFields ?? []).map((f) => {
        const isArr = isArrayOid(f.dataTypeID);
        const typeName = oidToTypeName(f.dataTypeID);
        return {
          name: f.name,
          type: {
            oid: f.dataTypeID,
            name: isArr ? arrayElementTypeName(typeName) : typeName,
            isArray: isArr,
          },
          nullable: true, // PGLite limitation: always assume nullable
        };
      }),
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
