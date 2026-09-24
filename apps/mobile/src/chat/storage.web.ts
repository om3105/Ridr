import type { Draft } from './api';
import type { PendingMessage, PendingState } from './storage';
const items = new Map<string, PendingMessage>();
export async function listPending(_userId: string, rideId: string) {
  return [...items.values()].filter((item) => item.draft.rideId === rideId);
}
export async function enqueue(_userId: string, draft: Draft) {
  items.set(draft.id, { draft, state: 'pending' });
}
export async function setPendingState(id: string, state: PendingState) {
  const item = items.get(id);
  if (item) item.state = state;
}
export async function removePending(id: string) {
  items.delete(id);
}
export async function clearChatQueue() {
  items.clear();
}
