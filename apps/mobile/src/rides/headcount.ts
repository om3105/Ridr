import { request, RideError, type RideClientOptions } from './api';
import type { MotionContext } from './models';
import type { ScanChallenge } from './readiness';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const token = /^[A-Za-z0-9_-]{43}$/;
export type HeadcountPair = {
  id: string;
  riderName: string;
  pillionName: string;
  confirmed: boolean;
  confirmedAt: string | null;
};
export type HeadcountRound = {
  id: string;
  state: 'open' | 'completed';
  revision: number;
  openedAt: string;
  completedAt: string | null;
  pairingRevision: number;
  pairIds: string[];
  confirmedPairIds: string[];
  pairs: HeadcountPair[] | null;
  ownPair: HeadcountPair | null;
};
function invalid(): never {
  throw new RideError('invalid', 'The rest-stop response is invalid. Refresh and try again.');
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
function pair(value: unknown): HeadcountPair {
  const item = object(value);
  if (
    !uuid.test(String(item.id)) ||
    typeof item.riderName !== 'string' ||
    !item.riderName ||
    typeof item.pillionName !== 'string' ||
    !item.pillionName ||
    typeof item.confirmed !== 'boolean' ||
    (item.confirmed ? !date(item.confirmedAt) : item.confirmedAt !== null)
  )
    invalid();
  return item as HeadcountPair;
}
function parse(value: unknown): HeadcountRound | null {
  if (value === null) return null;
  const item = object(value);
  if (
    !uuid.test(String(item.id)) ||
    !['open', 'completed'].includes(String(item.state)) ||
    !Number.isSafeInteger(item.revision) ||
    Number(item.revision) < 1 ||
    !date(item.openedAt) ||
    (item.state === 'open' ? item.completedAt !== null : !date(item.completedAt)) ||
    !Number.isSafeInteger(item.pairingRevision) ||
    Number(item.pairingRevision) < 0 ||
    !Array.isArray(item.pairIds) ||
    !Array.isArray(item.confirmedPairIds) ||
    item.pairIds.some((id: unknown) => !uuid.test(String(id))) ||
    item.confirmedPairIds.some((id: unknown) => !uuid.test(String(id))) ||
    (item.pairs !== null && !Array.isArray(item.pairs))
  )
    invalid();
  const all = new Set(item.pairIds as string[]);
  if (
    all.size !== item.pairIds.length ||
    new Set(item.confirmedPairIds as string[]).size !== item.confirmedPairIds.length ||
    (item.confirmedPairIds as string[]).some((id) => !all.has(id))
  )
    invalid();
  const pairs = item.pairs === null ? null : (item.pairs as unknown[]).map(pair);
  const ownPair = item.ownPair === null ? null : pair(item.ownPair);
  if (pairs && (pairs.length !== item.pairIds.length || pairs.some((entry) => !all.has(entry.id))))
    invalid();
  if (ownPair && !all.has(ownPair.id)) invalid();
  return { ...item, pairs, ownPair } as HeadcountRound;
}
export function getHeadcount(options: RideClientOptions, rideId: string) {
  return request(options, { path: `/v1/rides/${rideId}/headcounts/current`, parse });
}
export function beginHeadcount(
  options: RideClientOptions,
  rideId: string,
  motion: MotionContext,
  key: string,
) {
  return request(options, {
    path: `/v1/rides/${rideId}/headcounts`,
    method: 'POST',
    body: motion,
    idempotencyKey: key,
    parse: (value) => parse(value) ?? invalid(),
  });
}
export function headcountQr(
  rideId: string,
  roundId: string,
  pairId: string,
  challenge: ScanChallenge,
) {
  return `ridr-headcount:v1:${rideId}:${roundId}:${pairId}:${challenge.challengeId}:${challenge.token}`;
}
export function parseHeadcountQr(value: string, rideId: string, roundId: string) {
  const match =
    /^ridr-headcount:v1:([0-9a-f-]{36}):([0-9a-f-]{36}):([0-9a-f-]{36}):([0-9a-f-]{36}):([A-Za-z0-9_-]{43})$/.exec(
      value,
    );
  if (
    !match ||
    match.slice(1, 5).some((id) => !uuid.test(id!)) ||
    match[1] !== rideId ||
    match[2] !== roundId ||
    !token.test(match[5]!)
  )
    throw new RideError('invalid', 'Scan a current QR for this rest-stop round.');
  return { pairId: match[3]!, challengeId: match[4]!, scannedToken: match[5]! };
}
export function issueHeadcountScan(
  options: RideClientOptions,
  rideId: string,
  roundId: string,
  pairId: string,
  motion: MotionContext,
) {
  return request(options, {
    path: `/v1/rides/${rideId}/pairs/${pairId}/scan-challenges`,
    method: 'POST',
    body: { roundId, ...motion },
    parse: (value): ScanChallenge => {
      const item = object(value);
      if (
        !uuid.test(String(item.challengeId)) ||
        !token.test(String(item.token)) ||
        !date(item.expiresAt)
      )
        invalid();
      return item as ScanChallenge;
    },
  });
}
export function confirmHeadcount(
  options: RideClientOptions,
  rideId: string,
  roundId: string,
  pairId: string,
  scanReceiptId: string,
  motion: MotionContext,
  key: string,
) {
  return request(options, {
    path: `/v1/rides/${rideId}/headcounts/${roundId}/pairs/${pairId}`,
    method: 'PUT',
    body: { scanReceiptId, ...motion },
    idempotencyKey: key,
    parse: (value) => parse(value) ?? invalid(),
  });
}
export function completeHeadcount(
  options: RideClientOptions,
  rideId: string,
  roundId: string,
  revision: number,
  motion: MotionContext,
  key: string,
) {
  return request(options, {
    path: `/v1/rides/${rideId}/headcounts/${roundId}/complete`,
    method: 'POST',
    body: motion,
    revision,
    idempotencyKey: key,
    parse: (value) => parse(value) ?? invalid(),
  });
}
