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

- `withTiming<T>(label: string, fn: () => T): T` — times a sync or async function call. Stores `{ label, durationMs }` and logs a structured line to stderr. Returns the function's result transparently. When `TS_SQLX_PERF` is unset, calls `fn()` directly with no timing overhead.
- `summarize(): PerfSummary` — returns timings grouped by label: count, total, min, max, avg, plus overall wall time.
- `reset()` — clears entries for the next analysis pass.

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

#### `logPerf(message: string)`

Writes to stderr when enabled. Format:

```
[perf] getCallExpressions: 312ms
[perf] parseSqlAsync: 24ms
```

#### Summary format

Logged at the end of each `analyzeWithContext()` call:

```
[perf] Analysis summary for src/foo.ts
  Phase                 Count  Total   Min     Max     Avg
  updateFile                1   45ms   45ms    45ms    45ms
  getCallExpressions        1  312ms  312ms   312ms   312ms
  resolveStringLiteral      3   18ms    4ms     9ms     6ms
  parseSqlAsync             3   52ms   12ms    24ms    17ms
  dbInfer                   3  890ms  180ms   420ms   297ms
  getTypeProperties         2  156ms   72ms    84ms    78ms
  analyzeQuery              3 1124ms  280ms   510ms   375ms
  TOTAL (wall)                1481ms
```

### Instrumentation points

Eight measurement points across three files:

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
| Full `analyzeWithContext(filePath)` body | resets collector at start, logs summary at end |
| Per-query `analyzeQuery(query)` body | `analyzeQuery` |
| `parseSqlAsync(sql)` | `parseSqlAsync` |
| `DbInferrer.infer(sql)` | `dbInfer` |
| `tsAdapter.getTypeProperties(...)` | `getTypeProperties` |

#### Wrapper pattern

```typescript
// Before:
const result = await parseSqlAsync(sql);

// After:
const result = await perf.withTiming('parseSqlAsync', () => parseSqlAsync(sql));
```

When `TS_SQLX_PERF` is unset, `withTiming` is a passthrough: `return fn()`.

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

### Testing

No dedicated test files for the instrumentation module. It's a lightweight utility validated by running the existing test suite with `TS_SQLX_PERF=1` and verifying output appears on stderr.

## Files changed

| File | Change |
|------|--------|
| `packages/core/src/perf.ts` | New — PerfCollector class and singleton |
| `packages/core/src/diagnostics.ts` | Wrap `analyzeWithContext`, `analyzeQuery`, `parseSqlAsync`, `dbInfer`, `getTypeProperties` |
| `packages/core/src/queryDetector.ts` | Wrap `getCallExpressions`, `resolveStringLiteral` |
| `packages/language-server/src/server.ts` | Wrap `updateFile` |
| `packages/core/src/index.ts` | Export `perf` and `PerfCollector` |
