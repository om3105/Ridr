import { request, RideError, type RideClientOptions } from './api';
import type { MotionContext } from './models';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export type PairInvitation = { pairInvitationId: string; token: string; expiresAt: string };
export type PairPreview = {
  pairInvitationId: string;
  counterpart: { memberId: string; displayName: string; physicalRole: 'rider' | 'pillion' };
  expiresAt: string;
};
export type PairResult = {
  pair: { id: string; riderMemberId: string; pillionMemberId: string; createdAt: string };
  readinessScanReceiptId: string;
  readinessScanExpiresAt: string;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RideError('invalid', 'The pairing service returned an invalid response.');
  return value as Record<string, unknown>;
}
function date(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function parseInvitation(value: unknown): PairInvitation {
  const data = object(value);
  if (
    !uuid.test(String(data.pairInvitationId)) ||
    !tokenPattern.test(String(data.token)) ||
    !date(data.expiresAt)
  )
    throw new RideError('invalid', 'The pairing service returned an invalid QR.');
  return data as PairInvitation;
}
function parsePreview(value: unknown): PairPreview {
  const data = object(value);
  const person = object(data.counterpart);
  if (
    !uuid.test(String(data.pairInvitationId)) ||
    !uuid.test(String(person.memberId)) ||
    typeof person.displayName !== 'string' ||
    !['rider', 'pillion'].includes(String(person.physicalRole)) ||
    !date(data.expiresAt)
  )
    throw new RideError('invalid', 'The pairing preview is invalid.');
  return data as PairPreview;
}
function parsePair(value: unknown): PairResult {
  const data = object(value);
  const pair = object(data.pair);
  if (
    !uuid.test(String(pair.id)) ||
    !uuid.test(String(pair.riderMemberId)) ||
    !uuid.test(String(pair.pillionMemberId)) ||
    !date(pair.createdAt) ||
    !uuid.test(String(data.readinessScanReceiptId)) ||
    !date(data.readinessScanExpiresAt)
  )
    throw new RideError('invalid', 'The pairing receipt is invalid.');
  return data as PairResult;
}
export function pairQr(rideId: string, token: string) {
  return `ridr-pair:v1:${rideId}:${token}`;
}
export function currentPair(options: RideClientOptions, rideId: string) {
  return request(options, {
    path: `/v1/rides/${rideId}/pairs/me`,
    parse: (value) => {
      const data = object(value);
      if (data.pair === null) return null;
      const pair = object(data.pair);
      if (
        !uuid.test(String(pair.id)) ||
        typeof pair.partnerName !== 'string' ||
        !pair.partnerName.trim()
      )
        throw new RideError('invalid', 'The current pair response is invalid.');
      return { id: pair.id as string, partnerName: pair.partnerName };
    },
  });
}
export function parsePairQr(value: string, rideId: string): string {
  const match = /^ridr-pair:v1:([0-9a-f-]{36}):([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match || !uuid.test(match[1]!) || match[1] !== rideId || !tokenPattern.test(match[2]!))
    throw new RideError('invalid', 'Scan a pair QR for this ride.');
  return match[2]!;
}
export function issuePairInvitation(
  options: RideClientOptions,
  rideId: string,
  motion: MotionContext,
) {
  return request(options, {
    path: `/v1/rides/${rideId}/pair-invitations`,
    method: 'POST',
    body: motion,
    parse: parseInvitation,
  });
}
export function previewPairInvitation(
  options: RideClientOptions,
  rideId: string,
  token: string,
  motion: MotionContext,
) {
  return request(options, {
    path: `/v1/rides/${rideId}/pair-invitations/preview`,
    method: 'POST',
    body: { token, ...motion },
    parse: parsePreview,
  });
}
export function acceptPair(
  options: RideClientOptions,
  rideId: string,
  preview: PairPreview,
  token: string,
  motion: MotionContext,
  idempotencyKey: string,
) {
  return request(options, {
    path: `/v1/rides/${rideId}/pairs`,
    method: 'POST',
    body: { pairInvitationId: preview.pairInvitationId, token, consent: true, ...motion },
    idempotencyKey,
    parse: parsePair,
  });
}
export function unpair(
  options: RideClientOptions,
  rideId: string,
  pairId: string,
  motion: MotionContext,
  idempotencyKey: string,
) {
  return request(options, {
    path: `/v1/rides/${rideId}/pairs/${pairId}`,
    method: 'DELETE',
    body: motion,
    idempotencyKey,
    noContent: true,
    parse: () => undefined,
  });
}
