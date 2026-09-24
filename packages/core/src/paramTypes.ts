import type { InferredParam } from './types.js';

/**
 * One member of the TS type passed for a query param, resolved through the type checker
 * rather than read from printed type text. Literal types are widened to their primitive,
 * except string literals, which keep their value so they can be matched against enum labels.
 */
export type ParamTypeMember =
  | { kind: 'string-literal'; value: string }
  | { kind: 'array'; element: ParamTypeMember[] }
  | { kind: 'type'; text: string };

const JSON_TYPES = new Set(['json', 'jsonb']);

export function formatParamType(members: ParamTypeMember[]): string {
  return members
    .map((m) =>
      m.kind === 'string-literal'
        ? JSON.stringify(m.value)
        : m.kind === 'array'
          ? m.element.length === 1
            ? `${formatParamType(m.element)}[]`
            : `(${formatParamType(m.element)})[]`
          : m.text,
    )
    .join(' | ');
}

/** Reads a type written as text (tuple types, literal inference) into members. */
export function paramTypeFromText(text: string): ParamTypeMember[] {
  const trimmed = text.trim();
  if (/^"(?:[^"\\]|\\.)*"$/.test(trimmed)) {
    return [{ kind: 'string-literal', value: JSON.parse(trimmed) as string }];
  }
  if (/^'(?:[^'\\]|\\.)*'$/.test(trimmed)) {
    return [{ kind: 'string-literal', value: trimmed.slice(1, -1).replace(/\\(.)/g, '$1') }];
  }
  if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(trimmed)) return [{ kind: 'type', text: 'number' }];
  if (trimmed === 'true' || trimmed === 'false') return [{ kind: 'type', text: 'boolean' }];
  return [{ kind: 'type', text: trimmed }];
}

function isNullish(member: ParamTypeMember): boolean {
  return member.kind === 'type' && (member.text === 'null' || member.text === 'undefined');
}

function elementParam(param: InferredParam): InferredParam {
  return {
    ...param,
    isArray: false,
    tsType: param.enumLabels ? param.tsType : param.tsType.replace(/\[\]$/, ''),
  };
}

function isMemberCompatible(member: ParamTypeMember, param: InferredParam): boolean {
  if (member.kind === 'type' && member.text === 'any') return true;

  if (param.isArray) {
    return member.kind === 'array' && isParamCompatible(member.element, elementParam(param));
  }
  if (member.kind === 'array') return false;

  if (param.enumLabels) {
    return member.kind === 'string-literal' && param.enumLabels.includes(member.value);
  }
  if (member.kind === 'string-literal') return param.tsType === 'string';

  return member.text.toLowerCase() === param.tsType.toLowerCase();
}

/**
 * Whether a param of the given TS type can be sent where the SQL expects `param`.
 * Any param may be NULL, and pg-promise and node-postgres send undefined as NULL, so only the
 * other members have to match. json/jsonb takes any value, and so does a SQL type ts-sqlx
 * cannot map (it infers `unknown`), since it cannot say what that type accepts.
 */
export function isParamCompatible(members: ParamTypeMember[], param: InferredParam): boolean {
  if (!param.isArray && (JSON_TYPES.has(param.pgType) || param.tsType === 'unknown')) return true;
  return members.filter((m) => !isNullish(m)).every((m) => isMemberCompatible(m, param));
}
