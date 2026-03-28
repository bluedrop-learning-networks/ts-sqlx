// Type stub for pg-promise database instance
interface IDatabase {
  one<T>(query: string, values?: any): Promise<T>;
  oneOrNone<T>(query: string, values?: any): Promise<T | null>;
  many<T>(query: string, values?: any): Promise<T[]>;
  manyOrNone<T>(query: string, values?: any): Promise<T[]>;
  any<T>(query: string, values?: any): Promise<T[]>;
  none(query: string, values?: any): Promise<null>;
  query<T>(query: string, values?: any): Promise<T[]>;
}

export declare const db: IDatabase;
