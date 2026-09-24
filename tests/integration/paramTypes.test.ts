import { describe, it, expect } from 'vitest';
import {
  formatParamType,
  isParamCompatible,
  paramTypeFromText,
  type ParamTypeMember,
} from '@bluedrop-learning-networks/ts-sqlx-core/paramTypes.js';
import type { InferredParam } from '@bluedrop-learning-networks/ts-sqlx-core/types.js';

const param = (pgType: string, tsType: string, extra: Partial<InferredParam> = {}): InferredParam => ({
  index: 1,
  pgType,
  tsType,
  nullable: false,
  isArray: false,
  ...extra,
});
const t = (text: string): ParamTypeMember => ({ kind: 'type', text });
const lit = (value: string): ParamTypeMember => ({ kind: 'string-literal', value });
const arr = (...element: ParamTypeMember[]): ParamTypeMember => ({ kind: 'array', element });

const int4 = param('int4', 'number');
const text = param('text', 'string');
const intArray = param('int4', 'number[]', { isArray: true });
const labels = ["it's", 'say "hi"', 'a|b'];
const quoteEnum = param('quote_enum', "'it\\'s' | 'say \"hi\"' | 'a|b'", { enumLabels: labels });
const quoteEnumArray = param('quote_enum', "('it\\'s' | 'say \"hi\"' | 'a|b')[]", {
  isArray: true,
  enumLabels: labels,
});

describe('isParamCompatible', () => {
  it('matches primitives', () => {
    expect(isParamCompatible([t('number')], int4)).toBe(true);
    expect(isParamCompatible([t('string')], int4)).toBe(false);
  });

  it('ignores null and undefined members', () => {
    expect(isParamCompatible([t('number'), t('null')], int4)).toBe(true);
    expect(isParamCompatible([t('number'), t('undefined')], int4)).toBe(true);
    expect(isParamCompatible([t('null')], int4)).toBe(true);
  });

  it('requires every other member to match', () => {
    expect(isParamCompatible([t('number'), t('string')], int4)).toBe(false);
  });

  it('accepts any', () => {
    expect(isParamCompatible([t('any')], int4)).toBe(true);
  });

  it('accepts a string literal for text, whatever it contains', () => {
    expect(isParamCompatible([lit('a|b')], text)).toBe(true);
    expect(isParamCompatible([lit('%foo | bar%')], text)).toBe(true);
  });

  it('matches enum labels by value, quotes and pipes included', () => {
    expect(isParamCompatible([lit("it's")], quoteEnum)).toBe(true);
    expect(isParamCompatible([lit('say "hi"')], quoteEnum)).toBe(true);
    expect(isParamCompatible([lit('a|b')], quoteEnum)).toBe(true);
    expect(isParamCompatible([lit("it's"), lit('a|b')], quoteEnum)).toBe(true);
  });

  it('rejects an unlisted literal or a plain string for an enum', () => {
    expect(isParamCompatible([lit('a')], quoteEnum)).toBe(false);
    expect(isParamCompatible([lit("IT'S")], quoteEnum)).toBe(false);
    expect(isParamCompatible([t('string')], quoteEnum)).toBe(false);
  });

  it('checks array elements, ignoring nulls inside', () => {
    expect(isParamCompatible([arr(t('number'))], intArray)).toBe(true);
    expect(isParamCompatible([arr(t('number'), t('null'))], intArray)).toBe(true);
    expect(isParamCompatible([arr(t('string'))], intArray)).toBe(false);
    expect(isParamCompatible([t('number')], intArray)).toBe(false);
    expect(isParamCompatible([arr(t('number'))], int4)).toBe(false);
  });

  it('checks enum array elements by label', () => {
    expect(isParamCompatible([arr(lit("it's"), lit('a|b'))], quoteEnumArray)).toBe(true);
    expect(isParamCompatible([arr(lit('nope'))], quoteEnumArray)).toBe(false);
  });

  it('accepts anything for json, jsonb and types ts-sqlx cannot map', () => {
    expect(isParamCompatible([t('string')], param('jsonb', 'unknown'))).toBe(true);
    expect(isParamCompatible([t('number')], param('json', 'unknown'))).toBe(true);
    expect(isParamCompatible([t('number')], param('address', 'unknown'))).toBe(true);
  });
});

describe('paramTypeFromText', () => {
  it('reads literals', () => {
    expect(paramTypeFromText('"a|b"')).toEqual([lit('a|b')]);
    expect(paramTypeFromText("'it\\'s'")).toEqual([lit("it's")]);
    expect(paramTypeFromText('-1.5')).toEqual([t('number')]);
    expect(paramTypeFromText('1e3')).toEqual([t('number')]);
    expect(paramTypeFromText('true')).toEqual([t('boolean')]);
  });
});

describe('formatParamType', () => {
  it('prints members as a TS type', () => {
    expect(formatParamType([t('number'), t('null')])).toBe('number | null');
    expect(formatParamType([lit('a|b')])).toBe('"a|b"');
    expect(formatParamType([arr(t('number'), t('null'))])).toBe('(number | null)[]');
  });
});
