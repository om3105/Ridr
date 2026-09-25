import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ApiError } from './api-errors.js';
import { integer } from './ride-records.js';
import { stationary, type ManagementContext } from './ride-management.js';
import type { MotionContext, PairInvitation, PairPreview, PairResult } from './ride-types.js';

const conflict = () =>
  new ApiError(409, 'PAIR_CONFLICT', 'Pairing changed. Ask for a fresh QR and try again.');
const hash = (token: string) => createHash('sha256').update(token).digest();
type InviteRow = {
  id: string;
  requester_member_id: string;
  payload: { issuerRevision: number; physicalRole: string };
  challenge_hash: Buffer;
  expires_at: Date;
  canceled_at: Date | null;
  accepted_at: Date | null;
};

function eligible(context: ManagementContext) {
  if (
    context.ride.transport !== 'motorcycle' ||
    context.ride.state === 'ended' ||
    context.own.left_at
  )
    throw conflict();
}
async function free(context: ManagementContext, memberId: string) {
  const occupied = await context.client.query(
    'SELECT 1 FROM ridr.active_pair_members WHERE membership_id=$1',
    [memberId],
  );
  if (occupied.rowCount) throw conflict();
}
async function invitation(
  context: ManagementContext,
  token: string,
  id?: string,
): Promise<InviteRow> {
  const result = await context.client.query<InviteRow>(
    `SELECT id,requester_member_id,payload,challenge_hash,expires_at,canceled_at,accepted_at
     FROM ridr.consent_requests WHERE ride_id=$1 AND kind='pair' AND challenge_hash=$2
       AND ($3::uuid IS NULL OR id=$3) ORDER BY id FOR UPDATE`,
    [context.ride.id, hash(token), id ?? null],
  );
  const row = result.rows[0];
  if (
    !row ||
    !timingSafeEqual(row.challenge_hash, hash(token)) ||
    row.canceled_at ||
    row.accepted_at ||
    row.expires_at.getTime() <= Date.now()
  )
    throw conflict();
  return row;
}
function counterpart(context: ManagementContext, row: InviteRow) {
  const issuer = context.members.find(
    (member) => member.id === row.requester_member_id && !member.left_at,
  );
  if (
    !issuer ||
    issuer.id === context.own.id ||
    issuer.physical_role === context.own.physical_role ||
    integer(issuer.revision) !== row.payload.issuerRevision ||
    issuer.physical_role !== row.payload.physicalRole
  )
    throw conflict();
  return issuer;
}

export async function issue(
  context: ManagementContext,
  change: MotionContext,
): Promise<PairInvitation> {
  eligible(context);
  await stationary(context.client, context.own.id, change);
  await free(context, context.own.id);
  await context.client.query(
    `UPDATE ridr.consent_requests SET canceled_at=clock_timestamp() WHERE ride_id=$1 AND requester_member_id=$2
     AND kind='pair' AND accepted_at IS NULL AND canceled_at IS NULL AND expires_at > clock_timestamp()`,
    [context.ride.id, context.own.id],
  );
  const token = randomBytes(32).toString('base64url');
  const pairInvitationId = randomUUID();
  const result = await context.client.query<{ expires_at: Date }>(
    `INSERT INTO ridr.consent_requests (id,ride_id,requester_member_id,kind,payload,challenge_hash,expires_at)
     VALUES ($1,$2,$3,'pair',$4::jsonb,$5,now()+interval '5 minutes') RETURNING expires_at`,
    [
      pairInvitationId,
      context.ride.id,
      context.own.id,
      JSON.stringify({
        issuerRevision: integer(context.own.revision),
        physicalRole: context.own.physical_role,
      }),
      hash(token),
    ],
  );
  return { pairInvitationId, token, expiresAt: result.rows[0]!.expires_at.toISOString() };
}

export async function preview(
  context: ManagementContext,
  change: MotionContext & { token: string },
): Promise<PairPreview> {
  eligible(context);
  await stationary(context.client, context.own.id, change);
  await free(context, context.own.id);
  const row = await invitation(context, change.token);
  const issuer = counterpart(context, row);
  await free(context, issuer.id);
  return {
    pairInvitationId: row.id,
    counterpart: {
      memberId: issuer.id,
      displayName: issuer.display_name,
      physicalRole: issuer.physical_role,
    },
    expiresAt: row.expires_at.toISOString(),
  };
}

export async function accept(
  context: ManagementContext,
  change: MotionContext & { pairInvitationId: string; token: string; consent: true },
): Promise<PairResult> {
  eligible(context);
  await stationary(context.client, context.own.id, change);
  await free(context, context.own.id);
  const row = await invitation(context, change.token, change.pairInvitationId);
  const issuer = counterpart(context, row);
  await free(context, issuer.id);
  const accepted = await context.client.query(
    `UPDATE ridr.consent_requests SET target_member_id=$2,accepted_at=clock_timestamp()
     WHERE id=$1 AND accepted_at IS NULL AND canceled_at IS NULL AND expires_at > clock_timestamp() RETURNING id`,
    [row.id, context.own.id],
  );
  if (!accepted.rowCount) throw conflict();
  const rider = issuer.physical_role === 'rider' ? issuer : context.own;
  const pillion = issuer.physical_role === 'pillion' ? issuer : context.own;
  const pairId = randomUUID();
  const pair = await context.client.query<{ created_at: Date }>(
    `INSERT INTO ridr.pairs (id,ride_id,rider_member_id,pillion_member_id,consent_request_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING created_at`,
    [pairId, context.ride.id, rider.id, pillion.id, row.id],
  );
  await context.client.query(
    `INSERT INTO ridr.active_pair_members (membership_id,pair_id,ride_id) VALUES ($1,$3,$4),($2,$3,$4)`,
    [rider.id, pillion.id, pairId, context.ride.id],
  );
  await context.client.query(
    'UPDATE ridr.rides SET pairing_revision=pairing_revision+1 WHERE id=$1',
    [context.ride.id],
  );
  await context.client.query(
    `UPDATE ridr.consent_requests SET canceled_at=clock_timestamp() WHERE ride_id=$1 AND kind='pair'
     AND accepted_at IS NULL AND canceled_at IS NULL AND expires_at > clock_timestamp()
     AND requester_member_id IN ($2,$3)`,
    [context.ride.id, rider.id, pillion.id],
  );
  // This receipt proves the scanner saw the pair QR; Day 17 still requires the pillion's own attestation.
  const challengeId = randomUUID();
  const readinessScanReceiptId = randomUUID();
  const challenge = await context.client.query<{ expires_at: Date }>(
    `INSERT INTO ridr.scan_challenges (id,ride_id,pair_id,issued_by_member_id,token_hash,expires_at,consumed_at)
     VALUES ($1,$2,$3,$4,$5,now()+interval '5 minutes',clock_timestamp()) RETURNING expires_at`,
    [challengeId, context.ride.id, pairId, issuer.id, hash(change.token)],
  );
  await context.client.query(
    `INSERT INTO ridr.scan_receipts (id,challenge_id,ride_id,scanned_by_member_id,accepted_at)
     VALUES ($1,$2,$3,$4,clock_timestamp())`,
    [readinessScanReceiptId, challengeId, context.ride.id, context.own.id],
  );
  return {
    pair: {
      id: pairId,
      riderMemberId: rider.id,
      pillionMemberId: pillion.id,
      createdAt: pair.rows[0]!.created_at.toISOString(),
    },
    readinessScanReceiptId,
    readinessScanExpiresAt: challenge.rows[0]!.expires_at.toISOString(),
  };
}

export async function unpair(
  context: ManagementContext,
  pairId: string,
  change: MotionContext,
): Promise<void> {
  eligible(context);
  await stationary(context.client, context.own.id, change);
  const result = await context.client.query<{ rider_member_id: string; pillion_member_id: string }>(
    'SELECT rider_member_id,pillion_member_id FROM ridr.pairs WHERE id=$1 AND ride_id=$2 AND ended_at IS NULL FOR UPDATE',
    [pairId, context.ride.id],
  );
  const pair = result.rows[0];
  if (
    !pair ||
    (pair.rider_member_id !== context.own.id && pair.pillion_member_id !== context.own.id)
  )
    throw conflict();
  await context.client.query(
    'UPDATE ridr.readiness SET invalidated_at=clock_timestamp() WHERE pair_id=$1 AND invalidated_at IS NULL',
    [pairId],
  );
  await context.client.query('DELETE FROM ridr.active_pair_members WHERE pair_id=$1', [pairId]);
  await context.client.query(
    'UPDATE ridr.pairs SET ended_at=clock_timestamp(),revision=revision+1 WHERE id=$1',
    [pairId],
  );
  await context.client.query(
    `DELETE FROM ridr.headcount_confirmations hc USING ridr.headcount_rounds hr
     WHERE hc.round_id=hr.id AND hr.completed_at IS NULL AND hc.pair_id=$1`,
    [pairId],
  );
  await context.client.query(
    `UPDATE ridr.scan_challenges SET expires_at=clock_timestamp() WHERE pair_id=$1 AND consumed_at IS NULL AND created_at < clock_timestamp() AND expires_at > clock_timestamp()`,
    [pairId],
  );
  await context.client.query(
    'UPDATE ridr.rides SET pairing_revision=pairing_revision+1 WHERE id=$1',
    [context.ride.id],
  );
  await context.client.query(
    `UPDATE ridr.headcount_rounds SET revision=revision+1,pairing_revision=(SELECT pairing_revision FROM ridr.rides WHERE id=$1) WHERE ride_id=$1 AND completed_at IS NULL`,
    [context.ride.id],
  );
}
