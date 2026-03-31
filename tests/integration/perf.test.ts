import { describe, it, expect, beforeEach } from 'vitest';
import { PerfCollector } from '@bluedrop-learning-networks/ts-sqlx-core/perf.js';

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
      expect(phase.totalMs).toBeGreaterThanOrEqual(40);
    });
  });

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
});
