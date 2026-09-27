import { request, RideError, type RideClientOptions } from '../rides/api';

export type StatusLink = {
  linkId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
};
export type CreatedStatusLink = StatusLink & { url: string | null; tokenAvailable: boolean };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function parseLink(value: unknown): StatusLink {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RideError('invalid', 'The status link response is invalid.');
  const row = value as Record<string, unknown>;
  if (
    !uuid.test(String(row.linkId)) ||
    ![row.createdAt, row.expiresAt].every(
      (date) => typeof date === 'string' && Number.isFinite(Date.parse(date)),
    ) ||
    (row.revokedAt !== null &&
      (typeof row.revokedAt !== 'string' || !Number.isFinite(Date.parse(row.revokedAt))))
  )
    throw new RideError('invalid', 'The status link response is invalid.');
  return row as StatusLink;
}
export function listStatusLinks(options: RideClientOptions, rideId: string) {
  return request(options, {
    path: `/v1/rides/${rideId}/status-links`,
    parse: (value): StatusLink[] => {
      if (!Array.isArray(value) || value.length > 100)
        throw new RideError('invalid', 'The status link list is invalid.');
      return value.map(parseLink);
    },
  });
}
export function createStatusLink(
  options: RideClientOptions,
  rideId: string,
  lifetimeHours: 1 | 4 | 8 | 24,
  key: string,
) {
  return request(options, {
    path: `/v1/rides/${rideId}/status-links`,
    method: 'POST',
    idempotencyKey: key,
    body: { lifetimeHours },
    parse: (value): CreatedStatusLink => {
      const link = parseLink(value);
      const row = value as Record<string, unknown>;
      if (
        typeof row.tokenAvailable !== 'boolean' ||
        (row.url !== null &&
          (typeof row.url !== 'string' ||
            !/^https?:\/\/[^#]+\/v1\/status#[A-Za-z0-9_-]{43}$/.test(row.url))) ||
        row.tokenAvailable !== (row.url !== null)
      )
        throw new RideError('invalid', 'The status link response is invalid.');
      return { ...link, url: row.url as string | null, tokenAvailable: row.tokenAvailable };
    },
  });
}
export function revokeStatusLink(options: RideClientOptions, rideId: string, linkId: string) {
  return request(options, {
    path: `/v1/rides/${rideId}/status-links/${linkId}`,
    method: 'DELETE',
    noContent: true,
    parse: () => undefined,
  });
}
