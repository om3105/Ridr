import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ApiError } from './api-errors.js';
import { integer } from './ride-records.js';
import { stationary, type ManagementContext } from './ride-management.js';
import type {
  MotionContext,
  PairReadiness,
  ReadinessAttestation,
  ReadinessOverview,
  ScanChallenge,
  ScanReceipt,
} from './ride-types.js';

const conflict = () =>
  new ApiError(
    409,
    'READINESS_CONFLICT',
    'This scan or pair changed. Ask for a fresh readiness QR.',
  );
const hash = (token: string) => createHash('sha256').update(token).digest();
type PairRow = {
  id: string;
  ride_id: string;
  rider_member_id: string;
  pillion_member_id: string;
  revision: string;
  created_at: Date;
};

export async function currentPair(
  context: ManagementContext,
  pairId: string,
  allowLeader = false,
): Promise<PairRow> {
  if (
    context.ride.transport !== 'motorcycle' ||
    context.ride.state === 'ended' ||
    context.own.left_at
  )
    throw conflict();
  const result = await context.client.query<PairRow>(
    `SELECT id,ride_id,rider_member_id,pillion_member_id,revision,created_at FROM ridr.pairs
     WHERE id=$1 AND ride_id=$2 AND ended_at IS NULL FOR UPDATE`,
    [pairId, context.ride.id],
  );
  const pair = result.rows[0];
  if (
    !pair ||
    (context.own.id !== pair.rider_member_id &&
      context.own.id !== pair.pillion_member_id &&
      !(allowLeader && context.own.id === context.ride.leader_member_id))
  )
    throw conflict();
  const members = await context.client.query<{ membership_id: string }>(
    `SELECT membership_id FROM ridr.active_pair_members WHERE pair_id=$1 AND ride_id=$2 ORDER BY membership_id`,
    [pairId, context.ride.id],
  );
  if (
    members.rowCount !== 2 ||
    !members.rows.some((row) => row.membership_id === pair.rider_member_id) ||
    !members.rows.some((row) => row.membership_id === pair.pillion_member_id)
  )
    throw conflict();
  return pair;
}

export async function pairStatuses(context: ManagementContext): Promise<PairReadiness[]> {
  const result = await context.client.query<{
    id: string;
    revision: string;
    rider_member_id: string;
    pillion_member_id: string;
    rider_name: string;
    pillion_name: string;
    confirmed_at: Date | null;
    ready: boolean;
  }>(
    `SELECT p.id,p.revision,p.rider_member_id,p.pillion_member_id,
      rider_profile.display_name AS rider_name,pillion_profile.display_name AS pillion_name,
      CASE WHEN valid.ready THEN ready.confirmed_at ELSE NULL END AS confirmed_at,
      valid.ready
     FROM ridr.pairs p
     JOIN ridr.memberships rider ON rider.id=p.rider_member_id
     JOIN ridr.memberships pillion ON pillion.id=p.pillion_member_id
     JOIN ridr.profiles rider_profile ON rider_profile.id=rider.user_id
     JOIN ridr.profiles pillion_profile ON pillion_profile.id=pillion.user_id
     LEFT JOIN ridr.readiness ready ON ready.pair_id=p.id AND ready.invalidated_at IS NULL
     LEFT JOIN ridr.scan_receipts receipt ON receipt.id=ready.scan_receipt_id
     LEFT JOIN ridr.scan_challenges challenge ON challenge.id=receipt.challenge_id
     CROSS JOIN LATERAL (SELECT COALESCE((
       $2='motorcycle' AND rider.left_at IS NULL AND pillion.left_at IS NULL AND
       rider.physical_role='rider' AND pillion.physical_role='pillion' AND
       ready.pair_id IS NOT NULL AND ready.attesting_member_id=p.pillion_member_id AND
       ready.helmet_attested AND ready.ready_attested AND
       receipt.id IS NOT NULL AND receipt.ride_id=p.ride_id AND challenge.pair_id=p.id AND
       challenge.ride_id=p.ride_id AND challenge.issued_by_member_id IN (p.rider_member_id,p.pillion_member_id) AND
       receipt.scanned_by_member_id IN (p.rider_member_id,p.pillion_member_id) AND
       receipt.scanned_by_member_id <> challenge.issued_by_member_id AND receipt.accepted_at >= challenge.created_at AND
       challenge.round_id IS NULL AND challenge.consumed_at IS NOT NULL AND
       receipt.accepted_at >= p.created_at AND receipt.accepted_at < challenge.expires_at AND
       ready.confirmed_at >= receipt.accepted_at AND ready.confirmed_at <= clock_timestamp() AND
       (SELECT count(*) FROM ridr.active_pair_members ap WHERE ap.pair_id=p.id
        AND ap.membership_id IN (p.rider_member_id,p.pillion_member_id))=2
     ),false) AS ready) valid
     WHERE p.ride_id=$1 AND p.ended_at IS NULL ORDER BY p.id`,
    [context.ride.id, context.ride.transport],
  );
  return result.rows.map((row) => ({
    id: row.id,
    revision: integer(row.revision),
    rider: { memberId: row.rider_member_id, displayName: row.rider_name },
    pillion: { memberId: row.pillion_member_id, displayName: row.pillion_name },
    ready: row.ready,
    confirmedAt: row.confirmed_at?.toISOString() ?? null,
  }));
}

export async function overview(context: ManagementContext): Promise<ReadinessOverview> {
  if (context.ride.state === 'ended' || context.own.left_at)
    throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
  const pairs = await pairStatuses(context);
  return {
    ownMemberId: context.own.id,
    ownPair:
      pairs.find(
        (pair) =>
          pair.rider.memberId === context.own.id || pair.pillion.memberId === context.own.id,
      ) ?? null,
    leaderPairs: context.own.id === context.ride.leader_member_id ? pairs : null,
  };
}

export async function issueScan(
  context: ManagementContext,
  pairId: string,
  change: MotionContext & { roundId: string | null },
): Promise<ScanChallenge> {
  const pair = await currentPair(context, pairId);
  await stationary(context.client, context.own.id, change);
  if (change.roundId !== null) {
    if (context.ride.state !== 'active') throw conflict();
    const round = await context.client.query(
      'SELECT 1 FROM ridr.headcount_rounds WHERE id=$1 AND ride_id=$2 AND completed_at IS NULL',
      [change.roundId, context.ride.id],
    );
    if (!round.rowCount) throw conflict();
  }
  await context.client.query(
    `UPDATE ridr.scan_challenges SET expires_at=clock_timestamp()
     WHERE pair_id=$1 AND issued_by_member_id=$2 AND round_id IS NOT DISTINCT FROM $3::uuid
       AND consumed_at IS NULL AND created_at < clock_timestamp() AND expires_at > clock_timestamp()`,
    [pair.id, context.own.id, change.roundId],
  );
  const token = randomBytes(32).toString('base64url');
  const challengeId = randomUUID();
  const result = await context.client.query<{ expires_at: Date }>(
    `INSERT INTO ridr.scan_challenges (id,ride_id,pair_id,round_id,issued_by_member_id,token_hash,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,now()+interval '5 minutes') RETURNING expires_at`,
    [challengeId, context.ride.id, pair.id, change.roundId, context.own.id, hash(token)],
  );
  return { challengeId, token, expiresAt: result.rows[0]!.expires_at.toISOString() };
}

export async function acceptScan(
  context: ManagementContext,
  pairId: string,
  change: MotionContext & { challengeId: string; scannedToken: string },
): Promise<ScanReceipt> {
  const pair = await currentPair(context, pairId, true);
  await stationary(context.client, context.own.id, change);
  const result = await context.client.query<{
    issued_by_member_id: string;
    round_id: string | null;
    expires_at: Date;
    consumed_at: Date | null;
    created_at: Date;
  }>(
    `SELECT issued_by_member_id,round_id,expires_at,consumed_at,created_at FROM ridr.scan_challenges
     WHERE id=$1 AND ride_id=$2 AND pair_id=$3 AND token_hash=$4 FOR UPDATE`,
    [change.challengeId, context.ride.id, pair.id, hash(change.scannedToken)],
  );
  const challenge = result.rows[0];
  if (
    !challenge ||
    challenge.consumed_at ||
    challenge.expires_at.getTime() <= Date.now() ||
    challenge.created_at.getTime() < pair.created_at.getTime() ||
    challenge.issued_by_member_id === context.own.id ||
    ![pair.rider_member_id, pair.pillion_member_id].includes(challenge.issued_by_member_id)
  )
    throw conflict();
  if (challenge.round_id === null) {
    if (![pair.rider_member_id, pair.pillion_member_id].includes(context.own.id)) throw conflict();
  } else {
    if (context.ride.state !== 'active' || context.own.id !== context.ride.leader_member_id)
      throw conflict();
    const round = await context.client.query<{ opened_at: Date }>(
      'SELECT opened_at FROM ridr.headcount_rounds WHERE id=$1 AND ride_id=$2 AND completed_at IS NULL AND leader_member_id=$3',
      [challenge.round_id, context.ride.id, context.own.id],
    );
    if (!round.rows[0] || challenge.created_at < round.rows[0].opened_at) throw conflict();
  }
  const consumed = await context.client.query(
    `UPDATE ridr.scan_challenges SET consumed_at=clock_timestamp()
     WHERE id=$1 AND consumed_at IS NULL AND expires_at > clock_timestamp() RETURNING id`,
    [change.challengeId],
  );
  if (!consumed.rowCount) throw conflict();
  const scanReceiptId = randomUUID();
  await context.client.query(
    `INSERT INTO ridr.scan_receipts (id,challenge_id,ride_id,scanned_by_member_id,accepted_at)
     VALUES ($1,$2,$3,$4,clock_timestamp())`,
    [scanReceiptId, change.challengeId, context.ride.id, context.own.id],
  );
  return { scanReceiptId, pairId: pair.id, expiresAt: challenge.expires_at.toISOString() };
}

export async function attest(
  context: ManagementContext,
  pairId: string,
  change: MotionContext & {
    revision: number;
    helmetConfirmed: true;
    ready: true;
    scanReceiptId: string;
  },
): Promise<ReadinessAttestation> {
  const pair = await currentPair(context, pairId);
  if (context.own.id !== pair.pillion_member_id || integer(pair.revision) !== change.revision)
    throw conflict();
  if (!change.helmetConfirmed || !change.ready) throw conflict();
  await stationary(context.client, context.own.id, change);
  const receipt = await context.client.query<{ accepted_at: Date }>(
    `SELECT receipt.accepted_at FROM ridr.scan_receipts receipt
     JOIN ridr.scan_challenges challenge ON challenge.id=receipt.challenge_id
     WHERE receipt.id=$1 AND receipt.ride_id=$2 AND receipt.scanned_by_member_id=$3
       AND challenge.ride_id=$2 AND challenge.pair_id=$4 AND challenge.round_id IS NULL
       AND challenge.issued_by_member_id=$5 AND challenge.consumed_at IS NOT NULL
       AND challenge.expires_at > clock_timestamp() AND receipt.accepted_at < challenge.expires_at
       AND receipt.accepted_at >= $6::timestamptz`,
    [
      change.scanReceiptId,
      context.ride.id,
      context.own.id,
      pair.id,
      pair.rider_member_id,
      pair.created_at,
    ],
  );
  if (!receipt.rowCount) throw conflict();
  const inserted = await context.client.query<{ confirmed_at: Date }>(
    `INSERT INTO ridr.readiness (pair_id,attesting_member_id,helmet_attested,ready_attested,confirmed_at,scan_receipt_id)
     VALUES ($1,$2,true,true,clock_timestamp(),$3)
     ON CONFLICT (pair_id) DO NOTHING RETURNING confirmed_at`,
    [pair.id, context.own.id, change.scanReceiptId],
  );
  const existing =
    inserted.rows[0] ??
    (
      await context.client.query<{ confirmed_at: Date }>(
        `SELECT confirmed_at FROM ridr.readiness WHERE pair_id=$1 AND attesting_member_id=$2 AND invalidated_at IS NULL`,
        [pair.id, context.own.id],
      )
    ).rows[0];
  if (!existing) throw conflict();
  return {
    pairId: pair.id,
    memberId: context.own.id,
    helmetConfirmed: true,
    ready: true,
    confirmedAt: existing.confirmed_at.toISOString(),
  };
}
