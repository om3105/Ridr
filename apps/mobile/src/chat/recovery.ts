import type { Draft } from './api';
export function draftRecovery(draft: Draft, active: boolean, now: number): 'retry' | 'unsent' {
  const captured = Date.parse(draft.capturedAt);
  return active && Number.isFinite(captured) && captured <= now + 5000 && now - captured <= 86400000
    ? 'retry'
    : 'unsent';
}
