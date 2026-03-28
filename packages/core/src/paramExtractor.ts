import type { ExtractedParams, ParamRef, ParamError, ParamModifier } from './types.js';

const BRACKET_PAIRS: Record<string, string> = {
  '{': '}',
  '(': ')',
  '<': '>',
  '[': ']',
  '/': '/',
};

const MODIFIER_MAP: Record<string, ParamModifier> = {
  raw: 'raw',
  value: 'value',
  name: 'name',
  alias: 'alias',
  json: 'json',
  csv: 'csv',
  list: 'list',
};

const SHORTHAND_MAP: Record<string, ParamModifier> = {
  '^': 'raw',
  '#': 'value',
  '~': 'name',
};

export function extractParams(sql: string): ExtractedParams {
  const params: ParamRef[] = [];
  const errors: ParamError[] = [];
  const nameToNumber = new Map<string, number>();
  let nextNumber = 1;
  let normalized = '';
  let i = 0;

  while (i < sql.length) {
    if (sql[i] !== '$') {
      normalized += sql[i];
      i++;
      continue;
    }

    const dollarPos = i;
    i++; // skip $

    if (i >= sql.length) {
      normalized += '$';
      break;
    }

    // Indexed parameter: $N
    if (sql[i] >= '1' && sql[i] <= '9') {
      let numStr = '';
      while (i < sql.length && sql[i] >= '0' && sql[i] <= '9') {
        numStr += sql[i];
        i++;
      }
      const num = parseInt(numStr, 10);

      let modifier: ParamModifier | undefined;
      let shorthand: '^' | '#' | '~' | undefined;
      const modResult = parseModifier(sql, i);
      if (modResult) {
        modifier = modResult.modifier;
        shorthand = modResult.shorthand;
        i = modResult.end;
      }

      params.push({
        position: { start: dollarPos, end: i },
        kind: 'indexed',
        number: num,
        modifier,
        shorthand,
      });

      if (num >= nextNumber) nextNumber = num + 1;
      normalized += `$${num}`;
      continue;
    }

    // Named parameter: ${name}, $(name), $<name>, $[name], $/name/
    const openChar = sql[i];
    const closeChar = BRACKET_PAIRS[openChar];
    if (closeChar) {
      i++; // skip open bracket
      const nameStart = i;

      const closeIdx = sql.indexOf(closeChar, i);
      if (closeIdx === -1) {
        errors.push({
          position: { start: dollarPos, end: sql.length },
          message: `Unclosed bracket '${openChar}' in parameter`,
        });
        normalized += sql.slice(dollarPos);
        i = sql.length;
        continue;
      }

      const content = sql.slice(nameStart, closeIdx);
      i = closeIdx + 1;

      if (content.length === 0) {
        errors.push({
          position: { start: dollarPos, end: i },
          message: 'Empty parameter name',
        });
        normalized += sql.slice(dollarPos, i);
        continue;
      }

      let name: string;
      let modifier: ParamModifier | undefined;
      let shorthand: '^' | '#' | '~' | undefined;
      let path: string[] | undefined;

      const lastChar = content[content.length - 1];
      if (SHORTHAND_MAP[lastChar]) {
        shorthand = lastChar as '^' | '#' | '~';
        modifier = SHORTHAND_MAP[lastChar];
        name = content.slice(0, -1);
      } else if (content.includes(':')) {
        const colonIdx = content.indexOf(':');
        name = content.slice(0, colonIdx);
        const modName = content.slice(colonIdx + 1);
        modifier = MODIFIER_MAP[modName];
      } else {
        name = content;
      }

      if (name.includes('.')) {
        path = name.split('.');
        name = path[0];
      }

      let number: number;
      const lookupKey = path ? path.join('.') : name;
      if (nameToNumber.has(lookupKey)) {
        number = nameToNumber.get(lookupKey)!;
      } else {
        number = nextNumber++;
        nameToNumber.set(lookupKey, number);
      }

      params.push({
        position: { start: dollarPos, end: i },
        kind: 'named',
        number,
        name,
        path,
        modifier,
        shorthand,
      });

      normalized += `$${number}`;
      continue;
    }

    // Not a recognized pattern
    normalized += '$';
  }

  return { normalized, params, errors };
}

function parseModifier(
  sql: string,
  pos: number
): { modifier: ParamModifier; shorthand?: '^' | '#' | '~'; end: number } | undefined {
  if (pos >= sql.length) return undefined;

  const ch = sql[pos];
  if (SHORTHAND_MAP[ch]) {
    return {
      modifier: SHORTHAND_MAP[ch],
      shorthand: ch as '^' | '#' | '~',
      end: pos + 1,
    };
  }

  if (ch === ':') {
    const rest = sql.slice(pos + 1);
    for (const [key, mod] of Object.entries(MODIFIER_MAP)) {
      if (rest.startsWith(key)) {
        const afterMod = pos + 1 + key.length;
        if (afterMod >= sql.length || !/\w/.test(sql[afterMod])) {
          return { modifier: mod, end: afterMod };
        }
      }
    }
  }

  return undefined;
}
