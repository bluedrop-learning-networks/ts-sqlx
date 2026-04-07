import type { InferredColumn } from './types.js';

export interface DeclaredProperty {
  name: string;
  type: string;
  optional: boolean;
}

export interface CompareResult {
  match: boolean;
  mismatches: string[];
}

export function compareTypes(
  inferred: InferredColumn[],
  declared: DeclaredProperty[],
): CompareResult {
  const mismatches: string[] = [];
  const inferredMap = new Map(inferred.map((c) => [c.name, c]));
  const declaredMap = new Map(declared.map((p) => [p.name, p]));

  for (const col of inferred) {
    if (!declaredMap.has(col.name)) {
      mismatches.push(`missing property '${col.name}' in declared type`);
    }
  }

  for (const prop of declared) {
    if (!inferredMap.has(prop.name)) {
      mismatches.push(`property '${prop.name}' not in query result`);
    }
  }

  for (const col of inferred) {
    const prop = declaredMap.get(col.name);
    if (!prop) continue;

    const expectedType = col.nullable ? `${col.tsType} | null` : col.tsType;

    if (!isTypeCompatible(expectedType, prop.type, col.nullable)) {
      if (col.nullable && !typeIncludesNull(prop.type)) {
        mismatches.push(
          `property '${col.name}' is nullable but declared as '${prop.type}' (expected '${expectedType}')`
        );
      } else {
        mismatches.push(
          `property '${col.name}': type mismatch — inferred '${expectedType}', declared '${prop.type}'`
        );
      }
    }
  }

  return { match: mismatches.length === 0, mismatches };
}

function isTypeCompatible(
  inferred: string,
  declared: string,
  nullable: boolean,
): boolean {
  const normalizedInferred = normalizeType(inferred);
  const normalizedDeclared = normalizeType(declared);

  if (normalizedInferred === normalizedDeclared) return true;

  if (nullable) {
    const inferredParts = normalizeType(inferred.replace(/\| null/g, '').trim());
    const declaredParts = normalizeType(declared.replace(/\| null/g, '').trim());
    const declaredHasNull = typeIncludesNull(declared);
    return inferredParts === declaredParts && declaredHasNull;
  }

  return false;
}

function typeIncludesNull(typeStr: string): boolean {
  return typeStr.split('|').some((part) => part.trim() === 'null');
}

function normalizeType(t: string): string {
  return t
    .split('|')
    .map((s) => s.trim().replace(/^"(.*)"$/, "'$1'"))
    .sort()
    .join(' | ');
}

export interface TypeImport {
  typeName: string;
  moduleSpecifier: string;
}

export interface GeneratedAnnotation {
  typeText: string;
  imports: TypeImport[];
}

export function generateTypeAnnotation(columns: InferredColumn[]): GeneratedAnnotation {
  const props = columns.map((col) => {
    const type = col.nullable ? `${col.tsType} | null` : col.tsType;
    return `${col.name}: ${type}`;
  });
  const typeText = `{ ${props.join('; ')} }`;

  const seen = new Set<string>();
  const imports: TypeImport[] = [];
  for (const col of columns) {
    if (col.importFrom) {
      const key = `${col.importFrom}:${col.tsType}`;
      if (!seen.has(key)) {
        seen.add(key);
        imports.push({ typeName: col.tsType, moduleSpecifier: col.importFrom });
      }
    }
  }

  return { typeText, imports };
}
