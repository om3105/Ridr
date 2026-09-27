import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import { ApiError, unavailable } from './api-errors.js';
import { UUID, type TokenVerifier, type VerifiedAccount } from './auth.js';
import type { OperationalLogger } from './logging.js';
import { deriveSummaryMetrics, type SummaryPeriod, type SummarySample } from './summary-metrics.js';

export const RIDE_SUMMARY = Symbol('RIDE_SUMMARY');

type RideRow = {
  id: string;
  name: string;
  started_at: Date;
  ended_at: Date;
  member_id: string;
  display_name: string;
  joined_at: Date;
  left_at: Date | null;
};
type SampleRow = {
  id: string;
  captured_at: Date;
  received_at: Date;
  lat: number;
  lon: number;
  accuracy_m: number;
  consent_epoch: string;
};
type PeriodRow = { started_at: Date; stopped_at: Date };
type EventRow = {
  member_id: string;
  display_name: string;
  kind: 'left' | 'sharing_stopped';
  at: Date;
};
type HistoryCursor = {
  actor: string;
  resource: 'history';
  order: 'endedAt,id:desc';
  endedAt: string;
  id: string;
};
function historyCursor(value: string | undefined, account: VerifiedAccount): HistoryCursor | null {
  if (!value) return null;
  try {
    if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as HistoryCursor;
    if (
      cursor.actor !== account.id || cursor.resource !== 'history' ||
      cursor.order !== 'endedAt,id:desc' || !UUID.test(cursor.id) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.endedAt) ||
      !Number.isFinite(Date.parse(cursor.endedAt))
    ) throw new Error();
    return cursor;
  } catch {
    throw new ApiError(400, 'INVALID_REQUEST', 'Invalid ride history cursor. Refresh history.');
  }
}

export class RideSummaryStore {
  private readonly pool: Pool;
  constructor(
    databaseUrl: string,
    private readonly logger: OperationalLogger,
  ) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      application_name: 'ridr-summary',
      max: 3,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      statement_timeout: 10000,
    });
    this.pool.on('error', () => logger.write('summary_pool_error'));
  }
  async close() {
    await this.pool.end();
  }
  async read(account: VerifiedAccount, rideId: string) {
    const client = await this.pool.connect().catch(() => {
      throw unavailable();
    });
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const access = await client.query<RideRow>(
        `SELECT r.id,r.name,r.started_at,r.ended_at,m.id AS member_id,m.joined_at,m.left_at,p.display_name
         FROM ridr.rides r JOIN ridr.memberships m ON m.ride_id=r.id AND m.user_id=$2
         JOIN ridr.profiles p ON p.id=m.user_id
         WHERE r.id=$1 AND r.state='ended' AND r.started_at IS NOT NULL
           AND r.ended_at + interval '90 days' > clock_timestamp()
           AND m.joined_at < r.ended_at AND coalesce(m.left_at,r.ended_at)>r.started_at
           AND p.account_state='active' AND p.deleted_at IS NULL`,
        [rideId, account.id],
      );
      const ride = access.rows[0];
      if (!ride) {
        const expired = await client.query(
          `SELECT 1 FROM ridr.rides r JOIN ridr.memberships m ON m.ride_id=r.id AND m.user_id=$2
           JOIN ridr.profiles p ON p.id=m.user_id
           WHERE r.id=$1 AND r.state='ended' AND r.started_at IS NOT NULL
             AND r.ended_at + interval '90 days' <= clock_timestamp()
             AND m.joined_at < r.ended_at AND coalesce(m.left_at,r.ended_at)>r.started_at
             AND p.account_state='active' AND p.deleted_at IS NULL`,
          [rideId, account.id],
        );
        if (expired.rowCount) throw new ApiError(410, 'HISTORY_EXPIRED', 'This ride history has expired.');
        throw new ApiError(404, 'NOT_FOUND', 'Ride summary unavailable.');
      }
      const start = new Date(Math.max(ride.started_at.getTime(), ride.joined_at.getTime()));
      const end = new Date(Math.min(ride.ended_at.getTime(), ride.left_at?.getTime() ?? Infinity));
      const samples = await client.query<SampleRow>(
        `SELECT s.id,s.captured_at,s.received_at,s.lat,s.lon,s.accuracy_m,s.consent_epoch
         FROM ridr.location_samples s
         JOIN ridr.sharing_periods sp ON sp.membership_id=s.membership_id AND sp.epoch=s.consent_epoch
         WHERE s.ride_id=$1 AND s.membership_id=$2
           AND s.captured_at BETWEEN $3 AND $4
           AND s.captured_at>=sp.started_at AND s.captured_at<=coalesce(sp.stopped_at,$4::timestamptz)
           AND (s.expires_at IS NULL OR s.expires_at>clock_timestamp())
         ORDER BY s.captured_at,s.id`,
        [ride.id, ride.member_id, start, end],
      );
      const periods = await client.query<PeriodRow>(
        `SELECT started_at,coalesce(stopped_at,$2::timestamptz) AS stopped_at
         FROM ridr.sharing_periods WHERE membership_id=$1 ORDER BY started_at,epoch`,
        [ride.member_id, end],
      );
      const events = await client.query<EventRow>(
        `SELECT m.id AS member_id,
           CASE WHEN p.account_state='active' AND p.deleted_at IS NULL THEN p.display_name ELSE 'Former member' END AS display_name,
           'left' AS kind,m.left_at AS at
         FROM ridr.memberships m JOIN ridr.profiles p ON p.id=m.user_id
         WHERE m.ride_id=$1 AND m.left_at IS NOT NULL AND m.left_at>= $2 AND m.left_at<=$3
         UNION ALL
         SELECT m.id AS member_id,
           CASE WHEN p.account_state='active' AND p.deleted_at IS NULL THEN p.display_name ELSE 'Former member' END AS display_name,
           'sharing_stopped' AS kind,sp.stopped_at AS at
         FROM ridr.sharing_periods sp JOIN ridr.memberships m ON m.id=sp.membership_id
         JOIN ridr.profiles p ON p.id=m.user_id
         WHERE m.ride_id=$1 AND sp.stopped_at IS NOT NULL AND sp.stopped_at>= $2 AND sp.stopped_at<=$3
         ORDER BY at,member_id LIMIT 201`,
        [ride.id, ride.started_at, end],
      );
      await client.query('COMMIT');
      const values: SummarySample[] = samples.rows.map((row) => ({
        id: row.id,
        capturedAt: row.captured_at.toISOString(),
        receivedAt: row.received_at.toISOString(),
        lat: row.lat,
        lon: row.lon,
        accuracyM: row.accuracy_m,
        consentEpoch: Number(row.consent_epoch),
      }));
      const consent: SummaryPeriod[] = periods.rows.map((row) => ({
        startedAt: row.started_at.toISOString(),
        stoppedAt: row.stopped_at.toISOString(),
      }));
      const metrics = deriveSummaryMetrics(values, consent, start.toISOString(), end.toISOString());
      return {
        rideId: ride.id,
        rideName: ride.name,
        memberId: ride.member_id,
        displayName: ride.display_name,
        startedAt: ride.started_at.toISOString(),
        endedAt: ride.ended_at.toISOString(),
        participationStartedAt: start.toISOString(),
        participationEndedAt: end.toISOString(),
        recordedDistanceM: metrics.recordedDistanceM,
        participationDurationSeconds: metrics.participationDurationSeconds,
        elapsedPaceMinPerKm: metrics.elapsedPaceMinPerKm,
        averageSpeedKmh: metrics.averageSpeedKmh,
        sampleCount: metrics.sampleCount,
        excludedSamples: metrics.excludedSamples,
        gapCount: metrics.gapCount,
        gaps: metrics.gaps,
        trace: metrics.trace,
        memberEvents: events.rows.slice(0, 200).map((event) => ({
          memberId: event.member_id,
          displayName: event.display_name,
          kind: event.kind,
          at: event.at.toISOString(),
        })),
        memberEventsComplete: events.rows.length <= 200,
        updatedAt:
          metrics.latestSampleReceivedAt > ride.ended_at.toISOString()
            ? metrics.latestSampleReceivedAt
            : ride.ended_at.toISOString(),
        expiresAt: new Date(ride.ended_at.getTime() + 90 * 86400000).toISOString(),
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof ApiError) throw error;
      this.logger.write('summary_query_error', {
        code:
          error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown',
      });
      throw unavailable();
    } finally {
      client.release();
    }
  }
  async list(account: VerifiedAccount, limit: number, cursorValue?: string) {
    const cursor = historyCursor(cursorValue, account);
    let rows: { id: string; cursor_at: string }[];
    try {
      const result = await this.pool.query<{ id: string; cursor_at: string }>(
        `SELECT r.id,
           to_char(r.ended_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
         FROM ridr.memberships m JOIN ridr.rides r ON r.id=m.ride_id
         JOIN ridr.profiles p ON p.id=m.user_id
         WHERE m.user_id=$1 AND p.account_state='active' AND p.deleted_at IS NULL
           AND r.state='ended' AND r.started_at IS NOT NULL
           AND r.ended_at + interval '90 days' > clock_timestamp()
           AND m.joined_at < r.ended_at AND coalesce(m.left_at,r.ended_at)>r.started_at
           AND ($2::timestamptz IS NULL OR (r.ended_at,r.id)<($2::timestamptz,$3::uuid))
         ORDER BY r.ended_at DESC,r.id DESC LIMIT $4`,
        [account.id, cursor?.endedAt ?? null, cursor?.id ?? null, limit + 1],
      );
      rows = result.rows;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      this.logger.write('history_query_error', {
        code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown',
      });
      throw unavailable();
    }
    const page = rows.slice(0, limit);
    const items = [];
    for (const row of page) {
      try {
        const summary = await this.read(account, row.id);
        items.push({
          rideId: summary.rideId,
          rideName: summary.rideName,
          memberId: summary.memberId,
          startedAt: summary.startedAt,
          endedAt: summary.endedAt,
          recordedDistanceM: summary.recordedDistanceM,
          participationDurationSeconds: summary.participationDurationSeconds,
          elapsedPaceMinPerKm: summary.elapsedPaceMinPerKm,
          updatedAt: summary.updatedAt,
          expiresAt: summary.expiresAt,
        });
      } catch (error) {
        if (!(error instanceof ApiError) || ![404, 410].includes(error.status)) throw error;
      }
    }
    const last = page.at(-1);
    return {
      items,
      nextCursor: rows.length > limit && last
        ? Buffer.from(JSON.stringify({
            actor: account.id, resource: 'history', order: 'endedAt,id:desc',
            endedAt: last.cursor_at, id: last.id,
          } satisfies HistoryCursor)).toString('base64url')
        : null,
    };
  }
}

@Controller()
export class RideSummaryController {
  constructor(
    @Inject(RIDE_SUMMARY)
    private readonly services: { verifier: TokenVerifier; store: RideSummaryStore } | null,
  ) {}
  @Get('history')
  async list(
    @Req() request: Request,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!this.services) throw unavailable();
    const account = await this.services.verifier.verify(request.headers.authorization);
    if (Object.keys(query).some((key) => key !== 'limit' && key !== 'cursor'))
      throw new ApiError(400, 'INVALID_REQUEST', 'Invalid history query.');
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
        (query.limit !== undefined && (typeof query.limit !== 'string' || !/^[1-9]\d{0,2}$/.test(query.limit))) ||
        (query.cursor !== undefined && (typeof query.cursor !== 'string' || query.cursor.length === 0)))
      throw new ApiError(400, 'INVALID_REQUEST', 'Invalid history query.');
    return {
      data: await this.services.store.list(account, limit, query.cursor as string | undefined),
      requestId: String(response.getHeader('X-Request-Id')),
    };
  }
  @Get('history/:rideId')
  async read(
    @Req() request: Request,
    @Param('rideId') rideId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!this.services) throw unavailable();
    const account = await this.services.verifier.verify(request.headers.authorization);
    if (!UUID.test(rideId)) throw new ApiError(400, 'INVALID_REQUEST', 'Invalid ride identity.');
    return {
      data: await this.services.store.read(account, rideId.toLowerCase()),
      requestId: String(response.getHeader('X-Request-Id')),
    };
  }
}
