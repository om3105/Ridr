import { request, type RideClientOptions } from '../rides/api';

export interface ChatMessage {
  id: string;
  rideId: string;
  sequence: number;
  authorMemberId: string;
  authorName: string;
  kind: 'text' | 'pin';
  text: string;
  coordinate: { lat: number; lon: number } | null;
  capturedAt: string;
  acceptedAt: string;
}
export interface Draft {
  v: 1;
  type: 'message.text' | 'message.pin';
  id: string;
  rideId: string;
  capturedAt: string;
  payload: {
    text: string;
    motion: { state: 'stopped'; source: 'speed' | 'activity'; observedAt: string };
    coordinate?: { lat: number; lon: number };
  };
}
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const time = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
export function parseChatMessage(value: unknown, rideId: string): ChatMessage {
  if (!value || typeof value !== 'object') throw new Error('Invalid ride message.');
  const row = value as Partial<ChatMessage>;
  if (
    !uuid(row.id) ||
    row.rideId !== rideId ||
    !Number.isSafeInteger(row.sequence) ||
    row.sequence! < 1 ||
    !uuid(row.authorMemberId) ||
    typeof row.authorName !== 'string' ||
    !row.authorName ||
    (row.kind !== 'text' && row.kind !== 'pin') ||
    typeof row.text !== 'string' ||
    [...row.text].length < 1 ||
    [...row.text].length > 1000 ||
    !time(row.capturedAt) ||
    !time(row.acceptedAt) ||
    (row.kind === 'text' && row.coordinate !== null) ||
    (row.kind === 'pin' &&
      (!row.coordinate ||
        !Number.isFinite(row.coordinate.lat) ||
        !Number.isFinite(row.coordinate.lon) ||
        Math.abs(row.coordinate.lat) > 90 ||
        Math.abs(row.coordinate.lon) > 180))
  )
    throw new Error('Invalid ride message.');
  return row as ChatMessage;
}
export async function getMessages(options: RideClientOptions, rideId: string, afterSequence = 0) {
  return request(options, {
    path: `/v1/rides/${rideId}/messages?afterSequence=${afterSequence}&limit=100`,
    parse: (value) => {
      if (!value || typeof value !== 'object') throw new Error('Invalid chat history.');
      const page = value as { items?: unknown; nextSequence?: unknown };
      if (
        !Array.isArray(page.items) ||
        page.items.length > 100 ||
        !(
          page.nextSequence === null ||
          (Number.isSafeInteger(page.nextSequence) && Number(page.nextSequence) > afterSequence)
        )
      )
        throw new Error('Invalid chat history.');
      const items = page.items.map((row) => parseChatMessage(row, rideId));
      if (
        items.some(
          (item, index) =>
            item.sequence <= afterSequence ||
            (index > 0 && item.sequence <= items[index - 1]!.sequence),
        )
      )
        throw new Error('Invalid chat order.');
      return { items, nextSequence: page.nextSequence as number | null };
    },
  });
}
export function sendMessage(options: RideClientOptions, draft: Draft) {
  return request(options, {
    path: `/v1/rides/${draft.rideId}/events`,
    method: 'POST',
    body: { event: draft },
    idempotencyKey: draft.id,
    parse: (value) => parseChatMessage(value, draft.rideId),
  });
}
