export interface PropertyInfo {
  name: string;
  type: string;
  optional: boolean;
}

export interface ArgumentInfo {
  position: number;
  type: string;
  text: string;
}

export interface CallExpressionInfo {
  receiverType: string;
  methodName: string;
  typeArguments: string[];
  arguments: ArgumentInfo[];
  position: { start: number; end: number };
}

export interface ResolvedImport {
  filePath: string;
  exportName: string;
  type: string;
}

export interface TypeScriptAdapter {
  loadProject(tsConfigPath: string): void;
  updateFile(filePath: string, content: string): void;
  getProjectFiles(): string[];
  getTypeText(filePath: string, position: number): string | undefined;
  resolveStringLiteral(filePath: string, position: number): string | undefined;
  getCallExpressions(filePath: string): CallExpressionInfo[];
  getTypeProperties(typeText: string, filePath: string): PropertyInfo[];
  followImport(filePath: string, importName: string): ResolvedImport | undefined;
}
