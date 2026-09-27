import { request, RideError, type RideClientOptions } from '../rides/api';

export interface HistoryItem {
  rideId: string;
  rideName: string;
  memberId: string;
  startedAt: string;
  endedAt: string;
  recordedDistanceM: number;
  participationDurationSeconds: number;
  elapsedPaceMinPerKm: number | null;
  updatedAt: string;
  expiresAt: string;
}

export interface HistoryPage {
  items: HistoryItem[];
  nextCursor: string | null;
}

const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nonnegative = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function parseHistoryPage(value: unknown, limit: number, accountId: string): HistoryPage {
  const page = value as HistoryPage | null;
  if (
    !page ||
    typeof page !== 'object' ||
    !Array.isArray(page.items) ||
    page.items.length > limit ||
    (page.nextCursor !== null &&
      (typeof page.nextCursor !== 'string' || page.nextCursor.length > 1024))
  )
    throw new RideError('invalid', 'The ride history response is invalid. Refresh it.');
  const seen = new Set<string>();
  for (const item of page.items) {
    if (
      !item ||
      !uuid(item.rideId) ||
      seen.has(item.rideId) ||
      !uuid(item.memberId) ||
      item.memberId !== accountId ||
      typeof item.rideName !== 'string' ||
      ![item.startedAt, item.endedAt, item.updatedAt, item.expiresAt].every(date) ||
      !nonnegative(item.recordedDistanceM) ||
      !Number.isSafeInteger(item.participationDurationSeconds) ||
      item.participationDurationSeconds < 0 ||
      (item.elapsedPaceMinPerKm !== null && !nonnegative(item.elapsedPaceMinPerKm))
    )
      throw new RideError('invalid', 'The ride history response is invalid. Refresh it.');
    seen.add(item.rideId);
  }
  return page;
}

export function getRideHistory(
  options: RideClientOptions,
  { limit = 50, cursor }: { limit?: number; cursor?: string } = {},
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (cursor && cursor.length > 1024))
    throw new RideError('invalid', 'The ride history request is invalid.');
  const query = `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  return request(options, {
    path: `/v1/history?${query}`,
    parse: (value) => parseHistoryPage(value, limit, options.userId),
  });
}
