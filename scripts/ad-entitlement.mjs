import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseEntitlementArgs(args, now = new Date()) {
  const [action, userId, until, ...extra] = args;
  if (!['grant', 'revoke'].includes(action) || !uuid.test(userId ?? '') ||
      extra.length || (action === 'revoke' && until !== undefined)) {
    throw new Error('Usage: ad-entitlement grant <user-uuid> <UTC-expiry> | revoke <user-uuid>');
  }
  if (action === 'revoke') return { action, userId: userId.toLowerCase() };
  if (typeof until !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(until)) {
    throw new Error('Expiry must be an explicit UTC timestamp, for example 2027-01-01T00:00:00Z.');
  }
  const expiry = new Date(until);
  if (!Number.isFinite(expiry.getTime()) ||
      expiry.toISOString() !== (until.includes('.') ? until : until.replace('Z', '.000Z')) ||
      expiry.getTime() <= now.getTime() ||
      expiry.getTime() > now.getTime() + 366 * 86400000) {
    throw new Error('Expiry must be in the future and at most 366 days away.');
  }
  return { action, userId: userId.toLowerCase(), until: expiry.toISOString() };
}

export async function changeEntitlement(client, command) {
  const identity = await client.query('SELECT current_user AS actor');
  if (identity.rows[0]?.actor !== 'ridr_migrator')
    throw new Error('Use the private ridr_migrator database connection.');
  if (command.action === 'revoke') {
    const result = await client.query('DELETE FROM ridr.ad_entitlements WHERE user_id=$1',
      [command.userId]);
    return result.rowCount === 1 ? 'revoked' : 'already absent';
  }
  const result = await client.query(
    `INSERT INTO ridr.ad_entitlements(user_id,ad_free_until)
     SELECT id,$2::timestamptz FROM ridr.profiles
     WHERE id=$1 AND account_state='active' AND deleted_at IS NULL
     ON CONFLICT (user_id) DO UPDATE SET ad_free_until=EXCLUDED.ad_free_until,
       provisioned_at=clock_timestamp()
     RETURNING user_id`, [command.userId, command.until]);
  if (result.rowCount !== 1) throw new Error('No active account has that ID.');
  return 'granted';
}

async function main() {
  const command = parseEntitlementArgs(process.argv.slice(2));
  if (!process.env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL is required.');
  const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL,
    connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const result = await changeEntitlement(client, command);
    console.log(`Ad-free test entitlement ${result} for ${command.userId}.`);
  } finally { await client.end(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))) {
  main().catch((error) => {
    console.error(`Entitlement change failed: ${error.code ?? error.message}`);
    process.exitCode = 1;
  });
}
