export interface PgTypeInfo {
  oid: number;
  name: string;
  isArray: boolean;
}

export interface ColumnInfo {
  name: string;
  type: PgTypeInfo;
  nullable: boolean;
}

export interface QueryTypeInfo {
  params: PgTypeInfo[];
  columns: ColumnInfo[];
}

export interface CompositeField {
  name: string;
  type: PgTypeInfo;
}

export interface EnumTypeInfo {
  oid: number;
  arrayOid: number;
  name: string;
  schema: string;
  labels: string[];
}

export interface DatabaseAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  executeSchema(sql: string): Promise<void>;
  describeQuery(sql: string): Promise<QueryTypeInfo>;
  getEnumValues(typeName: string): Promise<string[]>;
  getCompositeFields(typeName: string): Promise<CompositeField[]>;
  discoverEnums(): Promise<Map<string, EnumTypeInfo>>;
}
