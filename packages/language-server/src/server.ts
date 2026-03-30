import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
  DiagnosticSeverity as LSPSeverity,
  type Diagnostic as LSPDiagnostic,
  type CodeAction,
  CodeActionKind,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DiagnosticsEngine } from '@ts-sqlx/core/diagnostics.js';
import { createDatabaseAdapter } from '@ts-sqlx/core/adapters/database/adapterFactory.js';
import { TsMorphAdapter } from '@ts-sqlx/core/adapters/typescript/tsMorphAdapter.js';
import { resolveConfig, parseTypeOverrides } from '@ts-sqlx/core/config.js';
import { perf } from '@ts-sqlx/core/perf.js';
import { generateTypeAnnotation } from '@ts-sqlx/core';
import type { Diagnostic, DiagnosticSeverity, AnalysisResult } from '@ts-sqlx/core/types.js';
import { createAddTypeAnnotationAction, createUpdateTypeAnnotationAction } from './codeActions.js';
import * as fs from 'fs';
import * as path from 'path';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let engine: DiagnosticsEngine | null = null;
let tsAdapter: TsMorphAdapter | null = null;
const analysisResults = new Map<string, AnalysisResult>();

connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
  const rootUri = params.rootUri;
  if (rootUri) {
    const rootPath = new URL(rootUri).pathname;
    const { config, configDir } = resolveConfig(rootPath);

    tsAdapter = new TsMorphAdapter();
    const tsConfigPath = path.join(rootPath, 'tsconfig.json');
    if (fs.existsSync(tsConfigPath)) {
      tsAdapter.loadProject(tsConfigPath);
    }

    let dbAdapter = null;
    try {
      dbAdapter = await createDatabaseAdapter(config);
      if (dbAdapter && config.database.pglite && config.database.schema) {
        const schemaPath = path.resolve(configDir, config.database.schema);
        if (fs.existsSync(schemaPath)) {
          await dbAdapter.executeSchema(fs.readFileSync(schemaPath, 'utf8'));
        }
      }
    } catch (e) {
      connection.console.error(`Failed to initialize database adapter: ${(e as Error).message}`);
    }

    const typeOverrides = parseTypeOverrides(config.types);
    engine = new DiagnosticsEngine(dbAdapter, tsAdapter, typeOverrides);
  }

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix],
      },
    },
  };
});

documents.onDidChangeContent(async (change) => {
  if (!engine) return;

  const uri = change.document.uri;
  const filePath = new URL(uri).pathname;

  if (!filePath.endsWith('.ts')) return;

  try {
    const text = change.document.getText();
    if (tsAdapter) {
      perf.withTiming('updateFile', () => tsAdapter!.updateFile(filePath, text));
    }
    const result = await engine.analyzeWithContext(filePath);
    analysisResults.set(uri, result);
    connection.sendDiagnostics({
      uri,
      diagnostics: result.diagnostics.map(d => toLspDiagnostic(d, text)),
    });
  } catch {
    // Silently ignore analysis errors
  }
});

function offsetToPosition(text: string, offset: number): { line: number; character: number } {
  let line = 0;
  let lastNewline = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      lastNewline = i;
    }
  }
  return { line, character: offset - lastNewline - 1 };
}

function toLspDiagnostic(d: Diagnostic, documentText: string): LSPDiagnostic {
  return {
    range: {
      start: offsetToPosition(documentText, d.range.start),
      end: offsetToPosition(documentText, d.range.end),
    },
    severity: toLspSeverity(d.severity),
    code: d.code,
    source: 'ts-sqlx',
    message: d.message,
  };
}

function toLspSeverity(s: DiagnosticSeverity): LSPSeverity {
  switch (s) {
    case 'error': return LSPSeverity.Error;
    case 'warning': return LSPSeverity.Warning;
    case 'info': return LSPSeverity.Information;
  }
}

connection.onCodeAction((params) => {
  const uri = params.textDocument.uri;
  const result = analysisResults.get(uri);
  if (!result) return [];

  const document = documents.get(uri);
  if (!document) return [];
  const text = document.getText();

  // Build a set of relevant diagnostic codes from the client-provided context
  const contextCodes = new Set<string>();
  if (params.context.diagnostics.length > 0) {
    for (const d of params.context.diagnostics) {
      if (d.source === 'ts-sqlx' && d.code) {
        contextCodes.add(String(d.code));
      }
    }
  }

  const actions: CodeAction[] = [];

  for (const queryAnalysis of result.queries) {
    if (!queryAnalysis.inferredColumns || queryAnalysis.inferredColumns.length === 0) continue;

    const { typeText: generatedType, imports: requiredImports } = generateTypeAnnotation(queryAnalysis.inferredColumns);
    let hasTs007 = false;
    let hasTs010 = false;

    for (const diag of queryAnalysis.diagnostics) {
      if (diag.code !== 'TS007' && diag.code !== 'TS010') continue;

      // Use client-provided diagnostics for matching when available, otherwise fall back to range overlap
      if (contextCodes.size > 0) {
        if (!contextCodes.has(diag.code)) continue;
      } else {
        const diagRange = offsetRangeToLsp(text, diag.range);
        if (!rangesOverlap(diagRange, params.range)) continue;
      }

      if (diag.code === 'TS007' && !hasTs007) {
        hasTs007 = true;
        const insertPos = offsetToPosition(text, queryAnalysis.query.insertTypePosition);
        actions.push(createAddTypeAnnotationAction(uri, generatedType, insertPos, requiredImports));
      } else if (diag.code === 'TS010' && !hasTs010 && queryAnalysis.query.typeArgumentRange) {
        hasTs010 = true;
        const range = queryAnalysis.query.typeArgumentRange;
        const replaceRange = {
          start: offsetToPosition(text, range.start),
          end: offsetToPosition(text, range.end),
        };
        actions.push(createUpdateTypeAnnotationAction(uri, generatedType, replaceRange, requiredImports));
      }
    }
  }

  return actions;
});

function offsetRangeToLsp(
  text: string,
  range: { start: number; end: number },
): { start: { line: number; character: number }; end: { line: number; character: number } } {
  return {
    start: offsetToPosition(text, range.start),
    end: offsetToPosition(text, range.end),
  };
}

function rangesOverlap(
  a: { start: { line: number; character: number }; end: { line: number; character: number } },
  b: { start: { line: number; character: number }; end: { line: number; character: number } },
): boolean {
  if (a.end.line < b.start.line) return false;
  if (a.start.line > b.end.line) return false;
  if (a.end.line === b.start.line && a.end.character < b.start.character) return false;
  if (a.start.line === b.end.line && a.start.character > b.end.character) return false;
  return true;
}

documents.onDidClose((event) => {
  analysisResults.delete(event.document.uri);
});

documents.listen(connection);
connection.listen();
