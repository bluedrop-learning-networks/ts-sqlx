import type { DatabaseAdapter, QueryTypeInfo, EnumTypeInfo } from './adapters/database/types.js';
import type { InferredQueryType, InferredParam, InferredColumn } from './types.js';
import type { TypeOverride } from './config.js';
import type { NullabilityHint } from './hintExtractor.js';
import { tsTypeFromPgType } from './adapters/database/oidMap.js';

export class DbInferrer {
  private enumMap: Map<string, EnumTypeInfo> = new Map();

  constructor(
    private adapter: DatabaseAdapter,
    private typeOverrides?: Map<string, TypeOverride>,
  ) {}

  async init(): Promise<void> {
    this.enumMap = await this.adapter.discoverEnums();
  }

  private resolveType(pgName: string, isArray: boolean): { tsType: string; importFrom?: string } {
    // 1. Manual overrides win
    const override = this.typeOverrides?.get(pgName);
    if (override) {
      const tsType = isArray ? `${override.tsType}[]` : override.tsType;
      return override.importFrom ? { tsType, importFrom: override.importFrom } : { tsType };
    }

    // 2. Check enum registry
    const enumInfo = this.enumMap.get(pgName);
    if (enumInfo) {
      const union = enumInfo.labels.map(l => `'${l.replace(/'/g, "\\'")}'`).join(' | ');
      return { tsType: isArray ? `(${union})[]` : union };
    }

    // 3. Built-in PG_TO_TS fallback
    const baseTsType = tsTypeFromPgType(pgName);
    return { tsType: isArray ? `${baseTsType}[]` : baseTsType };
  }

  async infer(
    sql: string,
    hints?: Map<string, NullabilityHint>,
  ): Promise<InferredQueryType> {
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
      const hint = hints?.get(c.name);
      const nullable =
        hint === 'nullable' ? true : hint === 'not-null' ? false : c.nullable;
      return {
        name: c.name,
        pgType: c.type.name,
        tsType: resolved.tsType,
        nullable,
        ...(resolved.importFrom ? { importFrom: resolved.importFrom } : {}),
      };
    });

    return { params, columns };
  }
}
