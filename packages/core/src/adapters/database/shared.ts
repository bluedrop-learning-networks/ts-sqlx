import type { CompositeField, EnumTypeInfo } from './types.js';
import { oidToTypeName, isArrayOid } from './oidMap.js';

/**
 * Generic query function signature shared by pg and PGLite adapters.
 */
type QueryFn = <T extends Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<{ rows: T[] }>;

export async function queryEnumValues(
  queryFn: QueryFn,
  typeName: string,
): Promise<string[]> {
  const result = await queryFn<{ enumlabel: string }>(
    `SELECT enumlabel FROM pg_enum
     JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
     WHERE pg_type.typname = $1
     ORDER BY pg_enum.enumsortorder`,
    [typeName],
  );
  return result.rows.map((r) => r.enumlabel);
}

export async function queryCompositeFields(
  queryFn: QueryFn,
  typeName: string,
): Promise<CompositeField[]> {
  const result = await queryFn<{ attname: string; atttypid: number }>(
    `SELECT a.attname, a.atttypid
     FROM pg_attribute a
     JOIN pg_type t ON a.attrelid = t.typrelid
     WHERE t.typname = $1 AND a.attnum > 0
     ORDER BY a.attnum`,
    [typeName],
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

export async function buildNullabilityMap(
  queryFn: QueryFn,
  tableColumns: Array<{ tableID: number; columnID: number }>,
): Promise<Map<string, boolean>> {
  const nullabilityMap = new Map<string, boolean>();
  if (tableColumns.length > 0) {
    const valuesList = tableColumns
      .map((tc) => `(${tc.tableID}, ${tc.columnID})`)
      .join(', ');
    const nullResult = await queryFn<{
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
  return nullabilityMap;
}

export async function queryEnumTypes(
  queryFn: QueryFn,
): Promise<Map<string, EnumTypeInfo>> {
  const result = await queryFn<{
    oid: number;
    typname: string;
    typarray: number;
    nspname: string;
    labels: string[];
  }>(
    `SELECT t.oid, t.typname, t.typarray, n.nspname,
            array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
     FROM pg_type t
     JOIN pg_enum e ON e.enumtypid = t.oid
     JOIN pg_namespace n ON t.typnamespace = n.oid
     GROUP BY t.oid, t.typname, t.typarray, n.nspname`,
  );

  const map = new Map<string, EnumTypeInfo>();
  for (const row of result.rows) {
    map.set(row.typname, {
      oid: row.oid,
      arrayOid: row.typarray,
      name: row.typname,
      schema: row.nspname,
      labels: row.labels,
    });
  }
  return map;
}
