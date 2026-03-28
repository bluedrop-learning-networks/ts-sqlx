---
id: ts-ux5n
status: closed
deps: [ts-b8y3, ts-gfa1]
links: []
created: 2026-03-28T14:48:17Z
type: task
priority: 0
assignee: Donal Mac An Ri
parent: ts-7bbj
tags: [lsp]
---
# Task 18: Language Server Package Setup

Language Server Package Setup - LSP server with diagnostics, code actions, PGLite/ts-morph integration, and config-driven initialization.

### Task 18: Language Server Package Setup

**Files:**
- Create: `packages/language-server/package.json`
- Create: `packages/language-server/tsconfig.json`
- Create: `packages/language-server/src/server.ts`
- Create: `packages/language-server/src/index.ts`

- [ ] **Step 1: Create `packages/language-server/package.json`**

```json
{
  "name": "@ts-sqlx/language-server",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "ts-sqlx-lsp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@ts-sqlx/core": "workspace:*",
    "vscode-languageserver": "^10.0.0",
    "vscode-languageserver-textdocument": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create `packages/language-server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Implement LSP server**

```typescript
// packages/language-server/src/server.ts
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
import { DiagnosticsEngine } from '@ts-sqlx/core/src/diagnostics.js';
import { PGLiteAdapter } from '@ts-sqlx/core/src/adapters/database/pgliteAdapter.js';
import { TsMorphAdapter } from '@ts-sqlx/core/src/adapters/typescript/tsMorphAdapter.js';
import { resolveConfig } from '@ts-sqlx/core/src/config.js';
import type { Diagnostic, DiagnosticSeverity } from '@ts-sqlx/core/src/types.js';
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

    // Set up TypeScript adapter
    const tsAdapter = new TsMorphAdapter();
    const tsConfigPath = path.join(rootPath, 'tsconfig.json');
    if (fs.existsSync(tsConfigPath)) {
      tsAdapter.loadProject(tsConfigPath);
    }

    // Set up database adapter
    let dbAdapter = null;
    if (config.database.pglite && config.database.schema) {
      const adapter = await PGLiteAdapter.create();
      const schemaPath = path.resolve(rootPath, config.database.schema);
      if (fs.existsSync(schemaPath)) {
        await adapter.executeSchema(fs.readFileSync(schemaPath, 'utf8'));
      }
      dbAdapter = adapter;
    } else if (config.database.url) {
      // Real Postgres adapter would go here
      // For now, only PGLite is implemented
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

// Convert byte offset to line/character position
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

// Code action handler
connection.onCodeAction((params) => {
  if (!engine) return [];
  // Code actions are generated alongside diagnostics —
  // for now return empty; Task 19 wires this up with the codeActions module
  return [];
});

documents.listen(connection);
connection.listen();
```

- [ ] **Step 4: Create entry point**

```typescript
// packages/language-server/src/index.ts
#!/usr/bin/env node
import './server.js';
```

- [ ] **Step 5: Install deps and verify build**

Run: `pnpm install && pnpm -r build`
Expected: No build errors.

- [ ] **Step 6: Commit**

```bash
git add packages/language-server/
git commit -m "feat: add language server with LSP diagnostics"
```

## Design

Uses vscode-languageserver/node. Initializes PGLite or Pg adapter based on config. offsetToPosition converts diagnostic ranges.

## Acceptance Criteria

LSP server handles initialize, sends diagnostics on document change, converts byte offsets to line/character positions, declares codeActionProvider capability; build succeeds; commit created

