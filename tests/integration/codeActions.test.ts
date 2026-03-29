import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DiagnosticsEngine } from '@ts-sqlx/core/diagnostics.js';
import { generateTypeAnnotation } from '@ts-sqlx/core/typeComparator.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import { TsMorphAdapter } from '@ts-sqlx/core/adapters/typescript/tsMorphAdapter.js';
import type { InferredColumn } from '@ts-sqlx/core/types.js';
import { createAddTypeAnnotationAction, createUpdateTypeAnnotationAction } from '@ts-sqlx/language-server/codeActions.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Code action wiring', () => {
  let dbAdapter: PGLiteAdapter;
  let tsAdapter: TsMorphAdapter;
  let engine: DiagnosticsEngine;
  const fixturesDir = path.join(__dirname, '../fixtures');

  beforeAll(async () => {
    dbAdapter = await PGLiteAdapter.create();
    const schema = fs.readFileSync(path.join(fixturesDir, 'schema.sql'), 'utf8');
    await dbAdapter.executeSchema(schema);

    tsAdapter = new TsMorphAdapter();
    tsAdapter.loadProject(path.join(fixturesDir, 'tsconfig.json'));

    engine = new DiagnosticsEngine(dbAdapter, tsAdapter);
  });

  afterAll(async () => {
    await dbAdapter.disconnect();
  });

  describe('analyzeWithContext returns inferred columns for TS007 queries', () => {
    it('populates inferredColumns with correct column names, types, and nullability', async () => {
      const filePath = path.join(fixturesDir, 'diagnostics/ts007-no-type-annotation.ts');
      const result = await engine.analyzeWithContext(filePath);

      // Find queries that produced TS007 diagnostics
      const ts007Queries = result.queries.filter(q =>
        q.diagnostics.some(d => d.code === 'TS007')
      );
      expect(ts007Queries.length).toBeGreaterThanOrEqual(2);

      // The first TS007 query is: SELECT id, email FROM users WHERE id = $1
      const firstQuery = ts007Queries[0];
      expect(firstQuery.inferredColumns).toBeDefined();
      expect(firstQuery.inferredColumns!.length).toBe(2);

      const colNames = firstQuery.inferredColumns!.map(c => c.name);
      expect(colNames).toContain('id');
      expect(colNames).toContain('email');

      // Both columns should have string tsType (UUID and TEXT both map to string)
      const idCol = firstQuery.inferredColumns!.find(c => c.name === 'id')!;
      expect(idCol.tsType).toBe('string');
      expect(typeof idCol.nullable).toBe('boolean');

      const emailCol = firstQuery.inferredColumns!.find(c => c.name === 'email')!;
      expect(emailCol.tsType).toBe('string');
      expect(typeof emailCol.nullable).toBe('boolean');
    });

    it('insertTypePosition points to the opening parenthesis', async () => {
      const filePath = path.join(fixturesDir, 'diagnostics/ts007-no-type-annotation.ts');
      const fileText = fs.readFileSync(filePath, 'utf8');
      const result = await engine.analyzeWithContext(filePath);

      const ts007Queries = result.queries.filter(q =>
        q.diagnostics.some(d => d.code === 'TS007')
      );
      expect(ts007Queries.length).toBeGreaterThanOrEqual(2);

      for (const qa of ts007Queries) {
        const pos = qa.query.insertTypePosition;
        // The character at insertTypePosition should be '(' because
        // insertTypePosition is right after the method name, where the opening paren is
        expect(fileText[pos]).toBe('(');
      }
    });
  });

  describe('analyzeWithContext returns inferred columns for TS010 queries', () => {
    it('populates inferredColumns for mismatched type queries', async () => {
      const filePath = path.join(fixturesDir, 'diagnostics/ts010-declared-vs-inferred.ts');
      const result = await engine.analyzeWithContext(filePath);

      const ts010Queries = result.queries.filter(q =>
        q.diagnostics.some(d => d.code === 'TS010')
      );
      expect(ts010Queries.length).toBeGreaterThanOrEqual(1);

      for (const qa of ts010Queries) {
        expect(qa.inferredColumns).toBeDefined();
        expect(qa.inferredColumns!.length).toBeGreaterThan(0);
      }
    });

    it('typeArgumentRange covers the angle-bracket type arguments', async () => {
      const filePath = path.join(fixturesDir, 'diagnostics/ts010-declared-vs-inferred.ts');
      const fileText = fs.readFileSync(filePath, 'utf8');
      const result = await engine.analyzeWithContext(filePath);

      const ts010Queries = result.queries.filter(q =>
        q.diagnostics.some(d => d.code === 'TS010')
      );
      expect(ts010Queries.length).toBeGreaterThanOrEqual(1);

      for (const qa of ts010Queries) {
        expect(qa.query.typeArgumentRange).toBeDefined();
        const range = qa.query.typeArgumentRange!;
        const rangeText = fileText.slice(range.start, range.end);
        // The range should start with '<' and end with '>'
        expect(rangeText.startsWith('<')).toBe(true);
        expect(rangeText.endsWith('>')).toBe(true);
      }
    });
  });

  describe('TS010 code action uses inline type, not named interface', () => {
    it('generates an inline object type for queries with named type annotations', async () => {
      const filePath = path.join(fixturesDir, 'diagnostics/ts010-declared-vs-inferred.ts');
      const result = await engine.analyzeWithContext(filePath);

      const ts010Queries = result.queries.filter(q =>
        q.diagnostics.some(d => d.code === 'TS010')
      );
      expect(ts010Queries.length).toBeGreaterThanOrEqual(1);

      for (const qa of ts010Queries) {
        expect(qa.inferredColumns).toBeDefined();
        const { typeText: generatedType } = generateTypeAnnotation(qa.inferredColumns!);
        // Must be an inline object type, not a named reference
        expect(generatedType).toMatch(/^\{/);
      }
    });
  });

  describe('generateTypeAnnotation', () => {
    it('reflects nullability correctly', () => {
      const columns: InferredColumn[] = [
        { name: 'id', pgType: 'uuid', tsType: 'string', nullable: false },
        { name: 'name', pgType: 'text', tsType: 'string', nullable: true },
      ];
      const { typeText } = generateTypeAnnotation(columns);
      expect(typeText).toBe('{ id: string; name: string | null }');
    });

    it('handles all non-nullable columns', () => {
      const columns: InferredColumn[] = [
        { name: 'id', pgType: 'uuid', tsType: 'string', nullable: false },
        { name: 'email', pgType: 'text', tsType: 'string', nullable: false },
      ];
      const { typeText } = generateTypeAnnotation(columns);
      expect(typeText).toBe('{ id: string; email: string }');
    });

    it('handles multiple nullable columns', () => {
      const columns: InferredColumn[] = [
        { name: 'name', pgType: 'text', tsType: 'string', nullable: true },
        { name: 'age', pgType: 'int4', tsType: 'number', nullable: true },
      ];
      const { typeText } = generateTypeAnnotation(columns);
      expect(typeText).toBe('{ name: string | null; age: number | null }');
    });
  });

  describe('createAddTypeAnnotationAction', () => {
    it('produces correct action with title and edit', () => {
      const uri = 'file:///test.ts';
      const generatedType = '{ id: string; email: string }';
      const insertPosition = { line: 5, character: 10 };

      const action = createAddTypeAnnotationAction(uri, generatedType, insertPosition);

      expect(action.title).toBe('Add inferred type annotation');
      expect(action.kind).toBe('quickfix');
      expect(action.edit).toBeDefined();
      expect(action.edit!.changes).toBeDefined();
      expect(action.edit!.changes![uri]).toHaveLength(1);

      const textEdit = action.edit!.changes![uri][0];
      // Should insert at the specified position (zero-width range)
      expect(textEdit.range.start).toEqual(insertPosition);
      expect(textEdit.range.end).toEqual(insertPosition);
      // Should wrap the type in angle brackets
      expect(textEdit.newText).toBe('<{ id: string; email: string }>');
    });
  });

  describe('createUpdateTypeAnnotationAction', () => {
    it('produces correct action with title and edit', () => {
      const uri = 'file:///test.ts';
      const generatedType = '{ id: string; email: string }';
      const replaceRange = {
        start: { line: 5, character: 10 },
        end: { line: 5, character: 30 },
      };

      const action = createUpdateTypeAnnotationAction(uri, generatedType, replaceRange);

      expect(action.title).toBe('Update type annotation to match query');
      expect(action.kind).toBe('quickfix');
      expect(action.edit).toBeDefined();
      expect(action.edit!.changes).toBeDefined();
      expect(action.edit!.changes![uri]).toHaveLength(1);

      const textEdit = action.edit!.changes![uri][0];
      // Should replace the specified range
      expect(textEdit.range.start).toEqual(replaceRange.start);
      expect(textEdit.range.end).toEqual(replaceRange.end);
      // Should wrap the type in angle brackets
      expect(textEdit.newText).toBe('<{ id: string; email: string }>');
    });
  });

  describe('code actions with imports', () => {
    it('adds import text edits when imports are provided', () => {
      const action = createAddTypeAnnotationAction(
        'file:///test.ts',
        '{ created: Dayjs }',
        { line: 5, character: 10 },
        [{ typeName: 'Dayjs', moduleSpecifier: 'dayjs' }],
      );
      const edits = action.edit!.changes!['file:///test.ts'];
      expect(edits).toHaveLength(2);
      expect(edits[1].range.start.line).toBe(0);
      expect(edits[1].newText).toContain("import type { Dayjs } from 'dayjs'");
    });

    it('adds multiple import statements', () => {
      const action = createAddTypeAnnotationAction(
        'file:///test.ts',
        '{ created: Dayjs; amount: Decimal }',
        { line: 5, character: 10 },
        [
          { typeName: 'Dayjs', moduleSpecifier: 'dayjs' },
          { typeName: 'Decimal', moduleSpecifier: 'decimal.js' },
        ],
      );
      const edits = action.edit!.changes!['file:///test.ts'];
      expect(edits).toHaveLength(3);
    });

    it('creates no import edits when imports array is empty', () => {
      const action = createAddTypeAnnotationAction(
        'file:///test.ts',
        '{ id: number }',
        { line: 5, character: 10 },
        [],
      );
      const edits = action.edit!.changes!['file:///test.ts'];
      expect(edits).toHaveLength(1);
    });

    it('adds imports for update type annotation action', () => {
      const action = createUpdateTypeAnnotationAction(
        'file:///test.ts',
        '{ created: Dayjs }',
        { start: { line: 5, character: 10 }, end: { line: 5, character: 30 } },
        [{ typeName: 'Dayjs', moduleSpecifier: 'dayjs' }],
      );
      const edits = action.edit!.changes!['file:///test.ts'];
      expect(edits).toHaveLength(2);
    });
  });
});
