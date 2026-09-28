import type { Profile } from '../auth/profile-api';

export type SponsoredPlacement = 'home' | 'history' | 'summary';
export type SponsoredCardData = { id: string; title: string; description: string; url: string };

export function canRequestSponsored(input: {
  placement: string;
  authState: string;
  profile: Profile | null;
  hasActiveRide: boolean;
  summaryLoaded?: boolean;
  isNative: boolean;
}) {
  return input.isNative &&
    ['home', 'history', 'summary'].includes(input.placement) &&
    (input.placement !== 'summary' || input.summaryLoaded === true) &&
    input.authState === 'ready' && !!input.profile &&
    input.profile.activeMembership === null &&
    input.profile.entitlement.adFree === false &&
    Number.isFinite(Date.parse(input.profile.entitlement.evaluatedAt)) &&
    !input.hasActiveRide;
}

export function parseSponsoredCard(value: unknown): SponsoredCardData | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid sponsor card.');
  const card = value as Record<string, unknown>;
  if (Object.keys(card).sort().join(',') !== 'description,id,title,url' ||
      typeof card.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(card.id) ||
      typeof card.title !== 'string' || !card.title.trim() || card.title.length > 80 ||
      typeof card.description !== 'string' || !card.description.trim() || card.description.length > 200 ||
      typeof card.url !== 'string') throw new Error('Invalid sponsor card.');
  try {
    const url = new URL(card.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.href !== card.url)
      throw new Error();
  } catch { throw new Error('Invalid sponsor card.'); }
  return card as SponsoredCardData;
}

export async function fetchSponsoredCard(input: {
  apiUrl: string; accessToken: string; placement: SponsoredPlacement; rideId?: string;
  signal: AbortSignal; fetcher?: typeof fetch;
}) {
  const query = new URLSearchParams({ placement: input.placement });
  if (input.placement === 'summary' && input.rideId) query.set('rideId', input.rideId);
  const response = await (input.fetcher ?? fetch)(
    `${input.apiUrl.replace(/\/$/, '')}/v1/sponsored-card?${query}`,
    { headers: { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' },
      signal: input.signal, cache: 'no-store' },
  );
  if (!response.ok) return null;
  const envelope = await response.json() as { data?: unknown };
  return parseSponsoredCard(envelope.data);
}
