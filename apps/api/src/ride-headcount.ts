import { randomUUID } from 'node:crypto';
import { ApiError } from './api-errors.js';
import { stationary, type ManagementContext } from './ride-management.js';
import { currentPair, pairStatuses } from './ride-readiness.js';
import { integer } from './ride-records.js';
import type { HeadcountPair, HeadcountRound, MotionContext } from './ride-types.js';

type RoundRow = {
  id: string;
  ride_id: string;
  leader_member_id: string;
  pairing_revision: string;
  opened_at: Date;
  completed_at: Date | null;
  revision: string;
};
const conflict = () =>
  new ApiError(
    409,
    'HEADCOUNT_CONFLICT',
    'This rest-stop round or pair changed. Refresh and try again.',
  );
function eligible(context: ManagementContext) {
  if (context.ride.state !== 'active' || context.own.left_at) throw conflict();
  if (context.own.id !== context.ride.leader_member_id)
    throw new ApiError(403, 'FORBIDDEN', 'Only the current leader can manage a headcount.');
}
async function latest(context: ManagementContext): Promise<RoundRow | null> {
  const result = await context.client.query<RoundRow>(
    `SELECT * FROM ridr.headcount_rounds WHERE ride_id=$1
     ORDER BY (completed_at IS NULL) DESC, opened_at DESC, id DESC LIMIT 1`,
    [context.ride.id],
  );
  return result.rows[0] ?? null;
}
async function openRound(context: ManagementContext, roundId: string): Promise<RoundRow> {
  const result = await context.client.query<RoundRow>(
    `SELECT * FROM ridr.headcount_rounds WHERE id=$1 AND ride_id=$2 AND completed_at IS NULL FOR UPDATE`,
    [roundId, context.ride.id],
  );
  const round = result.rows[0];
  if (!round || round.leader_member_id !== context.own.id) throw conflict();
  return round;
}
async function project(context: ManagementContext, round: RoundRow): Promise<HeadcountRound> {
  const open = round.completed_at === null;
  const pairs = open
    ? (await pairStatuses(context)).map((pair) => ({
        id: pair.id,
        riderMemberId: pair.rider.memberId,
        pillionMemberId: pair.pillion.memberId,
        riderName: pair.rider.displayName,
        pillionName: pair.pillion.displayName,
      }))
    : (
        await context.client.query<{
          id: string;
          rider_member_id: string;
          pillion_member_id: string;
          rider_name: string;
          pillion_name: string;
        }>(
          `SELECT p.id,p.rider_member_id,p.pillion_member_id,rp.display_name AS rider_name,pp.display_name AS pillion_name
         FROM ridr.headcount_confirmations hc JOIN ridr.pairs p ON p.id=hc.pair_id
         JOIN ridr.memberships rm ON rm.id=p.rider_member_id JOIN ridr.profiles rp ON rp.id=rm.user_id
         JOIN ridr.memberships pm ON pm.id=p.pillion_member_id JOIN ridr.profiles pp ON pp.id=pm.user_id
         WHERE hc.round_id=$1 ORDER BY p.id`,
          [round.id],
        )
      ).rows.map((pair) => ({
        id: pair.id,
        riderMemberId: pair.rider_member_id,
        pillionMemberId: pair.pillion_member_id,
        riderName: pair.rider_name,
        pillionName: pair.pillion_name,
      }));
  const confirmations = await context.client.query<{ pair_id: string; confirmed_at: Date }>(
    `SELECT hc.pair_id,hc.confirmed_at FROM ridr.headcount_confirmations hc
     JOIN ridr.pairs p ON p.id=hc.pair_id
     JOIN ridr.scan_receipts receipt ON receipt.id=hc.scan_receipt_id
     JOIN ridr.scan_challenges challenge ON challenge.id=receipt.challenge_id
     WHERE hc.round_id=$1 AND hc.ride_id=$2 AND hc.scanned_by_member_id=$3
       AND receipt.scanned_by_member_id=$3 AND receipt.ride_id=$2
       AND challenge.round_id=$1 AND challenge.ride_id=$2 AND challenge.pair_id=hc.pair_id
       AND challenge.issued_by_member_id IN (p.rider_member_id,p.pillion_member_id)
       AND challenge.issued_by_member_id<>hc.scanned_by_member_id
       AND challenge.created_at >= p.created_at
       AND challenge.consumed_at IS NOT NULL AND receipt.accepted_at >= challenge.created_at
       AND receipt.accepted_at < challenge.expires_at AND receipt.accepted_at >= $4
       AND hc.confirmed_at >= receipt.accepted_at`,
    [round.id, context.ride.id, round.leader_member_id, round.opened_at],
  );
  const confirmed = new Map(confirmations.rows.map((row) => [row.pair_id, row.confirmed_at]));
  const statuses: (HeadcountPair & { riderMemberId: string; pillionMemberId: string })[] =
    pairs.map((pair) => ({
      ...pair,
      confirmed: confirmed.has(pair.id),
      confirmedAt: confirmed.get(pair.id)?.toISOString() ?? null,
    }));
  const leader = context.own.id === context.ride.leader_member_id;
  const visible = leader
    ? statuses
    : statuses.filter(
        (pair) => pair.riderMemberId === context.own.id || pair.pillionMemberId === context.own.id,
      );
  const display = (pair: (typeof statuses)[number]): HeadcountPair => ({
    id: pair.id,
    riderName: pair.riderName,
    pillionName: pair.pillionName,
    confirmed: pair.confirmed,
    confirmedAt: pair.confirmedAt,
  });
  return {
    id: round.id,
    state: open ? 'open' : 'completed',
    revision: integer(round.revision),
    openedAt: round.opened_at.toISOString(),
    completedAt: round.completed_at?.toISOString() ?? null,
    pairingRevision: integer(round.pairing_revision),
    pairIds: visible.map((pair) => pair.id),
    confirmedPairIds: visible.filter((pair) => pair.confirmed).map((pair) => pair.id),
    pairs: leader ? statuses.map(display) : null,
    ownPair: statuses.find(
      (pair) => pair.riderMemberId === context.own.id || pair.pillionMemberId === context.own.id,
    )
      ? display(
          statuses.find(
            (pair) =>
              pair.riderMemberId === context.own.id || pair.pillionMemberId === context.own.id,
          )!,
        )
      : null,
  };
}

export async function readHeadcount(context: ManagementContext): Promise<HeadcountRound | null> {
  if (context.ride.state === 'ended' || context.own.left_at)
    throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
  const round = await latest(context);
  return round ? project(context, round) : null;
}

export async function beginHeadcount(
  context: ManagementContext,
  change: MotionContext,
): Promise<HeadcountRound> {
  eligible(context);
  await stationary(context.client, context.own.id, change);
  const active = await context.client.query(
    'SELECT 1 FROM ridr.headcount_rounds WHERE ride_id=$1 AND completed_at IS NULL',
    [context.ride.id],
  );
  if (active.rowCount) throw conflict();
  const result = await context.client.query<RoundRow>(
    `INSERT INTO ridr.headcount_rounds (id,ride_id,leader_member_id,pairing_revision)
     VALUES ($1,$2,$3,(SELECT pairing_revision FROM ridr.rides WHERE id=$2)) RETURNING *`,
    [randomUUID(), context.ride.id, context.own.id],
  );
  return project(context, result.rows[0]!);
}

export async function confirmHeadcount(
  context: ManagementContext,
  roundId: string,
  pairId: string,
  change: MotionContext & { scanReceiptId: string },
): Promise<HeadcountRound> {
  eligible(context);
  const pair = await currentPair(context, pairId, true);
  const round = await openRound(context, roundId);
  await stationary(context.client, context.own.id, change);
  const receipt = await context.client.query(
    `SELECT 1 FROM ridr.scan_receipts receipt
     JOIN ridr.scan_challenges challenge ON challenge.id=receipt.challenge_id
     WHERE receipt.id=$1 AND receipt.ride_id=$2 AND receipt.scanned_by_member_id=$3
       AND challenge.ride_id=$2 AND challenge.round_id=$4 AND challenge.pair_id=$5
       AND challenge.issued_by_member_id IN ($6,$7) AND challenge.issued_by_member_id<>$3
       AND challenge.created_at >= $8 AND challenge.created_at >= $9
       AND challenge.consumed_at IS NOT NULL AND challenge.expires_at > clock_timestamp()
       AND receipt.accepted_at >= challenge.created_at AND receipt.accepted_at < challenge.expires_at`,
    [
      change.scanReceiptId,
      context.ride.id,
      context.own.id,
      round.id,
      pair.id,
      pair.rider_member_id,
      pair.pillion_member_id,
      round.opened_at,
      pair.created_at,
    ],
  );
  if (!receipt.rowCount) throw conflict();
  await context.client.query(
    `INSERT INTO ridr.headcount_confirmations
     (ride_id,round_id,pair_id,scanned_by_member_id,confirmed_at,scan_receipt_id)
     VALUES ($1,$2,$3,$4,clock_timestamp(),$5) ON CONFLICT (round_id,pair_id) DO NOTHING`,
    [context.ride.id, round.id, pair.id, context.own.id, change.scanReceiptId],
  );
  return project(context, round);
}

export async function completeHeadcount(
  context: ManagementContext,
  roundId: string,
  change: MotionContext & { revision: number },
): Promise<HeadcountRound> {
  eligible(context);
  await context.client.query(
    'SELECT id FROM ridr.pairs WHERE ride_id=$1 AND ended_at IS NULL ORDER BY id FOR UPDATE',
    [context.ride.id],
  );
  const round = await openRound(context, roundId);
  if (integer(round.revision) !== change.revision)
    throw new ApiError(
      412,
      'REVISION_CONFLICT',
      'Headcount changed. Refresh before completing it.',
    );
  await stationary(context.client, context.own.id, change);
  const progress = await project(context, round);
  if (progress.confirmedPairIds.length !== progress.pairIds.length)
    throw new ApiError(
      409,
      'HEADCOUNT_INCOMPLETE',
      'Scan every current pair before completing this rest stop.',
    );
  const completed = await context.client.query<RoundRow>(
    'UPDATE ridr.headcount_rounds SET completed_at=clock_timestamp(),revision=revision+1 WHERE id=$1 RETURNING *',
    [round.id],
  );
  return project(context, completed.rows[0]!);
}
