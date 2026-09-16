import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  acceptLeadership,
  acceptRole,
  cancelRideProposal,
  endRide,
  getRide,
  getRideManagement,
  leaveRide,
  proposeLeadership,
  proposeRole,
  RideError,
  rotateInvitation,
  startRide,
  stopRideSharing,
  type RideClientOptions,
} from '../src/rides/api';
import type { Membership, MotionContext, Ride, RideProposal } from '../src/rides/models';

const userId = '30000000-0000-4000-8000-000000000001';
const rideId = '30000000-0000-4000-8000-000000000002';
const memberId = '30000000-0000-4000-8000-000000000003';
const leaderId = '30000000-0000-4000-8000-000000000004';
const otherId = '30000000-0000-4000-8000-000000000005';
const proposalId = '30000000-0000-4000-8000-000000000006';
const key = '30000000-0000-4000-8000-000000000007';
const capturedAt = '2026-09-16T09:00:00Z';
const options = { apiUrl: 'http://127.0.0.1:3000', userId, accessToken: 'private-token' };
const context: MotionContext = {
  motion: { state: 'stopped', source: 'speed', observedAt: capturedAt },
  capturedAt,
};
const ride = (change: Partial<Ride> = {}): Ride => ({
  id: rideId,
  name: 'Sunday ride',
  transport: 'motorcycle',
  state: 'active',
  leaderMemberId: leaderId,
  createdAt: capturedAt,
  startedAt: capturedAt,
  endedAt: null,
  revision: 4,
  settings: { broadcastIntervalSeconds: 5, stragglerDistanceM: 500 },
  ...change,
});
const membership = (change: Partial<Membership> = {}): Membership => ({
  id: memberId,
  rideId,
  profileId: userId,
  displayName: 'Maya',
  role: 'rider',
  physicalRole: 'rider',
  joinedAt: capturedAt,
  leftAt: null,
  sharingEnabled: false,
  consentEpoch: 0,
  revision: 1,
  ...change,
});
const proposal = (change: Partial<RideProposal> = {}): RideProposal => ({
  id: proposalId,
  kind: 'role_change',
  requesterMemberId: leaderId,
  targetMemberId: memberId,
  physicalRole: 'pillion',
  expiresAt: '2026-09-16T09:05:00Z',
  ...change,
});
const receipt = { proposalId, expiresAt: '2026-09-16T09:05:00Z' };
const privacy = { rideId, stoppedAt: capturedAt, consentEpoch: 0, idempotencyKey: key };
const stationary = { rideId, revision: 4, idempotencyKey: key, ...context };
const acceptance = { ride: ride(), proposal: proposal(), idempotencyKey: key, ...context };
const success = (data: unknown) => Response.json({ data, requestId: key });
const client = (data: unknown): RideClientOptions => ({
  ...options,
  fetcher: async () => success(data),
});
const invalid = (error: unknown) => error instanceof RideError && error.code === 'invalid';

test('management reads bind the ride and actor and expose only proposals involving that member', async () => {
  const data = { ride: ride(), membership: membership(), proposals: [proposal()] };
  assert.deepEqual(await getRideManagement(client(data), rideId), data);
  const ownProposer = { ...data, membership: membership({ id: leaderId, role: 'leader' }) };
  assert.deepEqual(await getRideManagement(client(ownProposer), rideId), ownProposer);
  for (const bad of [
    { ...data, ride: ride({ id: otherId }) },
    { ...data, membership: membership({ profileId: otherId }) },
    { ...data, proposals: [proposal({ targetMemberId: otherId })] },
    { ...data, proposals: [proposal(), proposal()] },
    { ...data, proposals: [proposal({ kind: 'leadership' })] },
    { ...data, proposals: [proposal({ physicalRole: null })] },
    { ...data, proposals: [{ ...proposal(), token: 'private-invite' }] },
    { ...data, members: [membership({ profileId: otherId })] },
    { ...data, ride: ride({ transport: 'car' }) },
  ])
    await assert.rejects(getRideManagement(client(bad), rideId), invalid);
});

test('ended and departed management status permits only own nonsharing membership and no proposals', async () => {
  for (const data of [
    {
      ride: ride({ state: 'ended', endedAt: capturedAt }),
      membership: membership(),
      proposals: [],
    },
    { ride: ride(), membership: membership({ leftAt: capturedAt }), proposals: [] },
  ]) {
    assert.deepEqual(await getRideManagement(client(data), rideId), data);
    await assert.rejects(
      getRideManagement(client({ ...data, proposals: [proposal()] }), rideId),
      invalid,
    );
    await assert.rejects(
      getRideManagement(
        client({
          ...data,
          membership: { ...data.membership, sharingEnabled: true },
        }),
        rideId,
      ),
      invalid,
    );
    await assert.rejects(
      getRideManagement(
        client({
          ...data,
          membership: { ...data.membership, profileId: otherId },
        }),
        rideId,
      ),
      invalid,
    );
  }
  await assert.rejects(
    getRide(
      client({
        ride: ride(),
        membership: membership({ leftAt: capturedAt }),
        members: [membership()],
      }),
      rideId,
    ),
    invalid,
  );
});

test('lifecycle writes send exact bodies and only concurrency-dependent commands send a revision', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  let response: unknown;
  const opts: RideClientOptions = {
    ...options,
    fetcher: async (input, init) => {
      requests.push({ url: String(input), init: init! });
      return success(response);
    },
  };
  response = ride();
  await startRide(opts, stationary);
  response = ride({ state: 'ended', endedAt: capturedAt });
  await endRide(opts, {
    rideId,
    reason: 'completed',
    capturedAt,
    consentEpoch: 0,
    idempotencyKey: key,
  });
  response = { leftAt: capturedAt, revision: 2 };
  await leaveRide(opts, privacy);
  response = { enabled: false, consentEpoch: 1, revision: 2, effectiveAt: capturedAt };
  await stopRideSharing(opts, privacy);
  response = receipt;
  await proposeRole(opts, { ...stationary, targetMemberId: memberId, physicalRole: 'pillion' });
  await proposeLeadership(opts, { ...stationary, targetMemberId: memberId });
  assert.deepEqual(
    requests.map(({ url }) => url.replace(`${options.apiUrl}/v1/rides/${rideId}/`, '')),
    ['start', 'end', 'leave', 'sharing', 'role-proposals', 'leadership-proposals'],
  );
  assert.deepEqual(
    requests.map(({ init }) => JSON.parse(String(init.body))),
    [
      context,
      { reason: 'completed', capturedAt, consentEpoch: 0 },
      { stoppedAt: capturedAt, consentEpoch: 0 },
      { enabled: false, stoppedAt: capturedAt, consentEpoch: 0 },
      { targetMemberId: memberId, physicalRole: 'pillion', ...context },
      { targetMemberId: memberId, ...context },
    ],
  );
  requests.forEach(({ url, init }, index) => {
    const headers = new Headers(init.headers);
    assert.equal(init.method, index === 3 ? 'PUT' : 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(headers.get('authorization'), `Bearer ${options.accessToken}`);
    assert.equal(headers.get('idempotency-key'), key);
    assert.equal(headers.get('if-match'), [0, 4, 5].includes(index) ? '"4"' : null);
    assert.ok(!url.includes(options.accessToken));
  });
});

test('acceptance validates the named role target and actor before returning membership', async () => {
  const accepted = membership({ physicalRole: 'pillion', role: 'pillion', revision: 2 });
  assert.deepEqual(await acceptRole(client(accepted), acceptance), accepted);
  for (const bad of [
    { ...accepted, id: otherId },
    { ...accepted, profileId: otherId },
    { ...accepted, physicalRole: 'rider', role: 'rider' },
    { ...accepted, rideId: otherId },
    { ...accepted, leftAt: capturedAt },
    { ...accepted, contact: 'private contact' },
  ])
    await assert.rejects(acceptRole(client(bad), acceptance), invalid);
  const lobby = ride({ state: 'lobby', startedAt: null });
  await assert.rejects(
    acceptRole(client({ ...accepted, sharingEnabled: true }), {
      ...acceptance,
      ride: lobby,
    }),
    invalid,
  );
});

test('leadership acceptance requires the proposal target to become leader', async () => {
  const change = { ...acceptance, proposal: proposal({ kind: 'leadership', physicalRole: null }) };
  const result = ride({ leaderMemberId: memberId, revision: 5 });
  assert.deepEqual(await acceptLeadership(client(result), change), result);
  for (const bad of [
    ride(),
    { ...result, id: otherId },
    { ...result, state: 'ended', endedAt: capturedAt },
  ])
    await assert.rejects(acceptLeadership(client(bad), change), invalid);
});

test('acceptance and cancellation send no member identity, consent opt-in or revision header', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const opts: RideClientOptions = {
    ...options,
    fetcher: async (input, init) => {
      requests.push({ url: String(input), init: init! });
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return success(
        String(input).includes('/role-proposals/')
          ? membership({ role: 'pillion', physicalRole: 'pillion' })
          : ride({ leaderMemberId: memberId }),
      );
    },
  };
  await acceptRole(opts, acceptance);
  await acceptLeadership(opts, {
    ...acceptance,
    proposal: proposal({ kind: 'leadership', physicalRole: null }),
  });
  for (const kind of ['role_change', 'leadership'] as const)
    await cancelRideProposal(opts, { rideId, kind, proposalId, idempotencyKey: key });
  assert.deepEqual(
    requests.map(({ init }) => (init.body === undefined ? null : JSON.parse(String(init.body)))),
    [context, context, null, null],
  );
  for (const { init } of requests) {
    assert.equal(new Headers(init.headers).get('if-match'), null);
    assert.equal(new Headers(init.headers).get('idempotency-key'), key);
  }
  assert.ok(requests[2]?.url.endsWith(`/role-proposals/${proposalId}`));
  assert.ok(requests[3]?.url.endsWith(`/leadership-proposals/${proposalId}`));
});

test('active invitation replacement preserves motion context while lobby replacement remains minimal', async () => {
  const requests: RequestInit[] = [];
  const opts = {
    ...options,
    fetcher: async (_input: unknown, init?: RequestInit) => {
      requests.push(init!);
      return success({ id: otherId, expiresAt: capturedAt, tokenAvailable: false });
    },
  };
  await rotateInvitation(opts, { rideId, revision: 4, idempotencyKey: key });
  await rotateInvitation(opts, {
    rideId,
    revision: 4,
    idempotencyKey: key,
    motionContext: context,
  });
  assert.deepEqual(
    requests.map((init) => JSON.parse(String(init.body))),
    [{ rotate: true }, { rotate: true, ...context }],
  );
});

test('unconfirmed start and privacy requests retain exact receipt, motion and consent fields on retry', async () => {
  for (const operation of ['start', 'end', 'leave', 'stop'] as const) {
    const requests: RequestInit[] = [];
    const opts: RideClientOptions = {
      ...options,
      fetcher: async (_input, init) => {
        requests.push(init!);
        if (requests.length === 1) throw new Error('private network context');
        return success(
          operation === 'start'
            ? ride()
            : operation === 'end'
              ? ride({ state: 'ended', endedAt: capturedAt })
              : operation === 'leave'
                ? { leftAt: capturedAt, revision: 2 }
                : { enabled: false, consentEpoch: 1, revision: 2, effectiveAt: capturedAt },
        );
      },
    };
    const run = () =>
      operation === 'start'
        ? startRide(opts, stationary)
        : operation === 'end'
          ? endRide(opts, {
              rideId,
              reason: 'completed',
              capturedAt,
              consentEpoch: 0,
              idempotencyKey: key,
            })
          : operation === 'leave'
            ? leaveRide(opts, privacy)
            : stopRideSharing(opts, privacy);
    await assert.rejects(run(), (error: unknown) => {
      assert.ok(error instanceof RideError && error.unconfirmed && error.retryable);
      assert.ok(!error.message.includes('private network context'));
      return true;
    });
    await run();
    assert.deepEqual(requests[0]?.headers, requests[1]?.headers);
    assert.equal(requests[0]?.body, requests[1]?.body);
  }
});

test('a stale consent stop can report a newer enabled epoch without changing the requested stop body', async () => {
  const result = { enabled: true, consentEpoch: 3, revision: 5, effectiveAt: capturedAt };
  assert.deepEqual(await stopRideSharing(client(result), privacy), result);
});

test('malformed success responses remain unconfirmed and never authorize implicit sharing', async () => {
  const cases: [unknown, (opts: RideClientOptions) => Promise<unknown>][] = [
    [ride({ state: 'lobby', startedAt: null }), (opts) => startRide(opts, stationary)],
    [{ ...ride(), sharingEnabled: true }, (opts) => startRide(opts, stationary)],
    [
      ride(),
      (opts) =>
        endRide(opts, {
          rideId,
          reason: 'completed',
          capturedAt,
          consentEpoch: 0,
          idempotencyKey: key,
        }),
    ],
    [{ leftAt: capturedAt, revision: 0 }, (opts) => leaveRide(opts, privacy)],
    [{ leftAt: '2026-02-30T00:00:00Z', revision: 2 }, (opts) => leaveRide(opts, privacy)],
    [
      { enabled: true, consentEpoch: -1, revision: 2, effectiveAt: capturedAt },
      (opts) => stopRideSharing(opts, privacy),
    ],
    [
      { enabled: 'false', consentEpoch: 1, revision: 2, effectiveAt: capturedAt },
      (opts) => stopRideSharing(opts, privacy),
    ],
    [
      { ...receipt, token: 'private secret' },
      (opts) => proposeLeadership(opts, { ...stationary, targetMemberId: memberId }),
    ],
    [
      { proposalId: otherId, expiresAt: null },
      (opts) =>
        proposeRole(opts, { ...stationary, targetMemberId: memberId, physicalRole: 'rider' }),
    ],
  ];
  for (const [data, run] of cases)
    await assert.rejects(run(client(data)), (error: unknown) => {
      assert.ok(error instanceof RideError && error.code === 'invalid' && error.unconfirmed);
      assert.ok(!error.message.includes('private secret'));
      return true;
    });
});

test('revoked sessions and lifecycle conflicts ignore unsafe server error text', async () => {
  for (const [status, expected] of [
    [401, 'unauthorized'],
    [403, 'blocked'],
    [404, 'not_found'],
    [409, 'conflict'],
  ] as const) {
    const opts: RideClientOptions = {
      ...options,
      fetcher: async () =>
        Response.json(
          {
            error: {
              code: 'PROPOSAL_STALE',
              message: `private ${options.accessToken}`,
            },
          },
          { status },
        ),
    };
    await assert.rejects(acceptRole(opts, acceptance), (error: unknown) => {
      assert.ok(error instanceof RideError);
      assert.equal(error.code, expected);
      assert.equal(error.unconfirmed, false);
      assert.ok(!error.message.includes(options.accessToken));
      return true;
    });
  }
});

test('invalid command identities and accidental sensor payloads fail before dispatch', async () => {
  let calls = 0;
  const opts: RideClientOptions = {
    ...options,
    fetcher: async () => {
      calls++;
      return success(ride());
    },
  };
  const withPosition = { ...context, motion: { ...context.motion, latitude: 12 } };
  for (const run of [
    () => startRide(opts, { ...stationary, rideId: 'invalid' }),
    () => startRide(opts, { ...stationary, revision: 0 }),
    () => startRide(opts, { ...stationary, ...withPosition }),
    () => leaveRide(opts, { ...privacy, consentEpoch: -1 }),
    () => stopRideSharing(opts, { ...privacy, stoppedAt: 'yesterday' }),
    () => proposeRole(opts, { ...stationary, targetMemberId: 'invalid', physicalRole: 'rider' }),
    () =>
      acceptRole(opts, {
        ...acceptance,
        proposal: proposal({ kind: 'leadership', physicalRole: null }),
      }),
    () =>
      cancelRideProposal(opts, {
        rideId,
        proposalId: '../private',
        kind: 'role_change',
        idempotencyKey: key,
      }),
  ])
    await assert.rejects(run(), invalid);
  assert.equal(calls, 0);
});
