import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
  DiagnosticSeverity as LSPSeverity,
  type Diagnostic as LSPDiagnostic,
  CodeActionKind,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DiagnosticsEngine } from '@ts-sqlx/core/diagnostics.js';
import { PGLiteAdapter } from '@ts-sqlx/core/adapters/database/pgliteAdapter.js';
import { TsMorphAdapter } from '@ts-sqlx/core/adapters/typescript/tsMorphAdapter.js';
import { resolveConfig } from '@ts-sqlx/core/config.js';
import type { Diagnostic, DiagnosticSeverity } from '@ts-sqlx/core/types.js';
import * as fs from 'fs';
import * as path from 'path';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let engine: DiagnosticsEngine | null = null;

connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
  const rootUri = params.rootUri;
  if (rootUri) {
    const rootPath = new URL(rootUri).pathname;
    const config = resolveConfig(rootPath);

    const tsAdapter = new TsMorphAdapter();
    const tsConfigPath = path.join(rootPath, 'tsconfig.json');
    if (fs.existsSync(tsConfigPath)) {
      tsAdapter.loadProject(tsConfigPath);
    }

    let dbAdapter = null;
    if (config.database.pglite && config.database.schema) {
      const adapter = await PGLiteAdapter.create();
      const schemaPath = path.resolve(rootPath, config.database.schema);
      if (fs.existsSync(schemaPath)) {
        await adapter.executeSchema(fs.readFileSync(schemaPath, 'utf8'));
      }
      dbAdapter = adapter;
    }

    engine = new DiagnosticsEngine(dbAdapter, tsAdapter);
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
    const diagnostics = await engine.analyze(filePath);
    connection.sendDiagnostics({
      uri,
      diagnostics: diagnostics.map(d => toLspDiagnostic(d, text)),
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

connection.onCodeAction(() => []);

documents.listen(connection);
connection.listen();
