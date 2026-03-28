import { describe, it, expect } from 'vitest';
import { extractParams } from '@ts-sqlx/core/paramExtractor.js';

describe('extractParams', () => {
  describe('indexed parameters', () => {
    it('extracts $1, $2 style params', () => {
      const result = extractParams('SELECT * FROM users WHERE id = $1 AND name = $2');
      expect(result.normalized).toBe('SELECT * FROM users WHERE id = $1 AND name = $2');
      expect(result.params).toHaveLength(2);
      expect(result.params[0].kind).toBe('indexed');
      expect(result.params[0].number).toBe(1);
      expect(result.params[1].number).toBe(2);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('named parameters — curly braces', () => {
    it('extracts ${name} style params', () => {
      const result = extractParams('SELECT * FROM users WHERE name = ${name} AND email = ${email}');
      expect(result.normalized).toBe('SELECT * FROM users WHERE name = $1 AND email = $2');
      expect(result.params).toHaveLength(2);
      expect(result.params[0].kind).toBe('named');
      expect(result.params[0].name).toBe('name');
      expect(result.params[0].number).toBe(1);
      expect(result.params[1].name).toBe('email');
      expect(result.params[1].number).toBe(2);
    });

    it('reuses number for duplicate names', () => {
      const result = extractParams('SELECT * FROM users WHERE name = ${name} OR name LIKE ${name}');
      expect(result.normalized).toBe('SELECT * FROM users WHERE name = $1 OR name LIKE $1');
      expect(result.params).toHaveLength(2);
      expect(result.params[0].number).toBe(1);
      expect(result.params[1].number).toBe(1);
    });
  });

  describe('all bracket styles', () => {
    it('extracts $(name) style', () => {
      const result = extractParams('SELECT * FROM users WHERE name = $(name)');
      expect(result.params[0].name).toBe('name');
    });

    it('extracts $<name> style', () => {
      const result = extractParams('SELECT * FROM users WHERE name = $<name>');
      expect(result.params[0].name).toBe('name');
    });

    it('extracts $[name] style', () => {
      const result = extractParams('SELECT * FROM users WHERE name = $[name]');
      expect(result.params[0].name).toBe('name');
    });

    it('extracts $/name/ style', () => {
      const result = extractParams('SELECT * FROM users WHERE name = $/name/');
      expect(result.params[0].name).toBe('name');
    });
  });

  describe('modifiers', () => {
    it('extracts :raw modifier', () => {
      const result = extractParams('SELECT * FROM ${table:raw}');
      expect(result.params[0].modifier).toBe('raw');
      expect(result.params[0].name).toBe('table');
    });

    it('extracts ^ shorthand for :raw', () => {
      const result = extractParams('SELECT * FROM ${table^}');
      expect(result.params[0].modifier).toBe('raw');
      expect(result.params[0].shorthand).toBe('^');
    });

    it('extracts # shorthand for :value', () => {
      const result = extractParams('SELECT * FROM users WHERE id = ${id#}');
      expect(result.params[0].modifier).toBe('value');
      expect(result.params[0].shorthand).toBe('#');
    });

    it('extracts ~ shorthand for :name', () => {
      const result = extractParams('SELECT * FROM users ORDER BY ${col~}');
      expect(result.params[0].modifier).toBe('name');
      expect(result.params[0].shorthand).toBe('~');
    });

    it('extracts :json modifier', () => {
      const result = extractParams('INSERT INTO logs VALUES (${data:json})');
      expect(result.params[0].modifier).toBe('json');
    });

    it('extracts :csv modifier', () => {
      const result = extractParams('WHERE id IN (${ids:csv})');
      expect(result.params[0].modifier).toBe('csv');
    });

    it('extracts :list modifier (alias for csv)', () => {
      const result = extractParams('WHERE id IN (${ids:list})');
      expect(result.params[0].modifier).toBe('list');
    });

    it('extracts indexed params with modifiers', () => {
      const result = extractParams('SELECT * FROM $1:raw WHERE $2:name = $3');
      expect(result.params[0].modifier).toBe('raw');
      expect(result.params[1].modifier).toBe('name');
      expect(result.params[2].modifier).toBeUndefined();
    });
  });

  describe('nested properties', () => {
    it('extracts dotted path', () => {
      const result = extractParams('SELECT * FROM users WHERE city = ${profile.city}');
      expect(result.params[0].name).toBe('profile');
      expect(result.params[0].path).toEqual(['profile', 'city']);
    });

    it('extracts deep nesting', () => {
      const result = extractParams('WHERE city = ${profile.address.city}');
      expect(result.params[0].path).toEqual(['profile', 'address', 'city']);
    });
  });

  describe('this keyword', () => {
    it('extracts ${this}', () => {
      const result = extractParams('INSERT INTO logs VALUES (${this:json})');
      expect(result.params[0].name).toBe('this');
      expect(result.params[0].modifier).toBe('json');
    });
  });

  describe('errors', () => {
    it('reports unclosed bracket', () => {
      const result = extractParams('SELECT ${name FROM users');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toMatch(/unclosed/i);
    });

    it('reports empty parameter name', () => {
      const result = extractParams('SELECT * FROM users WHERE id = ${}');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toMatch(/empty/i);
    });
  });
});
