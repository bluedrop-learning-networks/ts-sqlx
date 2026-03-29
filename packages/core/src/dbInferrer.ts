import type { DatabaseAdapter, QueryTypeInfo } from './adapters/database/types.js';
import type { InferredQueryType, InferredParam, InferredColumn } from './types.js';
import type { TypeOverride } from './config.js';
import { tsTypeFromPgType } from './adapters/database/oidMap.js';

export class DbInferrer {
  constructor(
    private adapter: DatabaseAdapter,
    private typeOverrides?: Map<string, TypeOverride>,
  ) {}

  private resolveType(pgName: string, isArray: boolean): { tsType: string; importFrom?: string } {
    const override = this.typeOverrides?.get(pgName);
    if (override) {
      const tsType = isArray ? `${override.tsType}[]` : override.tsType;
      return override.importFrom ? { tsType, importFrom: override.importFrom } : { tsType };
    }
    const baseTsType = tsTypeFromPgType(pgName);
    return { tsType: isArray ? `${baseTsType}[]` : baseTsType };
  }

  async infer(sql: string): Promise<InferredQueryType> {
    const info: QueryTypeInfo = await this.adapter.describeQuery(sql);

    const params: InferredParam[] = info.params.map((p, i) => {
      const resolved = this.resolveType(p.name, p.isArray);
      return {
        index: i + 1,
        pgType: p.name,
        tsType: resolved.tsType,
        nullable: false,
        ...(resolved.importFrom ? { importFrom: resolved.importFrom } : {}),
      };
    });

    const columns: InferredColumn[] = info.columns.map((c) => {
      const resolved = this.resolveType(c.type.name, c.type.isArray);
      return {
        name: c.name,
        pgType: c.type.name,
        tsType: resolved.tsType,
        nullable: c.nullable,
        ...(resolved.importFrom ? { importFrom: resolved.importFrom } : {}),
      };
    });

    return { params, columns };
  }
}
