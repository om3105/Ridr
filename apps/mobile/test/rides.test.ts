import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redirectSystemPath } from '../app/+native-intent';
import {
  createRide,
  getRide,
  joinRide,
  listRides,
  previewInvitation,
  revokeInvitation,
  RideError,
  rotateInvitation,
} from '../src/rides/api';
import {
  InvitationError,
  parseInvitation,
  parseInvitationLink,
  type InvitationCredential,
} from '../src/rides/invitations';
import type { Membership, Ride, RideInvitation, RideMembership } from '../src/rides/models';
import {
  clearIncomingInvitation,
  clearRideSession,
  invitationVersion,
  peekInvitation,
  receiveInvitation,
  rideSessionGeneration,
  subscribeInvitation,
} from '../src/rides/private-session';

const userId = '3b8615b6-18c2-4f35-9b57-736a672b3f28';
const rideId = '48d6db19-8889-4a35-964a-d82e57fe36cb';
const memberId = '084af2e4-9baf-4dca-b81b-a24344623361';
const leaderId = '670b44f2-e22b-4893-980f-30fca30bfaed';
const otherId = 'cd1fe9f4-ac48-4eed-8680-56d8b073fbcf';
const key = 'c7d885fb-4bd0-4b80-9aac-d0759bfb9e74';
const code = 'ABCDEFGH23';
const token = 't'.repeat(43);
const url = `ridr://join?token=${token}`;
const createdAt = '2026-09-15T00:00:00Z';
const options = { apiUrl: 'http://127.0.0.1:3000', accessToken: 'private-access-token', userId };
const ride = (overrides: Partial<Ride> = {}): Ride => ({
  id: rideId,
  name: 'Morning ride',
  transport: 'motorcycle',
  state: 'lobby',
  leaderMemberId: leaderId,
  createdAt,
  startedAt: null,
  endedAt: null,
  revision: 1,
  settings: { broadcastIntervalSeconds: 10, stragglerDistanceM: 500 },
  ...overrides,
});
const membership = (overrides: Partial<Membership> = {}): Membership => ({
  id: memberId,
  rideId,
  profileId: userId,
  displayName: 'Maya',
  role: 'rider',
  physicalRole: 'rider',
  joinedAt: createdAt,
  leftAt: null,
  sharingEnabled: false,
  consentEpoch: 0,
  revision: 1,
  ...overrides,
});
const joined = (
  rideOverrides: Partial<Ride> = {},
  memberOverrides: Partial<Membership> = {},
): RideMembership => ({
  ride: ride(rideOverrides),
  membership: membership(memberOverrides),
});
const invitation = (overrides: Partial<RideInvitation> = {}): RideInvitation => ({
  id: otherId,
  code,
  url,
  expiresAt: '2026-09-16T00:00:00Z',
  tokenAvailable: true,
  ...overrides,
});
const created = () => ({ ...joined({}, { id: leaderId, role: 'leader' }), invite: invitation() });
const preview = () => ({
  rideId,
  rideName: 'Morning ride',
  transport: 'motorcycle',
  state: 'lobby',
  availableRoles: ['rider', 'pillion'],
  expiresAt: '2026-09-16T00:00:00Z',
});
const snapshot = () => ({
  ...joined(),
  members: [membership(), membership({ id: leaderId, profileId: otherId, role: 'leader' })],
});
const success = (data: unknown) => Response.json({ data, requestId: key });
const withResponse = (data: unknown) => ({ ...options, fetcher: async () => success(data) });
const isInvalid = (error: unknown) => error instanceof RideError && error.code === 'invalid';
const joinChange = {
  rideId,
  credential: { code },
  physicalRole: 'rider',
  idempotencyKey: key,
} as const;
const createChange = {
  name: ' Morning ride ',
  transport: 'motorcycle',
  idempotencyKey: key,
} as const;

test('invitation entry normalizes typed codes and accepts only exact Ridr invitation links', () => {
  for (const input of [code, 'abcdefgh23', ' abcd-ef gh23 ']) {
    assert.deepEqual(parseInvitation(input), { code });
  }
  for (const scheme of ['ridr', 'ridr-dev']) {
    const link = `${scheme}://join?token=${token}`;
    assert.deepEqual(parseInvitation(link), { token });
    assert.deepEqual(parseInvitationLink(link), { token });
  }
  for (const input of [
    '',
    'ABCDEFGHI2',
    'ABCDEFGH20',
    'ABCDEFGH2',
    'ABCDEFGH234',
    'A'.repeat(513),
    `https://example.test/join?token=${token}`,
    `javascript:${url}`,
    `file://${token}`,
    `ridr://other?token=${token}`,
    `ridr://join/?token=${token}`,
    `ridr://join?token=${token}&x=1`,
    `${url}#fragment`,
    `ridr://join?token=${token}&token=${token}`,
    `ridr://join?token=${token.slice(1)}`,
    `ridr://join?token=%74${token.slice(1)}`,
    `ridr://user@join?token=${token}`,
  ]) {
    assert.equal(parseInvitationLink(input), null, input);
    assert.throws(() => parseInvitation(input), InvitationError, input);
  }
});

test('preview and join send invitation credentials in POST bodies and never in URLs', async () => {
  const requests: { input: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ input: String(input), init: init! });
    return success(String(input).endsWith('/preview') ? preview() : joined());
  };
  for (const credential of [{ code }, { token }]) {
    await previewInvitation({ ...options, fetcher }, credential);
    await joinRide({ ...options, fetcher }, { ...joinChange, credential });
  }
  assert.deepEqual(
    requests.map(({ input }) => input),
    [
      `${options.apiUrl}/v1/invites/preview`,
      `${options.apiUrl}/v1/rides/${rideId}/join`,
      `${options.apiUrl}/v1/invites/preview`,
      `${options.apiUrl}/v1/rides/${rideId}/join`,
    ],
  );
  assert.deepEqual(
    requests.map(({ init }) => JSON.parse(String(init.body))),
    [
      { code },
      { inviteCode: code, physicalRole: 'rider' },
      { token },
      { inviteToken: token, physicalRole: 'rider' },
    ],
  );
  for (const { input, init } of requests) {
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${options.accessToken}`);
    assert.equal(new Headers(init.headers).get('content-type'), 'application/json');
    assert.ok(
      !input.includes(code) && !input.includes(token) && !input.includes(options.accessToken),
    );
  }
});

test('creation trims its name and returns a verified leader membership', async () => {
  let request: RequestInit | undefined;
  const result = await createRide(
    {
      ...options,
      fetcher: async (_input, init) => {
        request = init;
        return success(created());
      },
    },
    createChange,
  );
  assert.deepEqual(JSON.parse(String(request?.body)), {
    name: 'Morning ride',
    transport: 'motorcycle',
  });
  assert.equal(result.membership.role, 'leader');
  assert.equal(result.membership.sharingEnabled, false);
  assert.equal(result.invite.url, url);
});

test('an unconfirmed mutation preserves its idempotency key, revision and payload on retry', async () => {
  const requests: RequestInit[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    requests.push(init!);
    if (requests.length === 1) throw new Error(`network failure ${token}`);
    return success(invitation());
  };
  const change = { rideId, revision: 7, idempotencyKey: key };
  await assert.rejects(rotateInvitation({ ...options, fetcher }, change), (error: unknown) => {
    assert.ok(error instanceof RideError);
    assert.equal(error.code, 'unavailable');
    assert.equal(error.unconfirmed, true);
    assert.equal(error.retryable, true);
    assert.ok(!error.message.includes(token));
    return true;
  });
  await rotateInvitation({ ...options, fetcher }, change);
  assert.deepEqual(requests[0]?.headers, requests[1]?.headers);
  assert.equal(requests[0]?.body, requests[1]?.body);
  assert.equal(new Headers(requests[1]?.headers).get('idempotency-key'), key);
  assert.equal(new Headers(requests[1]?.headers).get('if-match'), '"7"');
  assert.deepEqual(JSON.parse(String(requests[1]?.body)), { rotate: true });
});

test('create, join and revoke retain the caller’s receipt key on repeat requests', async () => {
  for (const operation of ['create', 'join', 'revoke'] as const) {
    const requests: RequestInit[] = [];
    const client = {
      ...options,
      fetcher: async (_input: unknown, init?: RequestInit) => {
        requests.push(init!);
        return operation === 'revoke'
          ? new Response(null, { status: 204 })
          : success(operation === 'create' ? created() : joined());
      },
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      if (operation === 'create') await createRide(client, createChange);
      else if (operation === 'join') await joinRide(client, joinChange);
      else await revokeInvitation(client, { rideId, idempotencyKey: key });
    }
    assert.equal(new Headers(requests[0]?.headers).get('idempotency-key'), key);
    assert.deepEqual(requests[0]?.headers, requests[1]?.headers);
    assert.equal(requests[0]?.body, requests[1]?.body);
  }
});

test('existing membership is accepted with its actual role and sharing state after a repeated join', async () => {
  const data = joined(
    { state: 'active', startedAt: createdAt },
    { physicalRole: 'pillion', role: 'pillion', sharingEnabled: true, consentEpoch: 2 },
  );
  assert.deepEqual(await joinRide(withResponse(data), joinChange), data);
});

test('join rejects another actor, another ride and invalid membership or ride responses', async () => {
  const cases: unknown[] = [
    joined({}, { profileId: otherId }),
    joined({ id: otherId }, { rideId: otherId }),
    joined({}, { rideId: otherId }),
    joined({}, { role: 'leader' }),
    joined({ state: 'ended', endedAt: createdAt }),
    joined({ transport: 'cycling' }, { physicalRole: 'pillion', role: 'pillion' }),
    joined({}, { sharingEnabled: true }),
    joined({}, { leftAt: createdAt }),
    joined({}, { revision: 0 }),
    joined({}, { consentEpoch: -1 }),
    joined({ createdAt: '2026-02-30T00:00:00Z' }),
    joined({ state: 'active', startedAt: null }),
    joined({ settings: { broadcastIntervalSeconds: 10, stragglerDistanceM: 199 } }),
    { ...joined(), privateToken: token },
    { ...joined(), membership: null },
  ];
  for (const data of cases) {
    await assert.rejects(
      joinRide(withResponse(data), joinChange),
      (error: unknown) =>
        isInvalid(error) && (error as RideError).unconfirmed && (error as RideError).retryable,
    );
  }
});

test('creation rejects mismatched requested details, nonleaders and another account', async () => {
  for (const data of [
    { ...created(), ride: ride({ name: 'Different ride' }) },
    { ...created(), ride: ride({ transport: 'car' }) },
    { ...created(), ride: ride({ state: 'active', startedAt: createdAt }) },
    { ...created(), membership: membership() },
    { ...created(), membership: membership({ id: leaderId, role: 'leader', profileId: otherId }) },
  ]) {
    await assert.rejects(createRide(withResponse(data), createChange), isInvalid);
  }
});

test('invitation receipt replay must omit both raw credentials when unavailable', async () => {
  const replay = { id: otherId, expiresAt: '2026-09-16T00:00:00Z', tokenAvailable: false };
  assert.deepEqual(
    (await createRide(withResponse({ ...created(), invite: replay }), createChange)).invite,
    replay,
  );
  assert.deepEqual(
    await rotateInvitation(withResponse(replay), { rideId, revision: 1, idempotencyKey: key }),
    replay,
  );
  for (const invite of [
    { ...replay, code },
    { ...replay, url },
    { ...replay, code: null },
    { ...replay, url: '' },
    invitation({ code: 'INVALID' }),
    invitation({ url: `https://example.test/?token=${token}` }),
    { ...invitation(), rawToken: token },
    invitation({ expiresAt: 'tomorrow' }),
  ]) {
    await assert.rejects(
      createRide(withResponse({ ...created(), invite }), createChange),
      isInvalid,
    );
  }
});

test('preview rejects malformed roles, ended rides and unexpected private fields', async () => {
  for (const data of [
    { ...preview(), availableRoles: [] },
    { ...preview(), availableRoles: ['leader'] },
    { ...preview(), availableRoles: ['rider', 'rider'] },
    { ...preview(), transport: 'car' },
    { ...preview(), state: 'ended' },
    { ...preview(), rideId: 'not-a-uuid' },
    { ...preview(), expiresAt: '2026-02-30T00:00:00Z' },
    { ...preview(), inviteToken: token },
  ]) {
    await assert.rejects(previewInvitation(withResponse(data), { code }), isInvalid);
  }
  const cycling = { ...preview(), transport: 'cycling', availableRoles: ['rider'] };
  assert.deepEqual(await previewInvitation(withResponse(cycling), { code }), cycling);
});

test('service errors are actionable without exposing raw credentials or provider messages', async () => {
  for (const [status, serverCode, expectedCode] of [
    [401, 'SESSION_REVOKED', 'unauthorized'],
    [403, 'ACCOUNT_DELETING', 'blocked'],
    [404, 'INVITE_REVOKED', 'not_found'],
    [410, 'INVITE_EXPIRED', 'expired'],
    [409, 'RIDE_FULL', 'full'],
    [409, 'ACTIVE_RIDE_CONFLICT', 'conflict'],
    [412, 'REVISION_MISMATCH', 'conflict'],
    [428, 'REVISION_REQUIRED', 'conflict'],
    [422, 'INVALID_INPUT', 'invalid'],
    [429, 'RATE_LIMITED', 'rate_limited'],
    [503, 'INTERNAL', 'unavailable'],
  ] as const) {
    const client = {
      ...options,
      fetcher: async () =>
        Response.json(
          {
            error: {
              code: serverCode,
              message: `${options.accessToken} ${code} ${token}`,
              detail: url,
            },
          },
          { status, headers: { 'Retry-After': '30' } },
        ),
    };
    await assert.rejects(joinRide(client, joinChange), (error: unknown) => {
      assert.ok(error instanceof RideError);
      assert.equal(error.code, expectedCode);
      for (const secret of [options.accessToken, code, token, url])
        assert.ok(!error.message.includes(secret));
      assert.equal(error.retryAfterSeconds, status === 429 ? 30 : null);
      assert.equal(error.unconfirmed, status === 503);
      return true;
    });
  }
});

test('rate limits ignore unsafe Retry-After values and malformed error bodies retain status meaning', async () => {
  for (const retry of [
    '-1',
    '1.5',
    'Infinity',
    '9007199254740992',
    'Wed, 16 Sep 2026 00:00:00 GMT',
  ]) {
    await assert.rejects(
      previewInvitation(
        {
          ...options,
          fetcher: async () =>
            new Response('not JSON', { status: 429, headers: { 'Retry-After': retry } }),
        },
        { code },
      ),
      (error: unknown) =>
        error instanceof RideError &&
        error.code === 'rate_limited' &&
        error.retryAfterSeconds === null &&
        error.retryable &&
        !error.unconfirmed,
    );
  }
  await assert.rejects(
    previewInvitation(
      { ...options, fetcher: async () => new Response('private server failure', { status: 401 }) },
      { code },
    ),
    (error: unknown) => error instanceof RideError && error.code === 'unauthorized',
  );
});

test('malformed success envelopes remain unconfirmed for mutations', async () => {
  const responses = [
    () => new Response('not JSON'),
    () => Response.json({ data: joined() }),
    () => Response.json({ data: joined(), requestId: 'invalid' }),
    () => Response.json({ data: joined(), requestId: key, token }),
    () => Response.json({ data: [], requestId: key }),
  ];
  for (const response of responses) {
    await assert.rejects(
      joinRide({ ...options, fetcher: async () => response() }, joinChange),
      (error: unknown) => isInvalid(error) && (error as RideError).unconfirmed,
    );
  }
  await assert.rejects(
    revokeInvitation(withResponse({}), { rideId, idempotencyKey: key }),
    isInvalid,
  );
});

test('ride collection validates actor, distinct live rides, page size and cursors', async () => {
  const nextCursor = 'encoded_cursor-without-padding';
  let requestUrl = '';
  const data = { items: [joined()], nextCursor };
  const result = await listRides(
    {
      ...options,
      fetcher: async (input) => {
        requestUrl = String(input);
        return success(data);
      },
    },
    { limit: 1, cursor: nextCursor },
  );
  assert.deepEqual(result, data);
  assert.equal(
    requestUrl,
    `${options.apiUrl}/v1/rides?limit=1&cursor=encoded_cursor-without-padding`,
  );
  assert.deepEqual(await listRides(withResponse({ items: [], nextCursor: null })), {
    items: [],
    nextCursor: null,
  });
  for (const invalid of [
    { items: [joined(), joined()], nextCursor: null },
    { items: [joined({}, { profileId: otherId })], nextCursor: null },
    { items: [joined({ state: 'ended', endedAt: createdAt })], nextCursor: null },
    { items: [joined()], nextCursor: '' },
    { items: [], nextCursor: 'line\nbreak' },
    { items: [], nextCursor: 'x'.repeat(1025) },
    { items: [], nextCursor: 'encoded/value+with=padding' },
    { items: null, nextCursor: null },
    { items: [], nextCursor: null, token },
  ]) {
    await assert.rejects(listRides(withResponse(invalid)), isInvalid);
  }
  await assert.rejects(
    listRides(withResponse({ items: [joined()], nextCursor: null }), { limit: 0 }),
    isInvalid,
  );
  await assert.rejects(
    listRides(
      withResponse({
        items: [joined(), joined({ id: otherId }, { rideId: otherId })],
        nextCursor: null,
      }),
      { limit: 1 },
    ),
    isInvalid,
  );
});

test('snapshot requires the matching caller, unique members and a leader within the 50-person cap', async () => {
  assert.deepEqual(await getRide(withResponse(snapshot()), rideId), snapshot());
  const leader = snapshot().members[1]!;
  const members = [
    ...snapshot().members,
    ...Array.from({ length: 49 }, (_, index) =>
      membership({
        id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
        profileId: `10000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
      }),
    ),
  ];
  const fullRide = { ...snapshot(), members: members.slice(0, 50) };
  assert.deepEqual(await getRide(withResponse(fullRide), rideId), fullRide);
  for (const data of [
    { ...snapshot(), members: [] },
    { ...snapshot(), members: [membership()] },
    { ...snapshot(), members: [leader] },
    { ...snapshot(), members: [...snapshot().members, membership()] },
    { ...snapshot(), members: [membership(), { ...leader, profileId: userId }] },
    { ...snapshot(), members: [membership({ displayName: 'Someone else' }), leader] },
    { ...snapshot(), members: [membership({ rideId: otherId }), leader] },
    { ...snapshot(), members },
    { ...snapshot(), membership: membership({ profileId: otherId }) },
    { ...snapshot(), ride: ride({ id: otherId }) },
  ]) {
    await assert.rejects(getRide(withResponse(data), rideId), isInvalid);
  }
});

test('invalid credentials, mutation metadata and service URLs are rejected before fetching', async () => {
  let calls = 0;
  const client = {
    ...options,
    fetcher: async () => {
      calls++;
      return success(preview());
    },
  };
  for (const credential of [
    {},
    { code: 'invalid' },
    { token: 'short' },
    { code, token },
    { code, extra: true },
  ]) {
    await assert.rejects(previewInvitation(client, credential as InvitationCredential), isInvalid);
  }
  for (const apiUrl of [
    'ftp://example.test',
    'https://name:secret@example.test',
    'https://example.test/path',
    'https://example.test/?token=secret',
    'https://example.test/#secret',
  ]) {
    await assert.rejects(previewInvitation({ ...client, apiUrl }, { code }), isInvalid);
  }
  await assert.rejects(previewInvitation({ ...client, userId: 'bad' }, { code }), isInvalid);
  await assert.rejects(
    previewInvitation({ ...client, accessToken: 'token\nvalue' }, { code }),
    isInvalid,
  );
  await assert.rejects(createRide(client, { ...createChange, name: ' ' }), isInvalid);
  await assert.rejects(joinRide(client, { ...joinChange, rideId: 'bad' }), isInvalid);
  await assert.rejects(joinRide(client, { ...joinChange, idempotencyKey: 'bad' }), isInvalid);
  await assert.rejects(
    rotateInvitation(client, { rideId, revision: 0, idempotencyKey: key }),
    isInvalid,
  );
  await assert.rejects(listRides(client, { limit: 101 }), isInvalid);
  await assert.rejects(listRides(client, { cursor: 'contains space' }), isInvalid);
  assert.equal(calls, 0);
});

test('incoming invitation clearing removes credentials without changing account generation', () => {
  clearRideSession();
  const generation = rideSessionGeneration();
  const version = invitationVersion();
  let notifications = 0;
  const unsubscribe = subscribeInvitation(() => {
    notifications++;
  });
  try {
    receiveInvitation({ token });
    assert.deepEqual(peekInvitation(), { credential: { token }, invalid: false });
    clearIncomingInvitation();
    assert.deepEqual(peekInvitation(), { credential: null, invalid: false });
    assert.equal(rideSessionGeneration(), generation);
    receiveInvitation(null);
    assert.deepEqual(peekInvitation(), { credential: null, invalid: true });
    clearIncomingInvitation();
    assert.deepEqual(peekInvitation(), { credential: null, invalid: false });
    assert.equal(invitationVersion(), version + 4);
    assert.equal(notifications, 4);
  } finally {
    unsubscribe();
    clearRideSession();
  }
  assert.equal(notifications, 4);
});

test('account session clearing advances generation and removes pending or invalid invitations', () => {
  const generation = rideSessionGeneration();
  receiveInvitation({ code });
  clearRideSession();
  assert.equal(rideSessionGeneration(), generation + 1);
  assert.deepEqual(peekInvitation(), { credential: null, invalid: false });
  receiveInvitation(null);
  clearRideSession();
  assert.equal(rideSessionGeneration(), generation + 2);
  assert.deepEqual(peekInvitation(), { credential: null, invalid: false });
});

test('native invitation redirects strip credentials from cold and warm navigation paths', () => {
  try {
    for (const initial of [true, false]) {
      for (const scheme of ['ridr', 'ridr-dev']) {
        clearRideSession();
        assert.equal(
          redirectSystemPath({ path: `${scheme}://join?token=${token}`, initial }),
          '/join',
        );
        assert.deepEqual(peekInvitation(), { credential: { token }, invalid: false });
      }
    }
    for (const path of [
      `https://other.test/join?token=${token}`,
      `${url}&extra=1`,
      'ridr://join?token=short',
    ]) {
      assert.equal(redirectSystemPath({ path, initial: false }), '/join');
      assert.deepEqual(peekInvitation(), { credential: null, invalid: true });
    }
    clearRideSession();
    assert.equal(redirectSystemPath({ path: '/account', initial: true }), '/account');
    assert.equal(redirectSystemPath({ path: 'https://other.test/private', initial: true }), '/');
    assert.deepEqual(peekInvitation(), { credential: null, invalid: false });
  } finally {
    clearRideSession();
  }
});
