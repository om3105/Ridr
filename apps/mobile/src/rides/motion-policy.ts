export type MotionState = 'stopped' | 'moving' | 'unknown';
export type SpeedObservation = {
  speedMps: number | null;
  accuracyM: number | null;
  observedAt: number;
};

/** Hysteresis uses fresh, consecutive speed observations, never missing speed as zero. */
export class MotionTracker {
  private state: MotionState = 'unknown';
  private lowSince: number | null = null;
  private highSince: number | null = null;
  private lastAt: number | null = null;

  reset() {
    this.state = 'unknown';
    this.lowSince = null;
    this.highSince = null;
    this.lastAt = null;
  }

  observe(sample: SpeedObservation, now: number): MotionState {
    const { speedMps, accuracyM, observedAt } = sample;
    if (
      !Number.isFinite(observedAt) ||
      observedAt > now + 1000 ||
      now - observedAt > 5000 ||
      speedMps === null ||
      !Number.isFinite(speedMps) ||
      speedMps < 0 ||
      speedMps > 500 / 3.6 ||
      accuracyM === null ||
      !Number.isFinite(accuracyM) ||
      accuracyM < 0 ||
      accuracyM > 50
    ) {
      this.reset();
      return this.state;
    }
    if (this.lastAt !== null && observedAt <= this.lastAt) return this.current(now);
    if (this.lastAt !== null && observedAt - this.lastAt > 5000) this.reset();
    this.lastAt = observedAt;
    const speedKph = speedMps * 3.6;
    if (speedKph < 3) {
      this.highSince = null;
      this.lowSince ??= observedAt;
      if (observedAt - this.lowSince >= 10000) this.state = 'stopped';
    } else if (speedKph > 6) {
      this.lowSince = null;
      this.highSince ??= observedAt;
      if (observedAt - this.highSince >= 5000) this.state = 'moving';
    } else {
      this.lowSince = null;
      this.highSince = null;
    }
    return this.state;
  }

  current(now: number): MotionState {
    if (this.lastAt === null || now - this.lastAt > 5000 || this.lastAt > now + 1000) this.reset();
    return this.state;
  }
}
