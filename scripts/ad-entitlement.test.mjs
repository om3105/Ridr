import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeEntitlement, parseEntitlementArgs } from './ad-entitlement.mjs';

const userId = '10000000-0000-4000-8000-000000000001';
const now = new Date('2026-09-28T00:00:00Z');

test('test entitlements require a specific account and bounded UTC expiry', () => {
  assert.deepEqual(parseEntitlementArgs(['grant', userId, '2026-10-01T00:00:00Z'], now),
    { action: 'grant', userId, until: '2026-10-01T00:00:00.000Z' });
  assert.deepEqual(parseEntitlementArgs(['revoke', userId], now), { action: 'revoke', userId });
  for (const args of [['grant', 'bad', '2026-10-01T00:00:00Z'],
    ['grant', userId, '2026-09-27T00:00:00Z'],
    ['grant', userId, '2028-10-01T00:00:00Z'],
    ['grant', userId, '2026-10-01'], ['grant', userId, '2026-02-31T00:00:00Z'],
    ['revoke', userId, 'extra']]) {
    assert.throws(() => parseEntitlementArgs(args, now));
  }
});

test('only private database role can change a test entitlement', async () => {
  const command = parseEntitlementArgs(['grant', userId, '2026-10-01T00:00:00Z'], now);
  const denied = { query: async () => ({ rows: [{ actor: 'ridr_api' }] }) };
  await assert.rejects(changeEntitlement(denied, command), /ridr_migrator/);
  const statements = [];
  const allowed = { query: async (sql, values) => {
    statements.push({ sql, values });
    if (sql.startsWith('SELECT current_user')) return { rows: [{ actor: 'ridr_migrator' }] };
    return { rowCount: 1 };
  } };
  assert.equal(await changeEntitlement(allowed, command), 'granted');
  assert.deepEqual(statements[1].values, [userId, command.until]);
  assert.match(statements[1].sql, /account_state='active'/);
  assert.equal(await changeEntitlement(allowed, { action: 'revoke', userId }), 'revoked');
});
