import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import { ApiError, unavailable } from './api-errors.js';
import { UUID, type TokenVerifier, type VerifiedAccount } from './auth.js';
import type { OperationalLogger } from './logging.js';
import { deriveSummaryMetrics, type SummaryPeriod, type SummarySample } from './summary-metrics.js';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { FileInterceptor } from '@nestjs/platform-express';
import { Body, Delete, HttpCode, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { parseMotion } from './rides.js';
import { stationary } from './ride-management.js';
import { distanceMetres, distanceToRouteMetres, preparePhoto, validPhotoPoint } from './photo-media.js';
import type { MotionContext } from './ride-types.js';

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
type PhotoAccess = { member_id: string; ended_at: Date; display_name: string };
type PhotoRow = {
  id: string;
  ride_id: string;
  owner_member_id: string;
  display_name: string;
  object_key: string;
  bytes: string;
  lat: number;
  lon: number;
  created_at: Date;
  photo_request_hash: Buffer;
  cursor_at?: string;
};
type PhotoCursor = { actor: string; rideId: string; createdAt: string; id: string };
function photoCursor(value: string | undefined, account: VerifiedAccount, rideId: string): PhotoCursor | null {
  if (!value) return null;
  try {
    if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as PhotoCursor;
    if (cursor.actor !== account.id || cursor.rideId !== rideId || !UUID.test(cursor.id) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.createdAt) ||
        !Number.isFinite(Date.parse(cursor.createdAt))) throw new Error();
    return cursor;
  } catch { throw new ApiError(400, 'INVALID_REQUEST', 'Invalid photo cursor. Refresh photos.'); }
}
const photoColumns = `a.id,a.ride_id,a.owner_member_id,
  CASE WHEN p.account_state='active' AND p.deleted_at IS NULL THEN p.display_name ELSE 'Former member' END AS display_name,
  a.object_key,a.bytes,a.lat,a.lon,a.created_at,a.photo_request_hash`;
const photoProjection = (row: PhotoRow, memberId: string) => ({
  id: row.id,
  rideId: row.ride_id,
  authorMemberId: row.owner_member_id,
  authorName: row.display_name,
  routePoint: { lat: row.lat, lon: row.lon },
  byteLength: Number(row.bytes),
  createdAt: row.created_at.toISOString(),
  own: row.owner_member_id === memberId,
});
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
  private readonly photoDir = process.env.PHOTO_MEDIA_DIR ?? resolve(process.cwd(), '../../data/photos');
  private readonly photoSweep: ReturnType<typeof setInterval>;
  private photoOrphanOffset = 0;
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
    this.photoSweep = setInterval(() => {
      void this.sweepPhotos().catch(() => logger.write('photo_sweep_error'));
    }, 3600000);
    this.photoSweep.unref();
  }
  async close() {
    clearInterval(this.photoSweep);
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
      const savedRoute = await client.query<{ points: { lat: number; lon: number }[] }>(
        'SELECT points FROM ridr.routes WHERE ride_id=$1', [ride.id],
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
        routePoints: savedRoute.rows[0]?.points ?? [],
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

  private async photoAccess(client: PoolClient, account: VerifiedAccount, rideId: string): Promise<PhotoAccess> {
    const result = await client.query<PhotoAccess>(
      `SELECT m.id AS member_id,r.ended_at,p.display_name
       FROM ridr.rides r JOIN ridr.memberships m ON m.ride_id=r.id AND m.user_id=$2
       JOIN ridr.profiles p ON p.id=m.user_id
       WHERE r.id=$1 AND r.state='ended' AND r.started_at IS NOT NULL
         AND r.ended_at + interval '90 days' > clock_timestamp()
         AND m.joined_at<r.ended_at AND coalesce(m.left_at,r.ended_at)>r.started_at
         AND p.account_state='active' AND p.deleted_at IS NULL`,
      [rideId, account.id],
    );
    if (!result.rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Ride photos unavailable.');
    return result.rows[0];
  }

  async uploadPhoto(
    account: VerifiedAccount,
    rideId: string,
    upload: { photoId: string; routePoint: { lat: number; lon: number }; motion: MotionContext; bytes: Buffer },
  ) {
    const clean = await preparePhoto(upload.bytes);
    const digest = createHash('sha256').update(upload.bytes).digest();
    const client = await this.pool.connect().catch(() => { throw unavailable(); });
    const filename = `${upload.photoId}.jpg`;
    const path = resolve(this.photoDir, filename);
    let written = false;
    try {
      await client.query('BEGIN');
      const access = await this.photoAccess(client, account, rideId);
      await stationary(client, access.member_id, upload.motion);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [upload.photoId]);
      const existing = await client.query<PhotoRow>(
        `SELECT ${photoColumns} FROM ridr.media_assets a JOIN ridr.memberships m ON m.id=a.owner_member_id
         JOIN ridr.profiles p ON p.id=m.user_id WHERE a.id=$1 AND a.kind='photo'`,
        [upload.photoId],
      );
      const prior = existing.rows[0];
      if (prior) {
        if (prior.ride_id !== rideId || prior.owner_member_id !== access.member_id ||
            !prior.photo_request_hash.equals(digest) || prior.lat !== upload.routePoint.lat ||
            prior.lon !== upload.routePoint.lon)
          throw new ApiError(409, 'PHOTO_CONFLICT', 'This photo ID was used for another upload.');
        await client.query('COMMIT');
        return photoProjection(prior, access.member_id);
      }
      const route = await client.query<{ points: { lat: number; lon: number }[] }>(
        'SELECT points FROM ridr.routes WHERE ride_id=$1', [rideId],
      );
      const onPlannedRoute = distanceToRouteMetres(upload.routePoint, route.rows[0]?.points ?? []) <= 50;
      const samples = onPlannedRoute ? { rows: [] as { lat: number; lon: number }[] } :
        await client.query<{ lat: number; lon: number }>(
          `SELECT s.lat,s.lon FROM ridr.location_samples s
           JOIN ridr.sharing_periods sp ON sp.membership_id=s.membership_id AND sp.epoch=s.consent_epoch
           WHERE s.ride_id=$1 AND s.membership_id=$2 AND s.accuracy_m<=50
             AND s.captured_at>=sp.started_at AND s.captured_at<=coalesce(sp.stopped_at,clock_timestamp())
             AND s.lat BETWEEN $3 AND $4 AND s.lon BETWEEN $5 AND $6 LIMIT 5000`,
          [rideId, access.member_id, upload.routePoint.lat - 0.001, upload.routePoint.lat + 0.001,
            upload.routePoint.lon - 0.001, upload.routePoint.lon + 0.001],
        );
      if (!onPlannedRoute && !samples.rows.some((point) => distanceMetres(point, upload.routePoint) <= 50))
        throw new ApiError(422, 'INVALID_PHOTO_POINT', 'Select a point on your recorded or planned ride route.');
      await mkdir(this.photoDir, { recursive: true, mode: 0o700 });
      await writeFile(path, clean, { flag: 'wx', mode: 0o600 });
      written = true;
      const result = await client.query<PhotoRow>(
        `INSERT INTO ridr.media_assets
           (id,ride_id,owner_member_id,kind,object_key,state,bytes,lat,lon,expires_at,photo_request_hash)
         VALUES ($1,$2,$3,'photo',$4,'ready',$5,$6,$7,$8::timestamptz + interval '90 days',$9)
         RETURNING id,ride_id,owner_member_id,$10::text AS display_name,object_key,bytes,lat,lon,created_at,photo_request_hash`,
        [upload.photoId, rideId, access.member_id, filename, clean.length, upload.routePoint.lat,
          upload.routePoint.lon, access.ended_at, digest, access.display_name],
      );
      await client.query('COMMIT');
      return photoProjection(result.rows[0]!, access.member_id);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (written) await rm(path, { force: true }).catch(() => undefined);
      if (error instanceof ApiError) throw error;
      this.logger.write('photo_upload_error', {
        code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown',
      });
      throw unavailable();
    } finally {
      client.release();
    }
  }

  async listPhotos(account: VerifiedAccount, rideId: string, limit = 50, cursorValue?: string) {
    const cursor = photoCursor(cursorValue, account, rideId);
    const client = await this.pool.connect().catch(() => { throw unavailable(); });
    try {
      await client.query('BEGIN READ ONLY');
      const access = await this.photoAccess(client, account, rideId);
      const result = await client.query<PhotoRow>(
        `SELECT ${photoColumns},
           to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
         FROM ridr.media_assets a
         JOIN ridr.memberships m ON m.id=a.owner_member_id JOIN ridr.profiles p ON p.id=m.user_id
         WHERE a.ride_id=$1 AND a.kind='photo' AND a.state='ready'
           AND a.expires_at>clock_timestamp()
           AND p.account_state='active' AND p.deleted_at IS NULL
           AND ($2::timestamptz IS NULL OR (a.created_at,a.id)<($2::timestamptz,$3::uuid))
         ORDER BY a.created_at DESC,a.id DESC LIMIT $4`,
        [rideId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
      );
      await client.query('COMMIT');
      const page = result.rows.slice(0, limit);
      const last = page.at(-1);
      return { items: page.map((row) => photoProjection(row, access.member_id)),
        nextCursor: result.rows.length > limit && last ? Buffer.from(JSON.stringify({
          actor: account.id, rideId, createdAt: last.cursor_at!, id: last.id,
        } satisfies PhotoCursor)).toString('base64url') : null };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof ApiError) throw error;
      throw unavailable();
    } finally { client.release(); }
  }

  async photoContent(account: VerifiedAccount, rideId: string, photoId: string) {
    const client = await this.pool.connect().catch(() => { throw unavailable(); });
    try {
      await client.query('BEGIN');
      await this.photoAccess(client, account, rideId);
      const result = await client.query<{ object_key: string }>(
        `SELECT a.object_key FROM ridr.media_assets a
         JOIN ridr.memberships m ON m.id=a.owner_member_id JOIN ridr.profiles p ON p.id=m.user_id
         WHERE a.id=$1 AND a.ride_id=$2 AND a.kind='photo' AND a.state='ready'
           AND a.expires_at>clock_timestamp()
           AND p.account_state='active' AND p.deleted_at IS NULL FOR SHARE OF a`,
        [photoId, rideId],
      );
      const key = result.rows[0]?.object_key;
      if (!key || !/^[0-9a-f-]{36}\.jpg$/.test(key)) throw new ApiError(404, 'NOT_FOUND', 'Photo unavailable.');
      const bytes = await readFile(resolve(this.photoDir, key)).catch(() => { throw unavailable(); });
      await client.query('COMMIT');
      return bytes;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof ApiError) throw error;
      throw unavailable();
    } finally { client.release(); }
  }

  async deletePhoto(account: VerifiedAccount, rideId: string, photoId: string) {
    const client = await this.pool.connect().catch(() => { throw unavailable(); });
    let key: string | undefined;
    try {
      await client.query('BEGIN');
      const access = await this.photoAccess(client, account, rideId);
      const result = await client.query<{ object_key: string; owner_member_id: string }>(
        `SELECT object_key,owner_member_id FROM ridr.media_assets
         WHERE id=$1 AND ride_id=$2 AND kind='photo' FOR UPDATE`, [photoId, rideId],
      );
      if (result.rows[0] && result.rows[0].owner_member_id !== access.member_id)
        throw new ApiError(404, 'NOT_FOUND', 'Photo unavailable.');
      key = result.rows[0]?.object_key;
      if (key) await client.query("UPDATE ridr.media_assets SET state='deleting' WHERE id=$1", [photoId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof ApiError) throw error;
      throw unavailable();
    } finally { client.release(); }
    if (!key) return;
    if (!/^[0-9a-f-]{36}\.jpg$/.test(key)) throw unavailable();
    await rm(resolve(this.photoDir, key), { force: true }).catch(() => { throw unavailable(); });
    await this.pool.query("DELETE FROM ridr.media_assets WHERE id=$1 AND ride_id=$2 AND state='deleting'", [photoId, rideId]);
  }

  async sweepPhotos() {
    const client = await this.pool.connect();
    let due: { id: string; object_key: string }[] = [];
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string; object_key: string }>(
        `WITH due AS (
           SELECT a.id FROM ridr.media_assets a
           JOIN ridr.memberships m ON m.id=a.owner_member_id
           JOIN ridr.profiles p ON p.id=m.user_id
           WHERE a.kind='photo' AND
             (a.state='deleting' OR a.expires_at<=clock_timestamp() OR
              p.account_state<>'active' OR p.deleted_at IS NOT NULL)
           ORDER BY a.expires_at,a.id LIMIT 50 FOR UPDATE OF a SKIP LOCKED
         )
         UPDATE ridr.media_assets a SET state='deleting' FROM due
         WHERE a.id=due.id RETURNING a.id,a.object_key`,
      );
      due = result.rows;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
    for (const row of due) {
      if (!/^[0-9a-f-]{36}\.jpg$/.test(row.object_key)) continue;
      try {
        await rm(resolve(this.photoDir, row.object_key), { force: true });
        await this.pool.query("DELETE FROM ridr.media_assets WHERE id=$1 AND state='deleting'", [row.id]);
      } catch { this.logger.write('photo_cleanup_error'); }
    }
    const files = await readdir(this.photoDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const candidates = files.filter((file) => file.isFile() && /^[0-9a-f-]{36}\.jpg$/.test(file.name));
    const count = Math.min(candidates.length, 50);
    for (let index = 0; index < count; index++) {
      const file = candidates[(this.photoOrphanOffset + index) % candidates.length]!;
      try {
        const path = resolve(this.photoDir, file.name);
        if (Date.now() - (await stat(path)).mtimeMs < 3600000) continue;
        const known = await this.pool.query('SELECT 1 FROM ridr.media_assets WHERE kind=$1 AND object_key=$2 LIMIT 1',
          ['photo', file.name]);
        if (known.rowCount === 0) await rm(path, { force: true });
      } catch { this.logger.write('photo_cleanup_error'); }
    }
    this.photoOrphanOffset = candidates.length ? (this.photoOrphanOffset + count) % candidates.length : 0;
    return due.length;
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
  @Get('history/:rideId/photos')
  async photos(
    @Req() request: Request,
    @Param('rideId') rideId: string,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!this.services) throw unavailable();
    const account = await this.services.verifier.verify(request.headers.authorization);
    if (!UUID.test(rideId)) throw new ApiError(400, 'INVALID_REQUEST', 'Invalid ride identity.');
    if (Object.keys(query).some((key) => key !== 'limit' && key !== 'cursor') ||
        (query.limit !== undefined && (typeof query.limit !== 'string' || !/^[1-9]\d{0,2}$/.test(query.limit))) ||
        (query.cursor !== undefined && (typeof query.cursor !== 'string' || query.cursor.length === 0)))
      throw new ApiError(400, 'INVALID_REQUEST', 'Invalid photo query.');
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new ApiError(400, 'INVALID_REQUEST', 'Invalid photo page size.');
    return { data: await this.services.store.listPhotos(account, rideId.toLowerCase(), limit,
      query.cursor as string | undefined),
      requestId: String(response.getHeader('X-Request-Id')) };
  }
  @Post('history/:rideId/photos')
  @UseInterceptors(FileInterceptor('photo', {
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 4, parts: 6, fieldSize: 2048 },
  }))
  async uploadPhoto(
    @Req() request: Request,
    @Param('rideId') rideId: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!this.services) throw unavailable();
    const account = await this.services.verifier.verify(request.headers.authorization);
    if (!UUID.test(rideId) || !file || !['image/jpeg','image/png','image/webp'].includes(file.mimetype) ||
      !body || Object.keys(body).sort().join(',') !== 'capturedAt,motion,photoId,routePoint' ||
      typeof body.photoId !== 'string' || !UUID.test(body.photoId) ||
      request.header('idempotency-key')?.toLowerCase() !== body.photoId.toLowerCase() ||
      typeof body.motion !== 'string' || typeof body.routePoint !== 'string')
      throw new ApiError(400, 'INVALID_REQUEST', 'Choose one photo, its route point and a fresh motion check.');
    let point: unknown, motion: unknown;
    try {
      point = JSON.parse(body.routePoint);
      motion = JSON.parse(body.motion);
    } catch { throw new ApiError(400, 'INVALID_REQUEST', 'Invalid photo route point or motion check.'); }
    if (!validPhotoPoint(point)) throw new ApiError(400, 'INVALID_REQUEST', 'Choose a valid route point.');
    const context = parseMotion({ capturedAt: body.capturedAt, motion });
    return { data: await this.services.store.uploadPhoto(account, rideId.toLowerCase(), {
      photoId: body.photoId.toLowerCase(), routePoint: point, motion: context, bytes: file.buffer,
    }), requestId: String(response.getHeader('X-Request-Id')) };
  }
  @Get('history/:rideId/photos/:photoId/content')
  async photoContent(
    @Req() request: Request,
    @Param('rideId') rideId: string,
    @Param('photoId') photoId: string,
    @Res() response: Response,
  ) {
    if (!this.services) throw unavailable();
    const account = await this.services.verifier.verify(request.headers.authorization);
    if (!UUID.test(rideId) || !UUID.test(photoId))
      throw new ApiError(400, 'INVALID_REQUEST', 'Invalid photo identity.');
    const bytes = await this.services.store.photoContent(account, rideId.toLowerCase(), photoId.toLowerCase());
    response.setHeader('Cache-Control', 'private, no-store');
    response.type('image/jpeg').send(bytes);
  }
  @Delete('history/:rideId/photos/:photoId')
  @HttpCode(204)
  async deletePhoto(
    @Req() request: Request,
    @Param('rideId') rideId: string,
    @Param('photoId') photoId: string,
  ) {
    if (!this.services) throw unavailable();
    const account = await this.services.verifier.verify(request.headers.authorization);
    if (!UUID.test(rideId) || !UUID.test(photoId))
      throw new ApiError(400, 'INVALID_REQUEST', 'Invalid photo identity.');
    await this.services.store.deletePhoto(account, rideId.toLowerCase(), photoId.toLowerCase());
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
