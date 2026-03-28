---
id: ts-7bbj
status: closed
deps: []
links: []
created: 2026-03-28T14:41:11Z
type: epic
priority: 0
assignee: Donal Mac An Ri
tags: [typescript, postgresql, lsp]
---
# ts-sqlx Implementation

Build a TypeScript SQL query checker and type inferrer for PostgreSQL, providing LSP diagnostics and CLI checking for pg-promise/node-postgres projects.

## Architecture

Monorepo with 4 packages (core, language-server, cli, test-utils). Core provides query detection, SQL parsing, param extraction, DB inference, and type comparison. All type inference uses PREPARE-based approach via a DatabaseAdapter abstraction (real Postgres or PGLite). Tests run against PGLite with fixture schemas and `@expect` annotations.

## Tech Stack

TypeScript, ts-morph, libpg-query, PGLite, pg, better-sqlite3, vscode-languageserver, cmd-ts, vitest, pnpm workspaces.

## Source Documents

- **Plan:** `docs/superpowers/plans/2026-03-28-ts-sqlx-implementation.md`
- **Spec:** `docs/superpowers/specs/2026-03-20-ts-sqlx-design.md`

## Packages

- `@ts-sqlx/core` — Query detection, SQL parsing, param extraction, DB inference, type comparison, diagnostics, cache
- `@ts-sqlx/test-utils` — PGLite fixture helpers, `@expect` annotation runner
- `@ts-sqlx/language-server` — LSP server with diagnostics, code actions, hover
- `@ts-sqlx/cli` — `ts-sqlx check`, `ts-sqlx generate`, `ts-sqlx cache`

