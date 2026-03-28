import { describe, it, expect } from 'vitest';
import { extractParams } from '@ts-sqlx/core/paramExtractor.js';

describe('pgp-params fixture coverage', () => {
  describe('bracket styles', () => {
    it('curly braces: ${name}', () => {
      const r = extractParams('SELECT * FROM users WHERE name = ${name}');
      expect(r.params[0].name).toBe('name');
      expect(r.normalized).toContain('$1');
    });

    it('parentheses: $(name)', () => {
      const r = extractParams('SELECT * FROM users WHERE name = $(name)');
      expect(r.params[0].name).toBe('name');
    });

    it('angle brackets: $<name>', () => {
      const r = extractParams('SELECT * FROM users WHERE name = $<name>');
      expect(r.params[0].name).toBe('name');
    });

    it('square brackets: $[name]', () => {
      const r = extractParams('SELECT * FROM users WHERE name = $[name]');
      expect(r.params[0].name).toBe('name');
    });

    it('slashes: $/name/', () => {
      const r = extractParams('SELECT * FROM users WHERE name = $/name/');
      expect(r.params[0].name).toBe('name');
    });

    it('mixed styles in same query', () => {
      const r = extractParams('SELECT * FROM users WHERE name = ${name} AND id = $(id) AND email = $<email>');
      expect(r.params).toHaveLength(3);
      expect(r.params[0].name).toBe('name');
      expect(r.params[1].name).toBe('id');
      expect(r.params[2].name).toBe('email');
    });
  });

  describe('modifiers', () => {
    it(':raw modifier', () => {
      const r = extractParams('SELECT * FROM ${table:raw}');
      expect(r.params[0].modifier).toBe('raw');
    });

    it('^ shorthand', () => {
      const r = extractParams('SELECT * FROM $<table^>');
      expect(r.params[0].modifier).toBe('raw');
      expect(r.params[0].shorthand).toBe('^');
    });

    it(':json modifier', () => {
      const r = extractParams('INSERT INTO logs VALUES (${data:json})');
      expect(r.params[0].modifier).toBe('json');
    });

    it(':csv modifier', () => {
      const r = extractParams('WHERE id IN (${ids:csv})');
      expect(r.params[0].modifier).toBe('csv');
    });
  });

  describe('advanced features', () => {
    it('nested properties', () => {
      const r = extractParams('WHERE name = ${profile.name} AND city = ${profile.address.city}');
      expect(r.params[0].path).toEqual(['profile', 'name']);
      expect(r.params[1].path).toEqual(['profile', 'address', 'city']);
    });

    it('this keyword', () => {
      const r = extractParams('INSERT INTO logs VALUES (${this:json})');
      expect(r.params[0].name).toBe('this');
      expect(r.params[0].modifier).toBe('json');
    });

    it('indexed with modifiers', () => {
      const r = extractParams('SELECT * FROM $1:raw WHERE $2~ = $3');
      expect(r.params[0].modifier).toBe('raw');
      expect(r.params[1].modifier).toBe('name');
      expect(r.params[2].modifier).toBeUndefined();
    });
  });
});
