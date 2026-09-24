export interface Warning {
  id: string;
  kind: 'straggler' | 'battery';
  memberId: string;
  createdAt: string;
  position: { lat: number; lon: number; recordedAt: string };
  value: number;
}
export interface Detector {
  since?: number;
  recoveredSince?: number;
  lastAt?: number;
  lastAlertAt?: number;
  armed: boolean;
  previousBattery?: number;
  warning?: Warning;
}
export function straggler(
  state: Detector,
  now: number,
  gap: number | null,
  threshold: number,
  create: () => Warning,
) {
  if (state.lastAt !== undefined && now < state.lastAt) return;
  if (gap === null || (state.lastAt !== undefined && now - state.lastAt > 30000)) {
    delete state.since;
    delete state.recoveredSince;
    delete state.warning;
  }
  state.lastAt = now;
  if (gap === null) return;
  if (gap <= threshold * 0.8) {
    delete state.since;
    delete state.warning;
    state.recoveredSince ??= now;
    if (now - state.recoveredSince >= 30000) state.armed = true;
    return;
  }
  delete state.recoveredSince;
  if (gap < threshold) {
    delete state.since;
    delete state.warning;
    return;
  }
  state.since ??= now;
  if (
    state.armed &&
    now - state.since >= 30000 &&
    (state.lastAlertAt === undefined || now - state.lastAlertAt >= 120000)
  ) {
    state.warning = create();
    state.lastAlertAt = now;
    state.armed = false;
  }
}
export function battery(
  state: Detector,
  now: number,
  percent: number | null,
  threshold: number,
  create: () => Warning,
) {
  if (state.lastAt !== undefined && now <= state.lastAt) return;
  const continuous = state.lastAt !== undefined && now - state.lastAt <= 30000;
  state.lastAt = now;
  if (percent === null) {
    delete state.previousBattery;
    delete state.warning;
    return;
  }
  if (percent > threshold + 5) {
    state.armed = true;
    delete state.warning;
  }
  if (percent >= threshold) delete state.warning;
  if (
    continuous &&
    state.armed &&
    state.previousBattery !== undefined &&
    state.previousBattery >= threshold &&
    percent < threshold
  ) {
    state.warning = create();
    state.armed = false;
    state.lastAlertAt = now;
  }
  state.previousBattery = percent;
}
