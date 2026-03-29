export interface TextRange {
    start: number;
    end: number;
}
export type DiagnosticCode = 'TS001' | 'TS002' | 'TS003' | 'TS004' | 'TS005' | 'TS006' | 'TS007' | 'TS008' | 'TS009' | 'TS010' | 'TS011';
export type DiagnosticSeverity = 'error' | 'warning' | 'info';
export interface Diagnostic {
    code: DiagnosticCode;
    severity: DiagnosticSeverity;
    message: string;
    range: TextRange;
}
export type QueryMethod = 'one' | 'oneOrNone' | 'many' | 'manyOrNone' | 'any' | 'none' | 'result' | 'query' | 'multi';
export type QueryLibrary = 'pg-promise' | 'node-postgres';
export interface QueryCallInfo {
    library: QueryLibrary;
    method: QueryMethod;
    sqlArgIndex: number;
    paramsArgIndex: number | undefined;
    sqlText: string | undefined;
    declaredResultType: string | undefined;
    paramsType: string | undefined;
    paramsText: string | undefined;
    position: TextRange;
}
export type ParamModifier = 'raw' | 'value' | 'name' | 'alias' | 'json' | 'csv' | 'list';
export interface ParamRef {
    position: TextRange;
    kind: 'indexed' | 'named';
    number: number;
    name?: string;
    path?: string[];
    modifier?: ParamModifier;
    shorthand?: '^' | '#' | '~';
}
export interface ParamError {
    position: TextRange;
    message: string;
}
export interface ExtractedParams {
    normalized: string;
    params: ParamRef[];
    errors: ParamError[];
}
export interface InferredQueryType {
    params: InferredParam[];
    columns: InferredColumn[];
}
export interface InferredParam {
    index: number;
    pgType: string;
    tsType: string;
    nullable: boolean;
}
export interface InferredColumn {
    name: string;
    pgType: string;
    tsType: string;
    nullable: boolean;
}
//# sourceMappingURL=types.d.ts.map