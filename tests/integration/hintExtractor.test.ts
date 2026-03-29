import { describe, it, expect } from 'vitest';
import { extractNullabilityHints } from '@ts-sqlx/core';

describe('extractNullabilityHints', () => {
  it('returns empty hints and unchanged SQL when no comment present', () => {
    const sql = 'SELECT id, name FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.cleanedSql).toBe(sql);
    expect(result.hints.size).toBe(0);
  });

  it('extracts @not-null hints', () => {
    const sql = '/* @not-null bar */ SELECT foo AS bar FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.hints.get('bar')).toBe('not-null');
    expect(result.cleanedSql).toBe('SELECT foo AS bar FROM users');
  });

  it('extracts @nullable hints', () => {
    const sql = '/* @nullable bar */ SELECT foo AS bar FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.hints.get('bar')).toBe('nullable');
    expect(result.cleanedSql).toBe('SELECT foo AS bar FROM users');
  });

  it('extracts multiple column names per annotation', () => {
    const sql = '/* @not-null bar, baz */ SELECT foo AS bar, qux AS baz FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.hints.get('bar')).toBe('not-null');
    expect(result.hints.get('baz')).toBe('not-null');
  });

  it('handles both @nullable and @not-null in same comment', () => {
    const sql = '/* @nullable a @not-null b */ SELECT x AS a, y AS b FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.hints.get('a')).toBe('nullable');
    expect(result.hints.get('b')).toBe('not-null');
  });

  it('trims leading/trailing whitespace from cleaned SQL', () => {
    const sql = '  /* @not-null bar */  SELECT foo AS bar FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.cleanedSql).toBe('SELECT foo AS bar FROM users');
  });

  it('ignores block comments that are not leading', () => {
    const sql = 'SELECT foo /* @not-null bar */ AS bar FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.hints.size).toBe(0);
    expect(result.cleanedSql).toBe(sql);
  });

  it('ignores comments without hint annotations', () => {
    const sql = '/* just a regular comment */ SELECT id FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.hints.size).toBe(0);
    expect(result.cleanedSql).toBe(sql);
  });

  it('handles multiline hint comments', () => {
    const sql = `/*
  @not-null id, email
  @nullable name
*/ SELECT id, email, name FROM users`;
    const result = extractNullabilityHints(sql);
    expect(result.hints.get('id')).toBe('not-null');
    expect(result.hints.get('email')).toBe('not-null');
    expect(result.hints.get('name')).toBe('nullable');
    expect(result.cleanedSql).toBe('SELECT id, email, name FROM users');
  });

  it('lowercases column names to match PG identifier folding', () => {
    const sql = '/* @not-null Name, EMAIL */ SELECT name, email FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.hints.get('name')).toBe('not-null');
    expect(result.hints.get('email')).toBe('not-null');
    expect(result.hints.has('Name')).toBe(false);
  });

  it('handles extra whitespace and newlines in column lists', () => {
    const sql = '/* @not-null   bar ,  baz  */ SELECT foo AS bar, qux AS baz FROM t';
    const result = extractNullabilityHints(sql);
    expect(result.hints.get('bar')).toBe('not-null');
    expect(result.hints.get('baz')).toBe('not-null');
  });

  it('handles empty SQL', () => {
    const result = extractNullabilityHints('');
    expect(result.cleanedSql).toBe('');
    expect(result.hints.size).toBe(0);
  });

  it('last annotation wins when column appears in both @nullable and @not-null', () => {
    const sql = '/* @nullable x @not-null x */ SELECT 1 AS x';
    const result = extractNullabilityHints(sql);
    expect(result.hints.get('x')).toBe('not-null');
    expect(result.cleanedSql).toBe('SELECT 1 AS x');
  });

  it('preserves non-hint leading comment (passes through to database)', () => {
    const sql = '/* TODO: optimize */ SELECT id FROM users';
    const result = extractNullabilityHints(sql);
    expect(result.cleanedSql).toBe(sql);
  });

  it('rejects column names with invalid identifiers', () => {
    const sql = '/* @not-null 123abc, foo$bar, _valid */ SELECT 1 AS _valid';
    const result = extractNullabilityHints(sql);
    expect(result.hints.has('123abc')).toBe(false);
    expect(result.hints.has('foo$bar')).toBe(false);
    expect(result.hints.get('_valid')).toBe('not-null');
  });
});
