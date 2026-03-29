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

  private record(label: string, durationMs: number): void {
    this.entries.push({ label, durationMs });
    this.logPerf(`${label}: ${durationMs.toFixed(1)}ms`);
  }

  private logPerf(message: string): void {
    process.stderr.write(`[perf] ${message}\n`);
  }
}

function fmt(ms: number): string {
  return `${ms.toFixed(0)}ms`.padStart(6);
}

export const perf = new PerfCollector();
