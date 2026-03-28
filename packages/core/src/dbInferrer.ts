import type { DatabaseAdapter, QueryTypeInfo } from './adapters/database/types.js';
import type { InferredQueryType, InferredParam, InferredColumn } from './types.js';
import { tsTypeFromPgType } from './adapters/database/oidMap.js';

export class DbInferrer {
  constructor(private adapter: DatabaseAdapter) {}

  async infer(sql: string): Promise<InferredQueryType> {
    const info: QueryTypeInfo = await this.adapter.describeQuery(sql);

    const params: InferredParam[] = info.params.map((p, i) => {
      const isArr = p.isArray;
      const baseTsType = tsTypeFromPgType(p.name);
      return {
        index: i + 1,
        pgType: p.name,
        tsType: isArr ? `${baseTsType}[]` : baseTsType,
        nullable: false,
      };
    });

    const columns: InferredColumn[] = info.columns.map((c) => {
      const isArr = c.type.isArray;
      const baseTsType = tsTypeFromPgType(c.type.name);
      return {
        name: c.name,
        pgType: c.type.name,
        tsType: isArr ? `${baseTsType}[]` : baseTsType,
        nullable: c.nullable,
      };
    });

    return { params, columns };
  }
}
