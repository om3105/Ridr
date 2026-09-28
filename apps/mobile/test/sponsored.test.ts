import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Profile } from '../src/auth/profile-api';
import { canRequestSponsored, fetchSponsoredCard, parseSponsoredCard } from '../src/sponsored/eligibility';

const profile: Profile = { id: 'owner', displayName: 'Rider', createdAt: '2026-09-28T00:00:00Z',
  revision: 1, activeMembership: null,
  entitlement: { adFree: false, evaluatedAt: '2026-09-28T00:00:00Z' }, deletionState: 'none' };
const card = { id: 'test_partner', title: 'Local bicycle repair',
  description: 'Book a tune-up.', url: 'https://sponsor.example/ridr' };

test('sponsored requests have one allowlist and fail closed during rides or uncertain account state', () => {
  const allowed = { placement: 'home', authState: 'ready', profile,
    hasActiveRide: false, isNative: true };
  assert.equal(canRequestSponsored(allowed), true);
  assert.equal(canRequestSponsored({ ...allowed, placement: 'history' }), true);
  assert.equal(canRequestSponsored({ ...allowed, placement: 'summary' }), false);
  assert.equal(canRequestSponsored({ ...allowed, placement: 'summary', summaryLoaded: true }), true);
  for (const placement of ['map', 'chat', 'sos', 'check-in', 'alerts'])
    assert.equal(canRequestSponsored({ ...allowed, placement }), false);
  assert.equal(canRequestSponsored({ ...allowed, hasActiveRide: true }), false);
  assert.equal(canRequestSponsored({ ...allowed, profile: { ...profile,
    activeMembership: { id: 'member', rideId: 'ride', sharingEnabled: false } } }), false);
  assert.equal(canRequestSponsored({ ...allowed, profile: { ...profile,
    entitlement: { ...profile.entitlement, adFree: true } } }), false);
  assert.equal(canRequestSponsored({ ...allowed, profile: null }), false);
  assert.equal(canRequestSponsored({ ...allowed, authState: 'restoring' }), false);
  assert.equal(canRequestSponsored({ ...allowed, authState: 'unavailable' }), false);
  assert.equal(canRequestSponsored({ ...allowed, isNative: false }), false);
});

test('sponsored response only accepts a bounded HTTPS card and no fill', () => {
  assert.deepEqual(parseSponsoredCard(card), card);
  assert.equal(parseSponsoredCard(null), null);
  for (const bad of [{ ...card, url: 'http://sponsor.example' },
    { ...card, title: 'a'.repeat(81) }, { ...card, safety: true }])
    assert.throws(() => parseSponsoredCard(bad));
});

test('sponsored request sends only placement and optional completed ride ID', async () => {
  const signal = new AbortController().signal;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/v1/sponsored-card');
    assert.equal(url.searchParams.get('placement'), 'summary');
    assert.equal(url.searchParams.get('rideId'), 'completed-ride');
    assert.equal(url.searchParams.size, 2);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access');
    assert.equal(init?.signal, signal);
    return Response.json({ data: card, requestId: 'request' });
  };
  assert.deepEqual(await fetchSponsoredCard({ apiUrl: 'https://api.example', accessToken: 'access',
    placement: 'summary', rideId: 'completed-ride', signal, fetcher }), card);
  assert.equal(await fetchSponsoredCard({ apiUrl: 'https://api.example', accessToken: 'access',
    placement: 'home', signal, fetcher: async () => Response.json({ data: null }) }), null);
});
