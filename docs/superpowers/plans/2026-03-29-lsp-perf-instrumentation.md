# LSP Performance Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in performance instrumentation gated behind `TS_SQLX_PERF` to identify LSP bottlenecks before evaluating TsGo migration.

**Architecture:** A `PerfCollector` singleton with a `withTiming` wrapper function instruments 9 measurement points across the analysis pipeline. When disabled (default), `withTiming` is a zero-overhead passthrough. When enabled, it logs per-operation timings and a summary table to stderr.

**Tech Stack:** TypeScript, `performance.now()` from `node:perf_hooks`, vitest

**Spec:** `docs/superpowers/specs/2026-03-29-lsp-perf-instrumentation-design.md`

---

## Chunk 1: PerfCollector Module

### Task 1: PerfCollector — core class and withTiming

**Files:**
- Create: `packages/core/src/perf.ts`
- Create: `tests/integration/perf.test.ts`

- [ ] **Step 1: Write the failing tests for sync withTiming**

```typescript
// tests/integration/perf.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PerfCollector } from '@ts-sqlx/core/perf.js';

describe('PerfCollector', () => {
  let collector: PerfCollector;

  beforeEach(() => {
    collector = new PerfCollector(true);
  });

  describe('withTiming (sync)', () => {
    it('returns the function result', () => {
      const result = collector.withTiming('test', () => 42);
      expect(result).toBe(42);
    });

    it('records a timing entry', () => {
      collector.reset();
      collector.withTiming('test', () => 42);
      const summary = collector.summarize();
      expect(summary.phases.has('test')).toBe(true);
      expect(summary.phases.get('test')!.count).toBe(1);
      expect(summary.phases.get('test')!.totalMs).toBeGreaterThanOrEqual(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/perf.test.ts`
Expected: FAIL — module `@ts-sqlx/core/perf.js` not found

- [ ] **Step 3: Write PerfCollector with sync withTiming, reset, summarize**

```typescript
// packages/core/src/perf.ts
import { performance } from 'node:perf_hooks';

interface PerfEntry {
  label: string;
  durationMs: number;
}

export interface PerfPhaseSummary {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
}

export interface PerfSummary {
  phases: Map<string, PerfPhaseSummary>;
  wallMs: number;
}

export class PerfCollector {
  private enabled: boolean;
  private entries: PerfEntry[] = [];
  private wallStart: number = 0;

  constructor(enabled?: boolean) {
    this.enabled = enabled ?? !!process.env.TS_SQLX_PERF;
  }

  reset(): void {
    this.entries = [];
    this.wallStart = performance.now();
  }

  withTiming<T>(label: string, fn: () => T): T {
    if (!this.enabled) return fn();
    const start = performance.now();
    const result = fn();
    if (result instanceof Promise) {
      return result.then((val) => {
        this.record(label, performance.now() - start);
        return val;
      }) as T;
    }
    this.record(label, performance.now() - start);
    return result;
  }

  summarize(): PerfSummary {
    const phases = new Map<string, PerfPhaseSummary>();
    for (const entry of this.entries) {
      const existing = phases.get(entry.label);
      if (existing) {
        existing.count++;
        existing.totalMs += entry.durationMs;
        existing.minMs = Math.min(existing.minMs, entry.durationMs);
        existing.maxMs = Math.max(existing.maxMs, entry.durationMs);
        existing.avgMs = existing.totalMs / existing.count;
      } else {
        phases.set(entry.label, {
          count: 1,
          totalMs: entry.durationMs,
          minMs: entry.durationMs,
          maxMs: entry.durationMs,
          avgMs: entry.durationMs,
        });
      }
    }
    return {
      phases,
      wallMs: this.wallStart ? performance.now() - this.wallStart : 0,
    };
  }

  private record(label: string, durationMs: number): void {
    this.entries.push({ label, durationMs });
    this.logPerf(`${label}: ${durationMs.toFixed(1)}ms`);
  }

  private logPerf(message: string): void {
    process.stderr.write(`[perf] ${message}\n`);
  }

  logSummary(filePath: string, summary: PerfSummary): void {
    const lines: string[] = [`[perf] Analysis summary for ${filePath}`];
    lines.push('  Phase                 Count  Total   Min     Max     Avg');

    for (const [label, phase] of summary.phases) {
      lines.push(
        `  ${label.padEnd(22)}${String(phase.count).padStart(5)}  ${fmt(phase.totalMs)}  ${fmt(phase.minMs)}  ${fmt(phase.maxMs)}  ${fmt(phase.avgMs)}`,
      );
    }
    lines.push(`  ${'TOTAL (wall)'.padEnd(28)}${fmt(summary.wallMs)}`);
    process.stderr.write(lines.join('\n') + '\n');
  }
}

function fmt(ms: number): string {
  return `${ms.toFixed(0)}ms`.padStart(6);
}

export const perf = new PerfCollector();
```

- [ ] **Step 4: Add the package export for `perf.js`**

In `packages/core/package.json`, add to the `"exports"` map (follow the pattern of existing entries like `"./diagnostics.js"`):

```json
"./perf.js": {
  "import": "./dist/perf.js",
  "types": "./dist/perf.d.ts"
}
```

Also add to `packages/core/src/index.ts`:

```typescript
export { PerfCollector, perf } from './perf.js';
export type { PerfSummary, PerfPhaseSummary } from './perf.js';
```

- [ ] **Step 5: Build and run test to verify it passes**

Run: `pnpm build && npx vitest run tests/integration/perf.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/perf.ts packages/core/src/index.ts packages/core/package.json tests/integration/perf.test.ts
git commit -m "feat: add PerfCollector with sync withTiming support"
```

### Task 2: Async withTiming tests

**Files:**
- Modify: `tests/integration/perf.test.ts`

- [ ] **Step 1: Write the failing tests for async withTiming**

Add to the `describe('PerfCollector')` block in `tests/integration/perf.test.ts`:

```typescript
  describe('withTiming (async)', () => {
    it('returns the async function result', async () => {
      const result = await collector.withTiming('async-test', () =>
        new Promise<number>((resolve) => setTimeout(() => resolve(99), 50)),
      );
      expect(result).toBe(99);
    });

    it('measures actual elapsed time for async operations', async () => {
      collector.reset();
      await collector.withTiming('slow-op', () =>
        new Promise<void>((resolve) => setTimeout(resolve, 50)),
      );
      const summary = collector.summarize();
      const phase = summary.phases.get('slow-op')!;
      expect(phase.count).toBe(1);
      expect(phase.totalMs).toBeGreaterThanOrEqual(40); // allow some timer variance
    });
  });
```

- [ ] **Step 2: Run test to verify it passes** (async is already handled in the implementation)

Run: `npx vitest run tests/integration/perf.test.ts`
Expected: PASS — async handling was implemented in Task 1

- [ ] **Step 3: Commit**

```bash
git add tests/integration/perf.test.ts
git commit -m "test: add async withTiming tests for PerfCollector"
```

### Task 3: Summary aggregation and disabled mode tests

**Files:**
- Modify: `tests/integration/perf.test.ts`

- [ ] **Step 1: Write aggregation and disabled mode tests**

Add to the `describe('PerfCollector')` block:

```typescript
  describe('summarize', () => {
    it('aggregates multiple entries for the same label', () => {
      collector.reset();
      collector.withTiming('op', () => { /* fast */ });
      collector.withTiming('op', () => { /* fast */ });
      collector.withTiming('op', () => { /* fast */ });
      const summary = collector.summarize();
      const phase = summary.phases.get('op')!;
      expect(phase.count).toBe(3);
      expect(phase.avgMs).toBeCloseTo(phase.totalMs / 3, 1);
      expect(phase.minMs).toBeLessThanOrEqual(phase.maxMs);
    });

    it('tracks wall time from reset', async () => {
      collector.reset();
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      const summary = collector.summarize();
      expect(summary.wallMs).toBeGreaterThanOrEqual(40);
    });
  });

  describe('disabled mode', () => {
    it('is a passthrough that accumulates no entries', () => {
      const disabled = new PerfCollector(false);
      disabled.reset();
      const result = disabled.withTiming('test', () => 'hello');
      expect(result).toBe('hello');
      const summary = disabled.summarize();
      expect(summary.phases.size).toBe(0);
    });

    it('is a passthrough for async functions', async () => {
      const disabled = new PerfCollector(false);
      disabled.reset();
      const result = await disabled.withTiming('test', () => Promise.resolve(42));
      expect(result).toBe(42);
      const summary = disabled.summarize();
      expect(summary.phases.size).toBe(0);
    });
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/integration/perf.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/perf.test.ts
git commit -m "test: add summary aggregation and disabled mode tests"
```

## Chunk 2: Instrument the Analysis Pipeline

### Task 4: Instrument diagnostics.ts

**Files:**
- Modify: `packages/core/src/diagnostics.ts:1-39,122,147,177`

- [ ] **Step 1: Add perf import and instrument analyzeWithContext**

At the top of `packages/core/src/diagnostics.ts`, add:

```typescript
import { perf } from './perf.js';
```

Replace the `analyzeWithContext` method body (lines 27-39) with:

```typescript
  async analyzeWithContext(filePath: string): Promise<AnalysisResult> {
    perf.reset();
    const allDiagnostics: Diagnostic[] = [];
    const queryAnalyses: QueryAnalysis[] = [];
    const queries = perf.withTiming('detectQueries', () =>
      this.queryDetector.detectQueries(filePath),
    );

    for (const query of queries) {
      const { diagnostics, inferredColumns } = await perf.withTiming('analyzeQuery', () =>
        this.analyzeQuery(query, filePath),
      );
      allDiagnostics.push(...diagnostics);
      queryAnalyses.push({ query, diagnostics, inferredColumns });
    }

    const summary = perf.summarize();
    perf.logSummary(filePath, summary);
    return { diagnostics: allDiagnostics, queries: queryAnalyses };
  }
```

- [ ] **Step 2: Instrument parseSqlAsync call**

In `analyzeQuery` (around line 122), change:

```typescript
    const parseResult = await parseSqlAsync(extracted.normalized);
```

to:

```typescript
    const parseResult = await perf.withTiming('parseSqlAsync', () =>
      parseSqlAsync(extracted.normalized),
    );
```

- [ ] **Step 3: Instrument DbInferrer.infer call**

In `analyzeQuery` (around line 147), change:

```typescript
      const inferred = await this.inferrer!.infer(extracted.normalized);
```

to:

```typescript
      const inferred = await perf.withTiming('dbInfer', () =>
        this.inferrer!.infer(extracted.normalized),
      );
```

- [ ] **Step 4: Instrument getTypeProperties call**

In `analyzeQuery` (around line 177), change:

```typescript
          : this.tsAdapter.getTypeProperties(query.declaredResultType, filePath);
```

to:

```typescript
          : perf.withTiming('getTypeProperties', () =>
              this.tsAdapter.getTypeProperties(query.declaredResultType!, filePath),
            );
```

- [ ] **Step 5: Build and run existing tests to check nothing broke**

Run: `pnpm build && npx vitest run tests/integration/diagnostics.test.ts`
Expected: PASS — all existing tests still pass (perf is disabled by default)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/diagnostics.ts
git commit -m "feat: instrument diagnostics engine with perf timing"
```

### Task 5: Instrument queryDetector.ts

**Files:**
- Modify: `packages/core/src/queryDetector.ts:1,14-15,43`

- [ ] **Step 1: Add perf import and instrument getCallExpressions**

At the top of `packages/core/src/queryDetector.ts`, add:

```typescript
import { perf } from './perf.js';
```

In `detectQueries` (lines 14-15), change:

```typescript
  detectQueries(filePath: string): QueryCallInfo[] {
    const calls = this.tsAdapter.getCallExpressions(filePath);
```

to:

```typescript
  detectQueries(filePath: string): QueryCallInfo[] {
    const calls = perf.withTiming('getCallExpressions', () =>
      this.tsAdapter.getCallExpressions(filePath),
    );
```

- [ ] **Step 2: Instrument resolveStringLiteral call**

In `classifyCall` (around line 43), change:

```typescript
      sqlText = this.tsAdapter.resolveStringLiteral(filePath, sqlArg.position);
```

to:

```typescript
      sqlText = perf.withTiming('resolveStringLiteral', () =>
        this.tsAdapter.resolveStringLiteral(filePath, sqlArg.position),
      );
```

- [ ] **Step 3: Build and run existing tests to check nothing broke**

Run: `pnpm build && npx vitest run tests/integration/queryDetector.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/queryDetector.ts
git commit -m "feat: instrument query detector with perf timing"
```

### Task 6: Instrument server.ts

**Files:**
- Modify: `packages/language-server/src/server.ts:80`

- [ ] **Step 1: Add perf import and instrument updateFile**

At the top of `packages/language-server/src/server.ts`, add:

```typescript
import { perf } from '@ts-sqlx/core/perf.js';
```

In the `onDidChangeContent` handler (line 80), change:

```typescript
      tsAdapter.updateFile(filePath, text);
```

to:

```typescript
      perf.withTiming('updateFile', () => tsAdapter.updateFile(filePath, text));
```

- [ ] **Step 2: Build to verify compilation**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/language-server/src/server.ts
git commit -m "feat: instrument LSP server updateFile with perf timing"
```

## Chunk 3: Verification

### Task 7: End-to-end verification

- [ ] **Step 1: Run full test suite without TS_SQLX_PERF to verify no regressions**

Run: `pnpm build && npx vitest run`
Expected: All tests PASS, no perf output on stderr

- [ ] **Step 2: Run full test suite with TS_SQLX_PERF=1 to verify output**

Run: `TS_SQLX_PERF=1 npx vitest run 2>perf.log && head -50 perf.log`
Expected: `perf.log` contains `[perf]` lines with timing data and summary tables

- [ ] **Step 3: Commit any final fixes if needed**
