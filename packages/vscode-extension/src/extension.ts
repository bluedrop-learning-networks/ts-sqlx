import * as path from 'path';
import { workspace, ExtensionContext } from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  const serverModule = context.asAbsolutePath(
    path.join('dist', 'server', 'index.js'),
  );

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: { module: serverModule, transport: TransportKind.stdio },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'typescript' }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/ts-sqlx.toml'),
    },
  };

  client = new LanguageClient(
    'ts-sqlx',
    'ts-sqlx',
    serverOptions,
    clientOptions,
  );

  client.start();
}

export function deactivate(): Promise<void> | undefined {
  return client?.stop();
}
