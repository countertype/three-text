import { debugLogger, isLogEnabled } from './DebugLogger';

interface PerformanceMetric {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

export type MetricSummary = {
  count: number;
  avgDuration: number;
  totalDuration: number;
  lastDuration: number;
};

class PerformanceLogger {
  private metrics: PerformanceMetric[] = [];
  private activeTimers: Map<string, number> = new Map();

  public start(name: string, metadata?: Record<string, any>): void {
    // Early exit if disabled - no metric collection
    if (!isLogEnabled) return;

    const startTime = performance.now();
    this.activeTimers.set(name, startTime);

    this.metrics.push({
      name,
      startTime,
      metadata
    });
  }

  public end(name: string): number | null {
    // Early exit if disabled
    if (!isLogEnabled) return null;

    const endTime = performance.now();
    const startTime = this.activeTimers.get(name);

    if (startTime === undefined) {
      debugLogger.warn(`Performance timer "${name}" was not started`);
      return null;
    }

    const duration = endTime - startTime;
    this.activeTimers.delete(name);

    // Find the metric in reverse order (most recent first)
    for (let i = this.metrics.length - 1; i >= 0; i--) {
      const metric = this.metrics[i];
      if (metric.name === name && !metric.endTime) {
        metric.endTime = endTime;
        metric.duration = duration;
        break;
      }
    }

    console.log(`${name}: ${duration.toFixed(2)}ms`);
    return duration;
  }

  public getSummary(): Record<string, MetricSummary> {
    if (!isLogEnabled) return {};

    const summary: Record<string, MetricSummary> = {};

    for (const metric of this.metrics) {
      if (!metric.duration) continue;

      const existing = summary[metric.name];
      if (existing) {
        existing.count++;
        existing.totalDuration += metric.duration;
        existing.avgDuration = existing.totalDuration / existing.count;
        existing.lastDuration = metric.duration;
      } else {
        summary[metric.name] = {
          count: 1,
          avgDuration: metric.duration,
          totalDuration: metric.duration,
          lastDuration: metric.duration
        };
      }
    }

    return summary;
  }

  public printSummary(): void {
    if (!isLogEnabled) return;

    const summary = this.getSummary();
    console.table(summary);
    console.log('Operations:', Object.keys(summary).sort().join(', '));
  }

  public printBaseline(): void {
    if (!isLogEnabled) return;

    const summary = this.getSummary();
    Object.entries(summary).forEach(([name, stats]) => {
      console.log(
        `BASELINE ${name}: ${stats.avgDuration.toFixed(2)}ms avg (${
          stats.count
        } calls)`
      );
    });
  }

  public clear(): void {
    if (!isLogEnabled) return;

    this.metrics.length = 0;
    this.activeTimers.clear();
  }

  public time<T>(name: string, fn: () => T, metadata?: Record<string, any>): T {
    if (!isLogEnabled) return fn();

    this.start(name, metadata);
    try {
      return fn();
    } finally {
      this.end(name);
    }
  }

  public async timeAsync<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    if (!isLogEnabled) return fn();

    this.start(name, metadata);
    try {
      return await fn();
    } finally {
      this.end(name);
    }
  }
}

// Create a single instance
// When debug is disabled, all methods return immediately with minimal overhead
export const perfLogger = new PerformanceLogger();
export { PerformanceLogger };
