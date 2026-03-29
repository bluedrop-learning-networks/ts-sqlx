# LSP Performance Instrumentation Design

## Context

The ts-sqlx language server occasionally exhibits multi-second hangs on certain files. Before investigating alternatives to the TsMorph-based internals (e.g., TsGo), we need data on where time is actually spent during analysis.

## Goal

Add opt-in performance instrumentation that:
1. Logs per-operation timing to stderr as structured lines
2. Prints a summary table at the end of each file analysis
3. Is gated behind the `TS_SQLX_PERF` environment variable (zero overhead when off)
4. Can be run against the existing test suite as a benchmark

## Design

### New module: `packages/core/src/perf.ts`

#### `PerfCollector` class

Accumulates timing entries during a single analysis pass.

**Methods:**

- `withTiming<T>(label: string, fn: () => T | Promise<T>): T | Promise<T>` — times a sync or async function call. If `fn` returns a Promise, awaits it before recording the elapsed time (using `performance.now()` for sub-millisecond precision). Stores `{ label, durationMs }` and logs a structured line to stderr. Returns the function's result transparently. When `TS_SQLX_PERF` is unset, calls `fn()` directly with no timing overhead.
- `summarize(): PerfSummary` — returns timings grouped by label: count, total, min, max, avg, plus overall wall time.
- `reset()` — clears entries for the next analysis pass and records the wall-clock start time for the current pass.

**`PerfSummary` type:**

```typescript
interface PerfEntry {
  label: string;
  durationMs: number;
}

interface PerfPhaseSummary {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
}

interface PerfSummary {
  phases: Map<string, PerfPhaseSummary>;
  wallMs: number;
}
```

#### Singleton export

```typescript
export const perf: PerfCollector;
```

Created once at module load. Checks `process.env.TS_SQLX_PERF` to determine whether timing is active.

#### Logging methods

`logPerf(message: string)` — private, called internally by `withTiming` after each operation completes. Writes to stderr. Format:

```
[perf] getCallExpressions: 312ms
[perf] parseSqlAsync: 24ms
```

`logSummary(filePath: string, summary: PerfSummary)` — public, called by `analyzeWithContext` after `summarize()`. Logs the summary table to stderr.

#### Summary format

Logged at the end of each `analyzeWithContext()` call:

```
[perf] Analysis summary for src/foo.ts
  Phase                 Count  Total   Min     Max     Avg
  updateFile                1   45ms   45ms    45ms    45ms
  getCallExpressions        1  312ms  312ms   312ms   312ms
  detectQueries             1  340ms  340ms   340ms   340ms
  resolveStringLiteral      3   18ms    4ms     9ms     6ms
  parseSqlAsync             3   52ms   12ms    24ms    17ms
  dbInfer                   3  890ms  180ms   420ms   297ms
  getTypeProperties         2  156ms   72ms    84ms    78ms
  analyzeQuery              3 1124ms  280ms   510ms   375ms
  TOTAL (wall)                1481ms
```

### Instrumentation points

Nine measurement points across three files:

#### `server.ts`

| Call | Label |
|------|-------|
| `tsAdapter.updateFile(filePath, text)` | `updateFile` |

#### `queryDetector.ts`

| Call | Label |
|------|-------|
| `tsAdapter.getCallExpressions(filePath)` | `getCallExpressions` |
| `tsAdapter.resolveStringLiteral(filePath, pos)` | `resolveStringLiteral` |

#### `diagnostics.ts`

| Call | Label |
|------|-------|
| `queryDetector.detectQueries(filePath)` | `detectQueries` |
| Full `analyzeWithContext(filePath)` body | resets collector at start, logs summary at end (see below) |
| Per-query `analyzeQuery(query)` body | `analyzeQuery` |
| `parseSqlAsync(sql)` | `parseSqlAsync` |
| `DbInferrer.infer(sql)` | `dbInfer` |
| `tsAdapter.getTypeProperties(...)` | `getTypeProperties` |

#### Wrapper pattern

```typescript
// Async operations:
const result = await perf.withTiming('parseSqlAsync', () => parseSqlAsync(sql));

// Sync operations:
const calls = perf.withTiming('getCallExpressions', () => tsAdapter.getCallExpressions(filePath));
```

When `TS_SQLX_PERF` is unset, `withTiming` is a passthrough: `return fn()`.

#### `analyzeWithContext` orchestration

Unlike the other points, `analyzeWithContext` is not wrapped with `withTiming`. Instead it uses `reset()` and `summarize()` directly:

```typescript
async analyzeWithContext(filePath: string): Promise<AnalysisResult> {
  perf.reset(); // clears entries, records wall-clock start
  // ... existing analysis logic (all inner withTiming calls accumulate here) ...
  const summary = perf.summarize(); // computes wall time from reset()
  perf.logSummary(filePath, summary); // logs the table to stderr
  return result;
}
```

#### Async handling

`withTiming` checks whether `fn()` returns a thenable. If so, it chains `.then()` to record the elapsed time after the promise resolves. This means async operations are timed correctly (measuring actual elapsed time, not just the time to create the promise).

```typescript
withTiming<T>(label: string, fn: () => T): T {
  if (!this.enabled) return fn();
  const start = performance.now();
  const result = fn();
  if (result instanceof Promise) {
    return result.then(val => {
      this.record(label, performance.now() - start);
      return val;
    }) as T;
  }
  this.record(label, performance.now() - start);
  return result;
}
```

### Environment variable

- **Name**: `TS_SQLX_PERF`
- **Values**: Any truthy value enables instrumentation (e.g., `TS_SQLX_PERF=1`)
- **When unset**: `withTiming` calls `fn()` directly. No `performance.now()` calls, no logging, no entry accumulation.

### Output

- All output goes to **stderr** so it doesn't interfere with LSP protocol (stdout) or test assertions
- Per-operation lines logged immediately as each `withTiming` completes
- Summary table logged once at the end of `analyzeWithContext()`

### Usage

Run existing test suite as benchmark:

```bash
TS_SQLX_PERF=1 npm test 2>perf.log
```

Or filter just the perf lines:

```bash
TS_SQLX_PERF=1 npm test 2>&1 >/dev/null | grep '\[perf\]'
```

### Concurrency caveat

The singleton `PerfCollector` with `reset()` is not safe for concurrent analysis of multiple files. If the language server processes two `onDidChangeContent` events concurrently, one `reset()` could clear entries from another in-flight analysis. This is acceptable for profiling purposes — the instrumentation is a diagnostic tool, not production telemetry. When benchmarking via the test suite, tests run sequentially so this is not an issue.

### Testing

A small unit test file `tests/unit/perf.test.ts` to verify:
- Async timing measures actual elapsed time (not ~0ms)
- Sync timing works correctly
- Summary aggregation (count, min, max, avg) is correct
- Disabled mode is a true passthrough (no entries accumulated)

## Files changed

| File | Change |
|------|--------|
| `packages/core/src/perf.ts` | New — PerfCollector class and singleton |
| `packages/core/src/diagnostics.ts` | Wrap `analyzeWithContext`, `analyzeQuery`, `parseSqlAsync`, `dbInfer`, `getTypeProperties` |
| `packages/core/src/queryDetector.ts` | Wrap `detectQueries`, `getCallExpressions`, `resolveStringLiteral` |
| `tests/unit/perf.test.ts` | New — unit tests for PerfCollector |
| `packages/language-server/src/server.ts` | Wrap `updateFile` |
| `packages/core/src/index.ts` | Export `perf` and `PerfCollector` |
