import { describe, it, expect, beforeAll } from 'vitest';
import { parseSql, ensureModuleLoaded } from '@ts-sqlx/core/sqlAnalyzer.js';

describe('parseSql', () => {
  beforeAll(async () => {
    await ensureModuleLoaded();
  });

  it('parses valid SELECT', () => {
    const result = parseSql('SELECT id, name FROM users WHERE id = $1');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('parses valid INSERT', () => {
    const result = parseSql('INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id');
    expect(result.valid).toBe(true);
  });

  it('reports syntax error for typo', () => {
    const result = parseSql('SELEC * FROM users');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.message).toBeTruthy();
  });

  it('reports error for invalid syntax', () => {
    const result = parseSql('SELECT * FROM users WHERE AND id = 1');
    expect(result.valid).toBe(false);
  });

  it('reports error for empty query', () => {
    const result = parseSql('');
    expect(result.valid).toBe(false);
  });

  it('reports error for whitespace-only query', () => {
    const result = parseSql('   ');
    expect(result.valid).toBe(false);
  });

  it('parses valid UPDATE', () => {
    const result = parseSql('UPDATE users SET name = $1 WHERE id = $2');
    expect(result.valid).toBe(true);
  });

  it('parses valid DELETE', () => {
    const result = parseSql('DELETE FROM users WHERE id = $1');
    expect(result.valid).toBe(true);
  });
});
