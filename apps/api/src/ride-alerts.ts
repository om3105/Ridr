import { randomUUID } from 'node:crypto';
import { ApiError } from './api-errors.js';
import { stationary, type ManagementContext } from './ride-management.js';
import { RouteProgress, groupGaps, type Progress } from './ride-geometry.js';
import { battery, straggler, type Detector, type Warning } from './alert-machine.js';
import type { LiveLocations, LocationSample } from './location.js';
import type { MotionContext } from './ride-types.js';
interface AlertState {
  epochs?: Record<string, number>;
  routeRevision?: number;
  threshold?: number;
  progress: [string, Progress][];
  stragglers: Record<string, Detector>;
  batteries: Record<string, Detector>;
  batteryThresholds: Record<string, 10 | 20 | 30>;
  acknowledgements: Record<string, string[]>;
}
export interface AlertSettings {
  kind: 'straggler' | 'battery';
  value: number;
  idempotencyKey: string;
  revision?: number;
  motion?: MotionContext['motion'];
  capturedAt?: string;
}
export async function loadAlerts(context: ManagementContext): Promise<AlertState> {
  const result = await context.client.query<{ body: AlertState }>(
    'SELECT body FROM ridr.ride_alert_state WHERE ride_id=$1',
    [context.ride.id],
  );
  return (
    result.rows[0]?.body ?? {
      progress: [],
      stragglers: {},
      batteries: {},
      batteryThresholds: {},
      acknowledgements: {},
    }
  );
}
async function save(context: ManagementContext, state: AlertState) {
  await context.client.query(
    `INSERT INTO ridr.ride_alert_state (ride_id,body) VALUES ($1,$2::jsonb)
    ON CONFLICT (ride_id) DO UPDATE SET body=EXCLUDED.body`,
    [context.ride.id, JSON.stringify(state)],
  );
}
export function visibleWarnings(
  state: AlertState,
  snapshot: LiveLocations,
  now: number,
): Warning[] {
  const items = new Map(snapshot.items.map((item) => [item.memberId, item]));
  return [...Object.values(state.stragglers), ...Object.values(state.batteries)].flatMap(
    (detector) => {
      const warning = detector.warning,
        item = warning && items.get(warning.memberId);
      if (
        !warning ||
        !item ||
        now - Date.parse(item.position.recordedAt) > 30000 ||
        now - Date.parse(warning.createdAt) > 120000
      )
        return [];
      if (warning.kind === 'straggler' && item.freshness !== 'fresh') return [];
      return [{ ...warning, position: item.position }];
    },
  );
}
export async function evaluateAlerts(
  context: ManagementContext,
  snapshot: LiveLocations,
  sample: LocationSample,
) {
  const state = await loadAlerts(context),
    now = Date.parse(snapshot.serverTime);
  const live = snapshot.items.find((item) => item.memberId === context.own.id);
  // Late, old and retry samples cannot advance a live detector.
  if (!live || live.sampleId !== sample.id || now - Date.parse(sample.capturedAt) > 30000) return;
  state.epochs ??= {};
  if (state.epochs[context.own.id] !== sample.payload.consentEpoch) {
    state.batteries[context.own.id] = { armed: true };
    const old = state.stragglers[context.own.id];
    state.stragglers[context.own.id] = { armed: old?.armed ?? true, lastAlertAt: old?.lastAlertAt };
    state.progress = state.progress.filter(([id]) => id !== context.own.id);
    state.epochs[context.own.id] = sample.payload.consentEpoch;
  }
  const result = await context.client.query<{
    revision: string;
    points: { lat: number; lon: number }[];
  }>('SELECT revision,points FROM ridr.routes WHERE ride_id=$1', [context.ride.id]);
  const saved = result.rows[0];
  if (
    state.routeRevision !== Number(saved?.revision ?? 0) ||
    state.threshold !== context.ride.straggler_metres
  ) {
    state.progress = [];
    state.stragglers = {};
    state.routeRevision = Number(saved?.revision ?? 0);
    state.threshold = context.ride.straggler_metres;
  }
  const route = saved ? new RouteProgress(saved.points, context.ride.started_at!.getTime()) : null;
  route?.restore(state.progress);
  const gaps = groupGaps(snapshot, now, route),
    passengers = new Set(snapshot.pairs.map((pair) => pair.pillionMemberId));
  const activeIds = new Set(snapshot.members.map((member) => member.id));
  for (const id of Object.keys(state.stragglers))
    if (!activeIds.has(id)) delete state.stragglers[id];
  for (const id of Object.keys(state.batteries)) if (!activeIds.has(id)) delete state.batteries[id];
  const warning = (
    kind: Warning['kind'],
    memberId: string,
    value: number,
    position: Warning['position'],
  ): Warning => ({
    id: randomUUID(),
    kind,
    memberId,
    value,
    position,
    createdAt: new Date(now).toISOString(),
  });
  for (const detail of gaps.details) {
    const detector = (state.stragglers[detail.memberId] ??= { armed: true });
    const item = snapshot.items.find((item) => item.memberId === detail.memberId);
    const gap = passengers.has(detail.memberId)
      ? null
      : detail.routeGapM === null
        ? null
        : -detail.routeGapM;
    straggler(detector, now, gap, context.ride.straggler_metres, () =>
      warning('straggler', detail.memberId, gap!, item!.position),
    );
  }
  state.progress = route?.exportState().filter(([id]) => activeIds.has(id)) ?? [];
  const own = (state.batteries[context.own.id] ??= { armed: true });
  battery(
    own,
    Date.parse(sample.capturedAt),
    sample.payload.batteryPercent,
    state.batteryThresholds[context.own.id] ?? 20,
    () =>
      warning('battery', context.own.id, sample.payload.batteryPercent!, sample.payload.position),
  );
  const liveIds = new Set(visibleWarnings(state, snapshot, now).map((item) => item.id));
  for (const device of Object.keys(state.acknowledgements))
    state.acknowledgements[device] = state.acknowledgements[device]!.filter((id) =>
      liveIds.has(id),
    );
  await save(context, state);
}
export async function changeAlertSettings(context: ManagementContext, change: AlertSettings) {
  const state = await loadAlerts(context);
  if (change.kind === 'straggler') {
    if (context.own.id !== context.ride.leader_member_id)
      throw new ApiError(403, 'FORBIDDEN', 'Only the ride leader can change this threshold.');
    if (Number(context.ride.revision) !== change.revision)
      throw new ApiError(412, 'REVISION_CONFLICT', 'Reload the ride before changing settings.');
    await stationary(context.client, context.own.id, {
      motion: change.motion!,
      capturedAt: change.capturedAt!,
    });
    await context.client.query(
      'UPDATE ridr.rides SET straggler_metres=$2,revision=revision+1 WHERE id=$1',
      [context.ride.id, change.value],
    );
    for (const detector of Object.values(state.stragglers)) {
      delete detector.since;
      delete detector.recoveredSince;
      delete detector.warning;
    }
    state.threshold = change.value;
  } else {
    state.batteryThresholds[context.own.id] = change.value as 10 | 20 | 30;
    state.batteries[context.own.id] = { armed: true };
  }
  await save(context, state);
  return { value: change.value };
}
export async function acknowledgeAlert(
  context: ManagementContext,
  deviceId: string,
  alertId: string,
  snapshot: LiveLocations,
) {
  const device = await context.client.query(
    'SELECT 1 FROM ridr.devices WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL',
    [deviceId, context.own.user_id],
  );
  if (!device.rowCount) throw new ApiError(403, 'FORBIDDEN', 'Register your device first.');
  const state = await loadAlerts(context);
  if (!(await currentAlerts(context, snapshot)).some((warning) => warning.id === alertId))
    throw new ApiError(404, 'NOT_FOUND', 'This warning is no longer current.');
  const ids = (state.acknowledgements[deviceId] ??= []);
  if (!ids.includes(alertId)) ids.push(alertId);
  await save(context, state);
  return { acknowledged: true };
}

export async function currentAlerts(context: ManagementContext, snapshot: LiveLocations) {
  const state = await loadAlerts(context),
    now = Date.parse(snapshot.serverTime);
  const saved = (
    await context.client.query<{ points: { lat: number; lon: number }[] }>(
      'SELECT points FROM ridr.routes WHERE ride_id=$1',
      [context.ride.id],
    )
  ).rows[0];
  const route = saved ? new RouteProgress(saved.points, context.ride.started_at!.getTime()) : null;
  route?.restore(state.progress);
  const gaps = groupGaps(snapshot, now, route),
    passengers = new Set(snapshot.pairs.map((pair) => pair.pillionMemberId));
  return visibleWarnings(state, snapshot, now).filter(
    (warning) =>
      warning.kind === 'battery' ||
      (!passengers.has(warning.memberId) &&
        (gaps.details.find((detail) => detail.memberId === warning.memberId)?.routeGapM ??
          Infinity) <= -context.ride.straggler_metres),
  );
}
