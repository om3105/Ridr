import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { ApiError, unauthenticated } from '../src/api-errors.js';
import type { TokenVerifier, VerifiedAccount } from '../src/auth.js';
import { OperationalLogger } from '../src/logging.js';
import { PostgresProfiles } from '../src/profiles.js';

// Run explicitly against the local/test runtime role after migrations; no provider credentials needed.
test('PostgreSQL profile transactions enforce ownership, replay, revisions and current account/session status', async (t) => {
  assert.equal(process.env.NODE_ENV, 'test', 'Profile integration checks require NODE_ENV=test.');
  assert.ok(process.env.DATABASE_URL, 'Profile integration checks require DATABASE_URL.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const account: VerifiedAccount = {
    id: randomUUID(),
    sessionId: randomUUID(),
    initialDisplayName: 'Mira',
    expiresAt: Date.now() / 1000 + 300,
  };
  const other = {
    ...account,
    id: randomUUID(),
    sessionId: randomUUID(),
    initialDisplayName: 'Ren',
  };
  let active = true;
  const verifier: TokenVerifier = {
    verify: async () => account,
    assertActive: async () => {
      if (!active) throw unauthenticated();
    },
    close: async () => undefined,
  };
  const profiles = new PostgresProfiles(
    process.env.DATABASE_URL,
    verifier,
    new OperationalLogger(() => undefined),
    Buffer.alloc(32, 7).toString('base64'),
  );
  t.after(async () => {
    await profiles.close();
    await pool.query('DELETE FROM ridr.command_receipts WHERE actor_id = ANY($1::uuid[])', [
      [account.id, other.id],
    ]);
    await pool.query('DELETE FROM ridr.profiles WHERE id = ANY($1::uuid[])', [
      [account.id, other.id],
    ]);
    await pool.end();
  });
  const original = await profiles.read(account);
  assert.equal(original.displayName, 'Mira');
  assert.equal(original.revision, 1);
  assert.equal(original.activeMembership, null);
  assert.equal(original.entitlement.adFree, false);
  assert.equal(original.deletionState, 'none');
  assert.equal((await profiles.read(account)).revision, 1);
  const key = randomUUID();
  const change = { displayName: '  Mira D  ', revision: 1, idempotencyKey: key };
  const duplicateResults = await Promise.all([
    profiles.update(account, change),
    profiles.update(account, change),
  ]);
  assert.deepEqual(duplicateResults[0], duplicateResults[1]);
  assert.equal(duplicateResults[0]!.revision, 2);
  assert.equal(duplicateResults[0]!.displayName, 'Mira D');
  const receipts = await pool.query(
    'SELECT count(*) AS count FROM ridr.command_receipts WHERE actor_id = $1',
    [account.id],
  );
  assert.equal(receipts.rows[0].count, '1');
  await assert.rejects(
    profiles.update(account, { ...change, displayName: 'Different' }),
    (error: unknown) => error instanceof ApiError && error.status === 409,
  );
  const races = await Promise.allSettled([
    profiles.update(account, { displayName: 'First', revision: 2, idempotencyKey: randomUUID() }),
    profiles.update(account, { displayName: 'Second', revision: 2, idempotencyKey: randomUUID() }),
  ]);
  assert.equal(races.filter((result) => result.status === 'fulfilled').length, 1);
  const conflict = races.find((result) => result.status === 'rejected');
  assert.ok(
    conflict?.status === 'rejected' &&
      conflict.reason instanceof ApiError &&
      conflict.reason.status === 412,
  );
  assert.deepEqual(await profiles.update(account, change), duplicateResults[0]);
  assert.equal((await profiles.read(account)).revision, 3);
  assert.equal(await profiles.readContact(account), null);
  const contactChange = {
    name: 'Private contact',
    phone: '+919876543210',
    revision: null,
    idempotencyKey: randomUUID(),
  };
  const savedContact = await profiles.saveContact(account, contactChange);
  assert.deepEqual(savedContact, { name: 'Private contact', phone: '+919876543210', revision: 1 });
  assert.deepEqual(await profiles.saveContact(account, contactChange), savedContact);
  assert.equal(await profiles.readContact(other), null);
  const storedContact = await pool.query<{ ciphertext: Buffer }>(
    'SELECT ciphertext FROM ridr.emergency_contacts WHERE user_id=$1',
    [account.id],
  );
  assert.equal(storedContact.rows[0]!.ciphertext.includes(Buffer.from(contactChange.phone)), false);
  const receiptData = await pool.query<{ result: unknown }>(
    'SELECT result FROM ridr.command_receipts WHERE actor_id=$1 AND command_id=$2',
    [account.id, contactChange.idempotencyKey],
  );
  assert.equal(JSON.stringify(receiptData.rows[0]!.result).includes(contactChange.phone), false);
  await assert.rejects(
    profiles.saveContact(account, { ...contactChange, idempotencyKey: randomUUID() }),
    (error: unknown) => error instanceof ApiError && error.status === 412,
  );
  const changedContact = await profiles.saveContact(account, {
    name: 'Updated contact',
    phone: '+919876543211',
    revision: 1,
    idempotencyKey: randomUUID(),
  });
  assert.equal(changedContact.revision, 2);
  const deleteKey = randomUUID();
  await profiles.deleteContact(account, deleteKey);
  await profiles.deleteContact(account, deleteKey);
  assert.equal(await profiles.readContact(account), null);
  assert.equal(
    (await profiles.update(other, { ...change, displayName: 'Another account' })).id,
    other.id,
  );
  assert.equal((await profiles.read(account)).revision, 3);
  active = false;
  const deniedKey = randomUUID();
  await assert.rejects(
    profiles.update(account, {
      displayName: 'Must roll back',
      revision: 3,
      idempotencyKey: deniedKey,
    }),
    (error: unknown) => error instanceof ApiError && error.status === 401,
  );
  const deniedReceipt = await pool.query(
    'SELECT 1 FROM ridr.command_receipts WHERE actor_id = $1 AND command_id = $2',
    [account.id, deniedKey],
  );
  assert.equal(deniedReceipt.rowCount, 0);
  active = true;
  assert.equal((await profiles.read(account)).revision, 3);
  await pool.query("UPDATE ridr.profiles SET account_state = 'deleting' WHERE id = $1", [
    account.id,
  ]);
  await assert.rejects(
    profiles.read(account),
    (error: unknown) => error instanceof ApiError && error.status === 403,
  );
  await assert.rejects(
    profiles.update(account, change),
    (error: unknown) => error instanceof ApiError && error.status === 403,
  );
  assert.equal((await profiles.read(other)).displayName, 'Another account');
  const deletedOwner = { ...account, id: randomUUID(), sessionId: randomUUID() };
  await profiles.saveContact(deletedOwner, { ...contactChange, idempotencyKey: randomUUID() });
  await pool.query('DELETE FROM ridr.command_receipts WHERE actor_id=$1', [deletedOwner.id]);
  await pool.query('DELETE FROM ridr.profiles WHERE id=$1', [deletedOwner.id]);
  assert.equal(
    (await pool.query('SELECT 1 FROM ridr.emergency_contacts WHERE user_id=$1', [deletedOwner.id]))
      .rowCount,
    0,
  );
});
