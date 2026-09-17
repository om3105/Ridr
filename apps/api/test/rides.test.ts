import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { ApiError, unauthenticated } from '../src/api-errors.js';
import { readConfig } from '../src/config.js';
import { RideLimiter } from '../src/ride-limits.js';
import {
  parseCreateRide,
  parsePreview,
  parseJoin,
  parseRideList,
  rideRevision,
  commandKey,
  parseStart,
  parseEnd,
  parseStop,
  parseProposal,
  parseAccept,
} from '../src/rides.js';
import type { Ride, Membership, RideStore } from '../src/ride-types.js';
import type { VerifiedAccount } from '../src/auth.js';
import type { DatabaseHealth } from '../src/database-health.js';

const isCode = (status: number, code: string) => (error: unknown) =>
  error instanceof ApiError && error.status === status && error.code === code;
const code = 'ABCD234567';
const token = 'a'.repeat(43);

test('ride inputs reject identity injection, ambiguous credentials and invalid roles', () => {
  const key = randomUUID();
  for (const body of [null, [], {}, { name: 'Ride', transport: 'car', leaderId: randomUUID() }])
    assert.throws(() => parseCreateRide(body, key), isCode(400, 'INVALID_REQUEST'));
  for (const name of ['', '  ', '<Ride>', 'A\nB', 'x'.repeat(81)])
    assert.throws(
      () => parseCreateRide({ name, transport: 'car' }, key),
      isCode(422, 'VALIDATION_FAILED'),
    );
  assert.throws(
    () => parseCreateRide({ name: 'Ride', transport: 'bus' }, key),
    isCode(422, 'VALIDATION_FAILED'),
  );
  assert.deepEqual(parseCreateRide({ name: '  पुणे  ', transport: 'cycling' }, key), {
    name: 'पुणे',
    transport: 'cycling',
    idempotencyKey: key,
  });
  assert.throws(() => parsePreview({ code, token }), isCode(400, 'INVALID_REQUEST'));
  assert.deepEqual(parsePreview({ code: 'abcd-23 4567' }), { code });
  assert.deepEqual(parsePreview({ token }), { token });
  for (const value of ['short', 'ABCD123456', null, {}, `ridr://join?token=${token}`])
    assert.throws(() => parsePreview({ code: value }), isCode(404, 'INVITE_UNAVAILABLE'));
  assert.throws(
    () => parseJoin({ inviteCode: code, physicalRole: 'leader' }, key),
    isCode(422, 'VALIDATION_FAILED'),
  );
  assert.throws(
    () => parseJoin({ inviteCode: code, inviteToken: token, physicalRole: 'rider' }, key),
    isCode(400, 'INVALID_REQUEST'),
  );
  assert.deepEqual(parseJoin({ inviteCode: code, physicalRole: 'pillion' }, key), {
    inviteCode: code,
    physicalRole: 'pillion',
    idempotencyKey: key,
  });
  assert.throws(() => commandKey(undefined), isCode(400, 'INVALID_REQUEST'));
  assert.throws(() => rideRevision(undefined), isCode(428, 'PRECONDITION_REQUIRED'));
  for (const revision of ['1', 'W/"1"', '"0"', '"1", "2"', '"9007199254740992"'])
    assert.throws(() => rideRevision(revision), isCode(400, 'INVALID_REQUEST'));
  assert.equal(rideRevision('"3"'), 3);
  for (const query of [
    { limit: '101' },
    { limit: ['1'] },
    { userId: randomUUID() },
    { cursor: '' },
  ])
    assert.throws(() => parseRideList(query), isCode(400, 'INVALID_REQUEST'));
});

test('invitation throttles expire, isolate account/IP counters and bound memory without evicting active limits', () => {
  let now = 0;
  const limits = new RideLimiter({ accountPerMinute: 2, ipPerMinute: 3 }, () => now, 3);
  assert.equal(limits.consume('account', 'a'), null);
  assert.equal(limits.consume('account', 'a'), null);
  assert.equal(limits.consume('account', 'a'), 60);
  assert.equal(limits.consume('ip', 'a'), null);
  assert.equal(limits.consume('account', 'b'), null);
  assert.equal(limits.consume('account', 'c'), 60);
  now = 59999;
  assert.equal(limits.consume('account', 'a'), 1);
  now = 60000;
  assert.equal(limits.consume('account', 'a'), null);
  assert.equal(limits.consume('account', 'c'), null);
});

const account: VerifiedAccount = {
  id: randomUUID(),
  sessionId: randomUUID(),
  initialDisplayName: 'Local rider',
  expiresAt: Date.now() / 1000 + 300,
};
const ride: Ride = {
  id: randomUUID(),
  name: 'Morning ride',
  transport: 'motorcycle',
  state: 'lobby',
  leaderMemberId: randomUUID(),
  createdAt: new Date().toISOString(),
  startedAt: null,
  endedAt: null,
  revision: 1,
  settings: { broadcastIntervalSeconds: 5, stragglerDistanceM: 500 },
};
const membership: Membership = {
  id: ride.leaderMemberId,
  rideId: ride.id,
  profileId: account.id,
  displayName: account.initialDisplayName,
  role: 'leader',
  physicalRole: 'rider',
  joinedAt: ride.createdAt,
  leftAt: null,
  sharingEnabled: false,
  consentEpoch: 0,
  revision: 1,
};
const invite = {
  id: randomUUID(),
  code,
  url: `ridr://join?token=${token}`,
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  tokenAvailable: true,
};
const database: DatabaseHealth = {
  check: async () => ({
    status: 'ok',
    service: 'ridr-api',
    checks: { database: 'up', schema: 'up', postgis: 'up' },
  }),
  close: async () => undefined,
};

test('ride HTTP routes use verified actors, strict envelopes, safe errors and correct mutation status', async (t) => {
  let calls = 0;
  let closed = false;
  let revoked = false;
  const logs: string[] = [];
  const store: RideStore = {
    create: async (actor, change) => {
      assert.equal(actor.id, account.id);
      calls += 1;
      if (change.name === 'Outage') throw new Error('private-database-password');
      return { ride, membership, invite };
    },
    preview: async (actor, credential) => {
      assert.equal(actor.id, account.id);
      assert.deepEqual(credential, { code });
      calls += 1;
      return {
        rideId: ride.id,
        rideName: ride.name,
        transport: ride.transport,
        state: 'lobby',
        availableRoles: ['rider', 'pillion'],
        expiresAt: invite.expiresAt,
      };
    },
    join: async (actor, id, change) => {
      assert.equal(actor.id, account.id);
      assert.equal(id, ride.id);
      assert.equal(change.physicalRole, 'rider');
      calls += 1;
      return { ride, membership };
    },
    read: async () => ({ ride, members: [membership], membership }),
    list: async (_, query) => {
      assert.equal(query.limit, 50);
      return { items: [{ ride, membership }], nextCursor: null };
    },
    rotate: async (_, id, change) => {
      assert.equal(id, ride.id);
      assert.equal(change.revision, 1);
      return invite;
    },
    revoke: async (_, id) => {
      assert.equal(id, ride.id);
    },
    start: async (actor, id, change) => {
      assert.equal(actor.id, account.id);
      assert.equal(id, ride.id);
      assert.equal(change.revision, 1);
      assert.equal(change.motion.source, 'speed');
      return ride;
    },
    end: async () => ride,
    leave: async () => ({ leftAt: new Date().toISOString(), revision: 2 }),
    stopSharing: async () => ({
      enabled: false,
      consentEpoch: 1,
      revision: 2,
      effectiveAt: new Date().toISOString(),
    }),
    management: async () => ({ ride, membership, proposals: [] }),
    propose: async (actor, id, kind, change) => {
      assert.equal(actor.id, account.id);
      assert.equal(id, ride.id);
      assert.equal(change.targetMemberId, membership.id);
      assert.equal(change.physicalRole, kind === 'role_change' ? 'pillion' : undefined);
      return { proposalId: membership.id, expiresAt: invite.expiresAt };
    },
    accept: async (_, id, proposal, kind) => {
      assert.equal(id, ride.id);
      assert.equal(proposal, membership.id);
      return kind === 'role_change' ? membership : ride;
    },
    cancel: async () => undefined,
    close: async () => {
      closed = true;
    },
  };
  const app = await createApp(
    readConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/ridr' }),
    {
      database,
      rides: store,
      logSink: (line) => logs.push(line),
      accounts: {
        verifier: {
          verify: async (header) => {
            if (revoked || header !== 'Bearer private-test-token') throw unauthenticated();
            return account;
          },
          assertActive: async () => undefined,
          close: async () => undefined,
        },
        profiles: {
          read: async () => {
            throw new Error('unused');
          },
          update: async () => {
            throw new Error('unused');
          },
          close: async () => undefined,
        },
      },
    },
  );
  t.after(async () => {
    await app.close();
    assert.equal(closed, true);
  });
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  const headers = {
    Authorization: 'Bearer private-test-token',
    'Content-Type': 'application/json',
    'Idempotency-Key': randomUUID(),
    'If-Match': '"1"',
  };
  const post = (path: string, body: unknown) =>
    fetch(url + '/v1' + path, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await fetch(url + '/v1/rides')).status, 401);
  assert.equal(calls, 0);
  const created = await post('/rides', { name: 'Morning ride', transport: 'motorcycle' });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('etag'), '"1"');
  assert.equal(created.headers.get('cache-control'), 'no-store');
  const body = await created.json();
  assert.equal(body.requestId, created.headers.get('x-request-id'));
  assert.deepEqual(body.data, { ride, membership, invite });
  assert.equal(
    (await post('/rides', { name: 'Ride', transport: 'car', actorId: account.id })).status,
    400,
  );
  const preview = await post('/invites/preview', { code });
  assert.equal(preview.status, 200);
  assert.deepEqual(Object.keys((await preview.json()).data).sort(), [
    'availableRoles',
    'expiresAt',
    'rideId',
    'rideName',
    'state',
    'transport',
  ]);
  assert.equal(
    (await post(`/rides/${ride.id}/join`, { inviteCode: code, physicalRole: 'rider' })).status,
    200,
  );
  assert.equal((await fetch(url + '/v1/rides', { headers })).status, 200);
  assert.equal((await fetch(url + `/v1/rides/${ride.id}`, { headers })).status, 200);
  assert.equal((await post(`/rides/${ride.id}/invites`, { rotate: true })).status, 201);
  assert.equal(
    (await fetch(url + `/v1/rides/${ride.id}/invites/current`, { method: 'DELETE', headers }))
      .status,
    204,
  );
  const motion = { state: 'stopped', source: 'speed', observedAt: new Date().toISOString() };
  const context = { motion, capturedAt: motion.observedAt };
  assert.equal((await post(`/rides/${ride.id}/start`, context)).status, 200);
  assert.equal(
    (
      await post(`/rides/${ride.id}/end`, {
        reason: 'cancelled',
        capturedAt: context.capturedAt,
        consentEpoch: 0,
      })
    ).status,
    200,
  );
  assert.equal(
    (await post(`/rides/${ride.id}/leave`, { stoppedAt: context.capturedAt, consentEpoch: 0 }))
      .status,
    200,
  );
  assert.equal(
    (
      await fetch(url + `/v1/rides/${ride.id}/sharing`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ enabled: false, stoppedAt: context.capturedAt, consentEpoch: 0 }),
      })
    ).status,
    200,
  );
  const management = await fetch(url + `/v1/rides/${ride.id}/management`, { headers });
  assert.equal(management.status, 200);
  assert.deepEqual((await management.json()).data, { ride, membership, proposals: [] });
  for (const resource of ['role-proposals', 'leadership-proposals']) {
    const proposed = await post(`/rides/${ride.id}/${resource}`, {
      ...context,
      targetMemberId: membership.id,
      ...(resource === 'role-proposals' ? { physicalRole: 'pillion' } : {}),
    });
    assert.equal(proposed.status, 201);
    assert.deepEqual((await proposed.json()).data, {
      proposalId: membership.id,
      expiresAt: invite.expiresAt,
    });
    const accepted = await post(`/rides/${ride.id}/${resource}/${membership.id}/accept`, context);
    assert.equal(accepted.status, 200);
    assert.deepEqual(
      (await accepted.json()).data,
      resource === 'role-proposals' ? membership : ride,
    );
    assert.equal(
      (
        await fetch(url + `/v1/rides/${ride.id}/${resource}/${membership.id}`, {
          method: 'DELETE',
          headers,
        })
      ).status,
      204,
    );
    assert.equal(
      (
        await fetch(url + `/v1/rides/${ride.id}/${resource}/${membership.id}`, {
          method: 'DELETE',
          headers,
          body: '{}',
        })
      ).status,
      400,
    );
  }
  assert.equal((await post(`/rides/${ride.id}/invites`, { rotate: true, ...context })).status, 201);
  assert.equal((await post(`/rides/${ride.id}/invites`, { rotate: true, motion })).status, 400);
  const unsupported = await fetch(url + '/v1/rides', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'text/plain' },
    body: 'text',
  });
  assert.equal(unsupported.status, 415);
  const outage = await post('/rides', { name: 'Outage', transport: 'car' });
  assert.equal(outage.status, 503);
  assert.ok(!(await outage.text()).includes('private-database-password'));
  revoked = true;
  assert.equal(
    (await post(`/rides/${ride.id}/join`, { inviteCode: code, physicalRole: 'rider' })).status,
    401,
  );
  assert.ok(
    logs.every(
      (line) =>
        !line.includes(token) &&
        !line.includes(code) &&
        !line.includes('private-test-token') &&
        !line.includes('private-database-password'),
    ),
  );
});

test('unconfigured ride routes fail closed while health remains available', async (t) => {
  const app = await createApp(
    readConfig({ DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/ridr' }),
    { database, logSink: () => undefined },
  );
  t.after(() => app.close());
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  assert.equal((await fetch(url + '/v1/rides')).status, 503);
  assert.equal((await fetch(url + '/v1/health/live')).status, 200);
});

test('management requests require exact fields, UTC capture evidence and nonnegative consent epochs', () => {
  const key = randomUUID();
  const capture = '2026-09-16T09:00:00.000Z';
  const motion = { state: 'stopped', source: 'speed', observedAt: capture };
  const context = { motion, capturedAt: capture };
  assert.deepEqual(parseStart(context, key, '"2"'), {
    ...context,
    revision: 2,
    idempotencyKey: key,
  });
  assert.throws(
    () => parseStart({ ...context, leader: true }, key, '"2"'),
    isCode(400, 'INVALID_REQUEST'),
  );
  assert.throws(() => parseStart(context, key, undefined), isCode(428, 'PRECONDITION_REQUIRED'));
  for (const invalid of ['2026-02-30T09:00:00.000Z', '2026-09-16', '2026-09-16T09:00:00+00:00', 42])
    assert.throws(
      () => parseAccept({ ...context, capturedAt: invalid }, key),
      isCode(400, 'INVALID_REQUEST'),
    );
  for (const invalid of [
    { ...motion, trusted: true },
    { ...motion, state: 'driving' },
    { ...motion, source: 'manual' },
  ])
    assert.throws(
      () => parseAccept({ ...context, motion: invalid }, key),
      isCode(400, 'INVALID_REQUEST'),
    );
  // Freshness is checked inside the transaction, after an accepted same-key replay is found.
  assert.equal(
    parseAccept({ ...context, capturedAt: '2020-01-01T00:00:00Z' }, key).capturedAt,
    '2020-01-01T00:00:00Z',
  );
  assert.deepEqual(parseEnd({ reason: 'cancelled', capturedAt: capture, consentEpoch: 0 }, key), {
    reason: 'cancelled',
    capturedAt: capture,
    consentEpoch: 0,
    idempotencyKey: key,
  });
  for (const epoch of [-1, 0.5, '0', Number.MAX_SAFE_INTEGER + 1])
    assert.throws(
      () => parseStop({ stoppedAt: capture, consentEpoch: epoch }, key),
      isCode(400, 'INVALID_REQUEST'),
    );
  assert.throws(
    () => parseStop({ enabled: true, stoppedAt: capture, consentEpoch: 0 }, key, true),
    isCode(400, 'INVALID_REQUEST'),
  );
  assert.throws(
    () => parseStop({ stoppedAt: capture, consentEpoch: 0, motion }, key),
    isCode(400, 'INVALID_REQUEST'),
  );
  const targetMemberId = randomUUID();
  assert.equal(
    parseProposal(
      { ...context, targetMemberId, physicalRole: 'pillion' },
      key,
      '"2"',
      'role_change',
    ).physicalRole,
    'pillion',
  );
  assert.throws(
    () =>
      parseProposal(
        { ...context, targetMemberId, physicalRole: 'rider' },
        key,
        '"2"',
        'leadership',
      ),
    isCode(400, 'INVALID_REQUEST'),
  );
  assert.throws(
    () =>
      parseProposal(
        { ...context, targetMemberId, physicalRole: 'leader' },
        key,
        '"2"',
        'role_change',
      ),
    isCode(422, 'VALIDATION_FAILED'),
  );
});
