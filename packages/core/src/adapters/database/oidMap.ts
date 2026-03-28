// Standard PostgreSQL OIDs
const OID_MAP: Record<number, string> = {
  16: 'bool',
  17: 'bytea',
  18: 'char',
  20: 'int8',
  21: 'int2',
  23: 'int4',
  25: 'text',
  26: 'oid',
  114: 'json',
  142: 'xml',
  600: 'point',
  700: 'float4',
  701: 'float8',
  790: 'money',
  829: 'macaddr',
  869: 'inet',
  650: 'cidr',
  1042: 'char',      // bpchar
  1043: 'varchar',
  1082: 'date',
  1083: 'time',
  1114: 'timestamp',
  1184: 'timestamptz',
  1186: 'interval',
  1266: 'timetz',
  1560: 'bit',
  1562: 'varbit',
  1700: 'numeric',
  2950: 'uuid',
  3614: 'tsvector',
  3615: 'tsquery',
  3802: 'jsonb',
  // Array types
  1000: '_bool',
  1001: '_bytea',
  1005: '_int2',
  1007: '_int4',
  1009: '_text',
  1016: '_int8',
  1021: '_float4',
  1022: '_float8',
  1115: '_timestamp',
  1182: '_date',
  1231: '_numeric',
  2951: '_uuid',
  199: '_json',
  3807: '_jsonb',
  1015: '_varchar',
};

export function oidToTypeName(oid: number): string {
  return OID_MAP[oid] ?? 'unknown';
}

export function isArrayOid(oid: number): boolean {
  const name = OID_MAP[oid];
  return name !== undefined && name.startsWith('_');
}

export function arrayElementTypeName(arrayTypeName: string): string {
  if (arrayTypeName.startsWith('_')) {
    return arrayTypeName.slice(1);
  }
  return arrayTypeName;
}

const PG_TO_TS: Record<string, string> = {
  int2: 'number',
  int4: 'number',
  int8: 'string',
  float4: 'number',
  float8: 'number',
  numeric: 'string',
  money: 'string',
  oid: 'number',
  text: 'string',
  varchar: 'string',
  char: 'string',
  xml: 'string',
  bool: 'boolean',
  date: 'Date',
  timestamp: 'Date',
  timestamptz: 'Date',
  time: 'string',
  timetz: 'string',
  interval: 'string',
  json: 'unknown',
  jsonb: 'unknown',
  bytea: 'Buffer',
  uuid: 'string',
  inet: 'string',
  cidr: 'string',
  macaddr: 'string',
  tsvector: 'string',
  tsquery: 'string',
  point: 'string',
  bit: 'string',
  varbit: 'string',
};

export function tsTypeFromPgType(pgType: string): string {
  return PG_TO_TS[pgType] ?? 'unknown';
}
