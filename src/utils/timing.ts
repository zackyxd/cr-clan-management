/**
 * Timer utility for measuring execution time of operations
 *
 * @example
 * const timer = new Timer('my-operation');
 * // ... do some work
 * timer.checkpoint('database query');
 * // ... do more work
 * timer.checkpoint('API call');
 * timer.end(); // Logs total time
 */
export class Timer {
  private startTime: number;
  private lastCheckpoint: number;
  private checkpoints: Map<string, { elapsed: number; delta: number }> = new Map();

  constructor(private name: string) {
    this.startTime = performance.now();
    this.lastCheckpoint = this.startTime;
  }

  /**
   * Record a checkpoint with elapsed time from start and delta from last checkpoint
   * @param label - Label for this checkpoint
   * @returns Total elapsed time in milliseconds
   */
  checkpoint(label: string): number {
    const now = performance.now();
    const elapsed = now - this.startTime;
    const delta = now - this.lastCheckpoint;

    this.checkpoints.set(label, { elapsed, delta });
    console.log(`[${this.name}] ${label}: ${elapsed.toFixed(2)}ms (Δ ${delta.toFixed(2)}ms)`);

    this.lastCheckpoint = now;
    return elapsed;
  }

  /**
   * End timing and log total duration
   * @returns Total elapsed time in milliseconds
   */
  end(): number {
    const total = performance.now() - this.startTime;
    console.log(`[${this.name}] ✓ TOTAL: ${total.toFixed(2)}ms`);
    return total;
  }

  /**
   * Get all recorded checkpoints
   * @returns Object with checkpoint labels and their timing data
   */
  getCheckpoints(): Record<string, { elapsed: number; delta: number }> {
    return Object.fromEntries(this.checkpoints);
  }

  /**
   * Get total elapsed time without logging
   * @returns Total elapsed time in milliseconds
   */
  getElapsed(): number {
    return performance.now() - this.startTime;
  }
}
