import pg from 'pg';
import type {
  DatabaseAdapter,
  QueryTypeInfo,
  PgTypeInfo,
  ColumnInfo,
  CompositeField,
} from './types.js';
import { oidToTypeName, isArrayOid, arrayElementTypeName } from './oidMap.js';
import { queryEnumValues, queryCompositeFields, buildNullabilityMap } from './shared.js';

const { Pool } = pg;

/**
 * Result from a PARSE + DESCRIBE sequence.
 * parameterOIDs come from ParameterDescription.
 * fields come from RowDescription (or empty for NoData).
 */
interface DescribeResult {
  parameterOIDs: number[];
  fields: Array<{
    name: string;
    tableID: number;
    columnID: number;
    dataTypeID: number;
  }>;
}

/**
 * Implements pg's Submittable interface to send raw PARSE + DESCRIBE
 * wire protocol messages. Passed to client.query() which calls submit()
 * with the underlying Connection object — same pattern as pg-cursor.
 *
 * This gets parameter types AND column metadata (including tableID/columnID
 * for nullability lookups) without executing the query at all.
 */
class QueryDescriber {
  // Required by pg's Submittable contract — Client may call these
  // for various protocol messages. No-ops for our use case.
  handleDataRow: (msg: any) => void = () => {};
  handlePortalSuspended: () => void = () => {};
  handleCommandComplete: (msg: any) => void = () => {};
  handleEmptyQuery: () => void = () => {};

  // These are set in submit() to resolve/reject the promise.
  // pg's Client delegates readyForQuery and error to these methods
  // on the active query, so we must NOT also use connection.once()
  // for these events (that would fire the promise twice).
  handleReadyForQuery: () => void = () => {};
  handleRowDescription: (msg: any) => void = () => {};
  handleError: (err: Error) => void = () => {};

  private result: DescribeResult = { parameterOIDs: [], fields: [] };
  private connection: any = null;
  private listeners: Array<{ event: string; fn: (...args: any[]) => void }> = [];
  private resolve!: (result: DescribeResult) => void;
  private reject!: (err: Error) => void;
  readonly promise: Promise<DescribeResult>;

  constructor(private sql: string, private stmtName: string) {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  /**
   * Remove only our own connection listeners (not the Client's).
   * Using removeAllListeners would destroy the Client's persistent
   * handlers and break subsequent queries on the same pooled client.
   */
  private cleanup(): void {
    if (this.connection) {
      for (const { event, fn } of this.listeners) {
        this.connection.removeListener(event, fn);
      }
      this.listeners = [];
    }
  }

  private addListener(event: string, fn: (...args: any[]) => void): void {
    this.listeners.push({ event, fn });
    this.connection.once(event, fn);
  }

  /**
   * Called by pg Client with the underlying Connection object.
   * Send PARSE → DESCRIBE(Statement) → SYNC via the wire protocol.
   */
  submit(connection: any): void {
    this.connection = connection;

    // Register listeners for events NOT delegated by pg's Client.
    // parameterDescription and noData have no handle* counterpart,
    // so we must listen on the connection directly.
    this.addListener('parameterDescription', (msg: { dataTypeIDs: number[] }) => {
      this.result.parameterOIDs = msg.dataTypeIDs;
    });

    this.addListener('noData', () => {
      // Query returns no columns (e.g. INSERT without RETURNING)
      this.result.fields = [];
    });

    // rowDescription IS delegated by Client via handleRowDescription,
    // but we use connection.once() for consistency with the above.
    // Our handleRowDescription is a no-op so there's no double-fire.
    this.addListener('rowDescription', (msg: { fields: any[] }) => {
      this.result.fields = msg.fields.map((f: any) => ({
        name: f.name,
        tableID: f.tableID,
        columnID: f.columnID,
        dataTypeID: f.dataTypeID,
      }));
    });

    // Send wire protocol messages AFTER listeners are registered
    connection.parse({
      name: this.stmtName,
      text: this.sql,
      types: [],
    });
    connection.describe({
      type: 'S', // Statement (not Portal)
      name: this.stmtName,
    });
    connection.sync();

    // Use handle* methods for events delegated by pg's Client.
    // Client intercepts readyForQuery/error on the connection and
    // calls these on the active query — do NOT also connection.once()
    // these events or the promise resolves/rejects twice.
    this.handleReadyForQuery = () => {
      this.cleanup();
      this.resolve(this.result);
    };
    this.handleError = (err: Error) => {
      this.cleanup();
      this.reject(err);
    };
  }
}

export class PgAdapter implements DatabaseAdapter {
  private static stmtCounter = 0;
  private pool: pg.Pool;
  private connected = false;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async connect(): Promise<void> {
    await this.pool.query('SELECT 1');
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async executeSchema(sql: string): Promise<void> {
    if (!this.connected) throw new Error('Not connected');
    await this.pool.query(sql);
  }

  async describeQuery(sql: string): Promise<QueryTypeInfo> {
    if (!this.connected) throw new Error('Not connected');

    const stmtName = `_ts_sqlx_${++PgAdapter.stmtCounter}`;
    const client = await this.pool.connect();
    try {
      // Send PARSE + DESCRIBE via the Submittable interface.
      // This gets both parameter OIDs and column metadata (including
      // tableID/columnID) without executing the query.
      const describer = new QueryDescriber(sql, stmtName);
      client.query(describer);
      const desc = await describer.promise;

      // Map parameter OIDs to PgTypeInfo
      const params: PgTypeInfo[] = desc.parameterOIDs.map((oid) => {
        const typeName = oidToTypeName(oid);
        const isArr = isArrayOid(oid);
        return {
          oid,
          name: isArr ? arrayElementTypeName(typeName) : typeName,
          isArray: isArr,
        };
      });

      // Look up nullability from pg_attribute in a single batched query.
      // Fields with tableID/columnID reference real table columns;
      // fields without (computed expressions, aggregates) default to nullable.
      const tableColumns = desc.fields
        .filter((f) => f.tableID && f.columnID);

      const nullabilityMap = await buildNullabilityMap(
        (sql, params) => client.query(sql, params),
        tableColumns,
      );

      const columns: ColumnInfo[] = desc.fields.map((f) => {
        const isArr = isArrayOid(f.dataTypeID);
        const typeName = oidToTypeName(f.dataTypeID);
        const nullable = (f.tableID && f.columnID)
          ? nullabilityMap.get(`${f.tableID}:${f.columnID}`) ?? true
          : true;

        return {
          name: f.name,
          type: {
            oid: f.dataTypeID,
            name: isArr ? arrayElementTypeName(typeName) : typeName,
            isArray: isArr,
          },
          nullable,
        };
      });

      return { params, columns };
    } finally {
      // Clean up the prepared statement and release the client
      try {
        await client.query(`DEALLOCATE "${stmtName}"`);
      } catch {
        // Ignore — statement may not exist if PARSE failed
      }
      client.release();
    }
  }

  async getEnumValues(typeName: string): Promise<string[]> {
    if (!this.connected) throw new Error('Not connected');
    return queryEnumValues((sql, params) => this.pool.query(sql, params), typeName);
  }

  async getCompositeFields(typeName: string): Promise<CompositeField[]> {
    if (!this.connected) throw new Error('Not connected');
    return queryCompositeFields((sql, params) => this.pool.query(sql, params), typeName);
  }
}
