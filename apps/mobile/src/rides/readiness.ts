import { request, RideError, type RideClientOptions } from './api';
import type { MotionContext } from './models';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const token = /^[A-Za-z0-9_-]{43}$/;
export type PairReadiness = {
  id: string;
  revision: number;
  rider: { memberId: string; displayName: string };
  pillion: { memberId: string; displayName: string };
  ready: boolean;
  confirmedAt: string | null;
};
export type ReadinessOverview = {
  ownMemberId: string;
  ownPair: PairReadiness | null;
  leaderPairs: PairReadiness[] | null;
};
export type ScanChallenge = { challengeId: string; token: string; expiresAt: string };
export type ScanReceipt = { scanReceiptId: string; pairId: string; expiresAt: string };
export type ReadinessAttestation = {
  pairId: string;
  memberId: string;
  helmetConfirmed: true;
  ready: true;
  confirmedAt: string;
};

function bad(): never {
  throw new RideError('invalid', 'The readiness service returned an invalid response.');
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad();
  return value as Record<string, unknown>;
}
const date = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
function person(value: unknown) {
  const item = object(value);
  if (
    !uuid.test(String(item.memberId)) ||
    typeof item.displayName !== 'string' ||
    !item.displayName.trim()
  )
    bad();
  return item as { memberId: string; displayName: string };
}
function pairStatus(value: unknown): PairReadiness {
  const item = object(value);
  const rider = person(item.rider),
    pillion = person(item.pillion);
  if (
    !uuid.test(String(item.id)) ||
    !Number.isSafeInteger(item.revision) ||
    Number(item.revision) < 1 ||
    rider.memberId === pillion.memberId ||
    typeof item.ready !== 'boolean' ||
    (item.ready ? !date(item.confirmedAt) : item.confirmedAt !== null)
  )
    bad();
  return {
    id: item.id as string,
    revision: item.revision as number,
    rider,
    pillion,
    ready: item.ready as boolean,
    confirmedAt: item.confirmedAt as string | null,
  };
}
export function getReadiness(options: RideClientOptions, rideId: string) {
  return request(options, {
    path: `/v1/rides/${rideId}/readiness`,
    parse: (value): ReadinessOverview => {
      const data = object(value);
      if (
        !uuid.test(String(data.ownMemberId)) ||
        (data.leaderPairs !== null && !Array.isArray(data.leaderPairs))
      )
        bad();
      const ownPair = data.ownPair === null ? null : pairStatus(data.ownPair);
      const leaderPairs =
        data.leaderPairs === null ? null : (data.leaderPairs as unknown[]).map(pairStatus);
      if (
        ownPair &&
        ![ownPair.rider.memberId, ownPair.pillion.memberId].includes(data.ownMemberId as string)
      )
        bad();
      if (
        leaderPairs &&
        (new Set(leaderPairs.map((pair) => pair.id)).size !== leaderPairs.length ||
          (ownPair && !leaderPairs.some((pair) => pair.id === ownPair.id)))
      )
        bad();
      return { ownMemberId: data.ownMemberId as string, ownPair, leaderPairs };
    },
  });
}
export function readinessQr(rideId: string, pairId: string, challenge: ScanChallenge) {
  return `ridr-ready:v1:${rideId}:${pairId}:${challenge.challengeId}:${challenge.token}`;
}
export function parseReadinessQr(value: string, rideId: string, pairId: string) {
  const match =
    /^ridr-ready:v1:([0-9a-f-]{36}):([0-9a-f-]{36}):([0-9a-f-]{36}):([A-Za-z0-9_-]{43})$/.exec(
      value,
    );
  if (
    !match ||
    !uuid.test(match[1]!) ||
    !uuid.test(match[2]!) ||
    !uuid.test(match[3]!) ||
    match[1] !== rideId ||
    match[2] !== pairId ||
    !token.test(match[4]!)
  )
    throw new RideError('invalid', 'Scan a current readiness QR for your pair.');
  return { challengeId: match[3]!, scannedToken: match[4]! };
}
export function issueScan(
  options: RideClientOptions,
  rideId: string,
  pairId: string,
  motion: MotionContext,
) {
  return request(options, {
    path: `/v1/rides/${rideId}/pairs/${pairId}/scan-challenges`,
    method: 'POST',
    body: { roundId: null, ...motion },
    parse: (value): ScanChallenge => {
      const data = object(value);
      if (
        !uuid.test(String(data.challengeId)) ||
        !token.test(String(data.token)) ||
        !date(data.expiresAt)
      )
        bad();
      return data as ScanChallenge;
    },
  });
}
export function acceptScan(
  options: RideClientOptions,
  rideId: string,
  pairId: string,
  challengeId: string,
  scannedToken: string,
  motion: MotionContext,
  idempotencyKey: string,
) {
  return request(options, {
    path: `/v1/rides/${rideId}/pairs/${pairId}/scan-receipts`,
    method: 'POST',
    body: { challengeId, scannedToken, ...motion },
    idempotencyKey,
    parse: (value): ScanReceipt => {
      const data = object(value);
      if (!uuid.test(String(data.scanReceiptId)) || data.pairId !== pairId || !date(data.expiresAt))
        bad();
      return data as ScanReceipt;
    },
  });
}
export function attestReadiness(
  options: RideClientOptions,
  rideId: string,
  pairId: string,
  revision: number,
  scanReceiptId: string,
  motion: MotionContext,
  idempotencyKey: string,
) {
  return request(options, {
    path: `/v1/rides/${rideId}/pairs/${pairId}/readiness/me`,
    method: 'PUT',
    body: { helmetConfirmed: true, ready: true, scanReceiptId, ...motion },
    revision,
    idempotencyKey,
    parse: (value): ReadinessAttestation => {
      const data = object(value);
      if (
        data.pairId !== pairId ||
        !uuid.test(String(data.memberId)) ||
        data.helmetConfirmed !== true ||
        data.ready !== true ||
        !date(data.confirmedAt)
      )
        bad();
      return data as ReadinessAttestation;
    },
  });
}
