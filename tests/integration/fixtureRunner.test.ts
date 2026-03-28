import { describe, it, expect } from 'vitest';
import { parseFixtureExpectations } from '@ts-sqlx/test-utils/fixtureRunner.js';

describe('parseFixtureExpectations', () => {
  it('parses single @expect annotation', () => {
    const source = `
db.one("SELEC * FROM users");
// @expect TS001
`.trim();
    const expectations = parseFixtureExpectations(source);
    expect(expectations).toHaveLength(1);
    expect(expectations[0].code).toBe('TS001');
    expect(expectations[0].messageSubstring).toBeUndefined();
    expect(expectations[0].line).toBe(2);
  });

  it('parses @expect with message substring', () => {
    const source = `
db.one("SELECT * FROM nonexistent");
// @expect TS002 "nonexistent"
`.trim();
    const expectations = parseFixtureExpectations(source);
    expect(expectations).toHaveLength(1);
    expect(expectations[0].code).toBe('TS002');
    expect(expectations[0].messageSubstring).toBe('nonexistent');
  });

  it('parses multiple @expect on same line', () => {
    const source = `
db.one<{ wrong: number }>("SELECT id FROM missing_table");
// @expect TS002 @expect TS010
`.trim();
    const expectations = parseFixtureExpectations(source);
    expect(expectations).toHaveLength(2);
    expect(expectations[0].code).toBe('TS002');
    expect(expectations[1].code).toBe('TS010');
  });

  it('parses @expect-pass annotation', () => {
    const source = `
db.one<{ id: number }>("SELECT id FROM users WHERE id = $1", [1]);
// @expect-pass
`.trim();
    const expectations = parseFixtureExpectations(source);
    expect(expectations).toHaveLength(1);
    expect(expectations[0].pass).toBe(true);
  });

  it('ignores non-annotation comments', () => {
    const source = `
// This is a regular comment
db.one("SELECT 1");
// Another comment
`.trim();
    const expectations = parseFixtureExpectations(source);
    expect(expectations).toHaveLength(0);
  });

  it('associates annotation with the preceding code line', () => {
    const source = `
db.one("SELECT 1");
// @expect-pass

db.one("SELEC");
// @expect TS001
`.trim();
    const expectations = parseFixtureExpectations(source);
    expect(expectations).toHaveLength(2);
    expect(expectations[0].line).toBe(2);
    expect(expectations[1].line).toBe(5);
  });
});
