import type { Consent, QueueState, Sample, Sharing, StopIntent, TrackingStatus } from './types';
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_BYTES = 50 * 1024 * 1024;
export function retryDelay(attempt: number, random = Math.random): number {
  return Math.round(Math.min(30000, 1000 * 2 ** Math.min(attempt, 5)) * (0.5 + random() * 0.5));
}
export interface QueueDependencies {
  now(): number;
  uuid(): string;
  save(state: QueueState): Promise<void>;
  register(deviceId: string): Promise<void>;
  enable(intent: NonNullable<QueueState['enableIntent']>): Promise<Sharing>;
  stop(intent: StopIntent): Promise<Sharing>;
  current(rideId: string): Promise<{ active: boolean; sharing: boolean; epoch: number }>;
  live(deviceId: string, sample: Sample): Promise<string>;
  history(
    deviceId: string,
    samples: Sample[],
  ): Promise<{ accepted: string[]; rejected: { id: string; code: string }[] }>;
  publish(status: TrackingStatus): void;
  permanent(error: unknown): boolean;
}
export class LocationQueue {
  private collecting = false;
  private generation = 0;
  private flushing = false;
  private starting = false;
  private saving: Promise<void> = Promise.resolve();
  private lastCapturedAt: string | null = null;
  private lastAckAt: string | null = null;
  private message = 'Location sharing is off.';
  constructor(
    readonly state: QueueState,
    private readonly deps: QueueDependencies,
  ) {}
  private persist() {
    const copy = JSON.parse(JSON.stringify(this.state)) as QueueState;
    const saved = this.saving.then(() => this.deps.save(copy));
    this.saving = saved.catch(() => undefined);
    return saved;
  }
  status(): TrackingStatus {
    return {
      sharing: this.collecting,
      queued: this.state.samples.length,
      lastCapturedAt: this.lastCapturedAt,
      lastAckAt: this.lastAckAt,
      message: this.message,
      pendingStop: !!this.state.pendingStop || !!this.state.enableIntent,
    };
  }
  private publish(message?: string) {
    if (message) this.message = message;
    this.deps.publish(this.status());
  }
  async recover() {
    // OS termination never silently renews opt-in. Preserve queued samples and
    // reconcile the prior consent before any historical upload or new opt-in.
    if (this.state.consent || this.state.enableIntent) await this.stop();
    this.publish('Sharing is off. Pending samples will retry when connected.');
  }
  async start(consent: Omit<Consent, 'since'>, revision: number) {
    if (this.collecting || this.state.pendingStop || this.state.enableIntent)
      throw new Error('Finish the pending stop before enabling sharing.');
    this.starting = true;
    const generation = ++this.generation;
    const intent = {
      rideId: consent.rideId,
      epoch: consent.epoch,
      interval: consent.interval,
      revision,
      idempotencyKey: this.deps.uuid(),
    };
    try {
      await this.deps.register(this.state.deviceId);
      if (generation !== this.generation) return;
      this.state.enableIntent = intent;
      await this.persist();
      if (generation !== this.generation) return;
      const enabled = await this.deps.enable(intent);
      this.state.enableIntent = null;
      this.state.consent = { ...consent, epoch: enabled.consentEpoch, since: enabled.effectiveAt };
      if (generation !== this.generation) {
        await this.stop();
        this.reconcileStopTime(enabled.effectiveAt);
        await this.persist();
        return;
      }
      await this.persist();
      if (generation !== this.generation) return;
      this.collecting = true;
      this.publish('Sharing location with active ride members.');
    } catch (error) {
      if (this.deps.permanent(error)) {
        this.state.enableIntent = null;
        this.state.consent = null;
        this.state.pendingStop = null;
        await this.persist();
      } else await this.stop();
      throw error;
    } finally {
      this.starting = false;
    }
  }
  private reconcileStopTime(effectiveAt: string) {
    const pending = this.state.pendingStop;
    if (pending)
      pending.stoppedAt = new Date(
        Math.max(Date.parse(pending.stoppedAt), Date.parse(effectiveAt)),
      ).toISOString();
  }
  stop(): Promise<void> {
    this.collecting = false;
    ++this.generation;
    const consent = this.state.consent;
    const intent = this.state.enableIntent;
    if (!this.state.pendingStop && (consent || intent))
      this.state.pendingStop = {
        rideId: consent?.rideId ?? intent!.rideId,
        consentEpoch: consent?.epoch ?? intent!.epoch,
        stoppedAt: new Date(
          Math.max(this.deps.now(), Date.parse(consent?.since ?? '') || 0),
        ).toISOString(),
        idempotencyKey: this.deps.uuid(),
      };
    this.publish('Location collection stopped. Server confirmation may be pending.');
    return this.persist();
  }
  async capture(fix: {
    timestamp: number;
    latitude: number;
    longitude: number;
    accuracy: number | null;
    speed: number | null;
    heading: number | null;
    batteryPercent?: number | null;
  }) {
    const consent = this.state.consent;
    if (
      !this.collecting ||
      !consent ||
      !Number.isFinite(fix.timestamp) ||
      fix.timestamp < Date.parse(consent.since) ||
      fix.timestamp > this.deps.now() + 5000 ||
      this.deps.now() - fix.timestamp > 30000 ||
      (this.lastCapturedAt &&
        fix.timestamp - Date.parse(this.lastCapturedAt) < consent.interval * 1000)
    )
      return;
    if (
      !Number.isFinite(fix.latitude) ||
      Math.abs(fix.latitude) > 90 ||
      !Number.isFinite(fix.longitude) ||
      Math.abs(fix.longitude) > 180 ||
      fix.accuracy === null ||
      !Number.isFinite(fix.accuracy) ||
      fix.accuracy < 0 ||
      fix.accuracy > 100000
    ) {
      this.publish('Waiting for a valid location fix.');
      return;
    }
    this.state.samples = this.state.samples.filter(
      (s) => this.deps.now() - Date.parse(s.capturedAt) <= MAX_AGE_MS,
    );
    if (JSON.stringify(this.state).length * 2 > MAX_BYTES - 2048) {
      await this.stop();
      this.publish('Location queue is full. Reconnect before sharing again.');
      return;
    }
    const at = new Date(fix.timestamp).toISOString();
    const sample: Sample = {
      v: 1,
      type: 'location.sample',
      id: this.deps.uuid(),
      rideId: consent.rideId,
      capturedAt: at,
      payload: {
        consentEpoch: consent.epoch,
        position: {
          lat: fix.latitude,
          lon: fix.longitude,
          accuracyM: fix.accuracy,
          recordedAt: at,
        },
        speedKph:
          fix.speed !== null &&
          Number.isFinite(fix.speed) &&
          fix.speed >= 0 &&
          fix.speed * 3.6 <= 500
            ? fix.speed * 3.6
            : null,
        headingDegrees:
          fix.heading !== null &&
          Number.isFinite(fix.heading) &&
          fix.heading >= 0 &&
          fix.heading < 360
            ? fix.heading
            : null,
        batteryPercent:
          typeof fix.batteryPercent === 'number' &&
          Number.isInteger(fix.batteryPercent) &&
          fix.batteryPercent >= 0 &&
          fix.batteryPercent <= 100
            ? fix.batteryPercent
            : null,
      },
    };
    this.state.samples.push(sample);
    this.lastCapturedAt = at;
    try {
      await this.persist();
      this.publish(
        fix.accuracy > 50
          ? 'Sharing with low GPS accuracy.'
          : 'Location saved; waiting for acknowledgement.',
      );
    } catch (error) {
      this.collecting = false;
      ++this.generation;
      this.publish('Encrypted storage failed. Location collection stopped.');
      throw error;
    }
  }
  async flush(privacyOnly = false) {
    if (this.flushing || this.starting) return;
    this.flushing = true;
    try {
      await this.saving;
      if (this.state.enableIntent) {
        const intent = this.state.enableIntent;
        try {
          const enabled = await this.deps.enable(intent);
          this.state.consent = {
            rideId: intent.rideId,
            epoch: enabled.consentEpoch,
            since: enabled.effectiveAt,
            interval: intent.interval,
          };
          this.state.enableIntent = null;
          // The enable was uncertain: reconcile it only to stop, never resume capture.
          await this.stop();
          this.reconcileStopTime(enabled.effectiveAt);
          await this.persist();
        } catch (error) {
          if (!this.deps.permanent(error)) throw error;
          this.state.enableIntent = null;
          this.state.pendingStop = null;
          this.state.consent = null;
          await this.persist();
        }
      }
      if (this.state.pendingStop) {
        const pending = this.state.pendingStop;
        await this.deps.stop(pending);
        if (this.state.pendingStop === pending) {
          this.state.pendingStop = null;
          this.state.consent = null;
        }
        await this.persist();
      }
      if (privacyOnly) return;
      const consent = this.state.consent;
      const queuedRideId = consent?.rideId ?? this.state.samples[0]?.rideId;
      if (queuedRideId) {
        let current;
        try {
          current = await this.deps.current(queuedRideId);
        } catch (error) {
          if (consent && this.deps.permanent(error)) await this.stop();
          throw error;
        }
        if (
          consent &&
          (!current.active || !current.sharing || current.epoch !== consent.epoch)
        ) {
          await this.stop();
          return;
        }
      }
      this.state.samples = this.state.samples.filter(
        (s) => this.deps.now() - Date.parse(s.capturedAt) <= MAX_AGE_MS,
      );
      // Only the newest fresh sample goes to the live channel; backlog is history.
      const generation = this.generation;
      const latest = this.collecting
        ? this.state.samples
            .filter(
              (s) =>
                s.rideId === consent?.rideId &&
                s.payload.consentEpoch === consent.epoch &&
                this.deps.now() - Date.parse(s.capturedAt) <= 30000,
            )
            .at(-1)
        : undefined;
      if (latest && generation === this.generation) {
        await this.deps.live(this.state.deviceId, latest);
        this.state.samples = this.state.samples.filter((s) => s.id !== latest.id);
        this.lastAckAt = new Date(this.deps.now()).toISOString();
        await this.persist();
      }
      if (this.state.pendingStop || this.state.enableIntent || generation !== this.generation)
        return;
      const first = this.state.samples[0];
      if (first) {
        const batch = this.state.samples.filter((s) => s.rideId === first.rideId).slice(0, 200);
        const response = await this.deps.history(this.state.deviceId, batch);
        const removed = new Set([...response.accepted, ...response.rejected.map((r) => r.id)]);
        this.state.samples = this.state.samples.filter((s) => !removed.has(s.id));
        if (response.rejected.length)
          this.publish(
            'Some queued samples were outside the allowed consent period and were discarded.',
          );
        this.lastAckAt = new Date(this.deps.now()).toISOString();
      }
      await this.persist();
      this.publish();
    } catch (error) {
      this.publish('Connection unavailable. Samples stay encrypted and will retry.');
      throw error;
    } finally {
      this.flushing = false;
    }
  }
}
