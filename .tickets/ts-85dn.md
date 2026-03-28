---
id: ts-85dn
status: closed
deps: [ts-z5bl]
links: []
created: 2026-03-28T14:48:31Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [testing, integration]
---
# Task 23: PGP Params Fixture Tests

PGP Params Fixture Tests - Integration tests for pg-promise parameter syntax including bracket styles, modifiers, and advanced features.

### Task 23: PGP Params Fixture Tests

**Files:**
- Create: `tests/integration/pgpParams.test.ts`

- [ ] **Step 1: Write param extraction tests from fixtures**

```typescript
// tests/integration/pgpParams.test.ts
import { describe, it, expect } from 'vitest';
import { extractParams } from '@ts-sqlx/core/src/paramExtractor.js';

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
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run tests/integration/pgpParams.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/pgpParams.test.ts
git commit -m "test: add pg-promise parameter syntax integration tests"
```

## Design

Integration tests for pg-promise parameter syntax coverage.

## Acceptance Criteria

Tests verify all 5 bracket styles, mixed styles, :raw/^, :json, :csv modifiers, nested properties, this keyword, indexed with modifiers; all pass; commit created

