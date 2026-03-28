---
id: ts-z5bl
status: closed
deps: [ts-cffs]
links: []
created: 2026-03-28T14:47:07Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [core, params]
---
# Task 8: Param Extractor

Implement the pg-promise parameter extractor supporting all bracket styles, modifiers, shorthands, nested properties, and error reporting.

### Task 8: Param Extractor

**Files:**
- Create: `packages/core/src/paramExtractor.ts`
- Create: `tests/integration/paramExtractor.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/paramExtractor.test.ts
import { describe, it, expect } from 'vitest';
import { extractParams } from '@ts-sqlx/core/src/paramExtractor.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/paramExtractor.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement param extractor**

```typescript
// packages/core/src/paramExtractor.ts
import type { ExtractedParams, ParamRef, ParamError, ParamModifier, TextRange } from './types.js';

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

    // Check for indexed parameter: $N
    if (sql[i] >= '1' && sql[i] <= '9') {
      let numStr = '';
      while (i < sql.length && sql[i] >= '0' && sql[i] <= '9') {
        numStr += sql[i];
        i++;
      }
      const num = parseInt(numStr, 10);

      // Check for modifier on indexed param: $1:raw or $1^
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

      // Keep next number in sync
      if (num >= nextNumber) nextNumber = num + 1;
      normalized += `$${num}`;
      continue;
    }

    // Check for named parameter: ${name}, $(name), $<name>, $[name], $/name/
    const openChar = sql[i];
    const closeChar = BRACKET_PAIRS[openChar];
    if (closeChar) {
      i++; // skip open bracket
      const nameStart = i;

      // Find close bracket
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
      i = closeIdx + 1; // skip close bracket

      if (content.length === 0) {
        errors.push({
          position: { start: dollarPos, end: i },
          message: 'Empty parameter name',
        });
        normalized += sql.slice(dollarPos, i);
        continue;
      }

      // Parse name, modifier, and shorthand from content
      let name: string;
      let modifier: ParamModifier | undefined;
      let shorthand: '^' | '#' | '~' | undefined;
      let path: string[] | undefined;

      // Check for shorthand at end: ${name^}, ${name#}, ${name~}
      const lastChar = content[content.length - 1];
      if (SHORTHAND_MAP[lastChar]) {
        shorthand = lastChar as '^' | '#' | '~';
        modifier = SHORTHAND_MAP[lastChar];
        name = content.slice(0, -1);
      } else if (content.includes(':')) {
        // Check for modifier: ${name:raw}
        const colonIdx = content.indexOf(':');
        name = content.slice(0, colonIdx);
        const modName = content.slice(colonIdx + 1);
        modifier = MODIFIER_MAP[modName];
      } else {
        name = content;
      }

      // Check for nested properties
      if (name.includes('.')) {
        path = name.split('.');
        name = path[0];
      }

      // Assign/reuse number
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

    // Not a recognized parameter pattern — keep as-is
    normalized += '$';
    // Don't advance i — we already incremented past $
  }

  return { normalized, params, errors };
}

function parseModifier(
  sql: string,
  pos: number
): { modifier: ParamModifier; shorthand?: '^' | '#' | '~'; end: number } | undefined {
  if (pos >= sql.length) return undefined;

  // Shorthand: $1^, $1#, $1~
  const ch = sql[pos];
  if (SHORTHAND_MAP[ch]) {
    return {
      modifier: SHORTHAND_MAP[ch],
      shorthand: ch as '^' | '#' | '~',
      end: pos + 1,
    };
  }

  // Long form: $1:raw, $1:name, etc.
  if (ch === ':') {
    const rest = sql.slice(pos + 1);
    for (const [key, mod] of Object.entries(MODIFIER_MAP)) {
      if (rest.startsWith(key)) {
        // Make sure the modifier isn't followed by a word char
        const afterMod = pos + 1 + key.length;
        if (afterMod >= sql.length || !/\w/.test(sql[afterMod])) {
          return { modifier: mod, end: afterMod };
        }
      }
    }
  }

  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/paramExtractor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/paramExtractor.ts tests/integration/paramExtractor.test.ts
git commit -m "feat: add pg-promise parameter extractor with all bracket styles and modifiers"
```

## Design

Chunk 2: Param Extractor + SQL Analyzer. Normalizes pg-promise named params to $N before libpg-query parsing.

## Acceptance Criteria

extractParams handles all 5 bracket styles, modifiers (:raw/^, :value/#, :name/~, :json, :csv, :list), nested properties, this keyword, indexed params with modifiers; duplicate names reuse numbers; errors for unclosed brackets and empty names; tests pass; commit created

