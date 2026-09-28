import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import { ApiError, unavailable } from './api-errors.js';
import { UUID, type TokenVerifier, type VerifiedAccount } from './auth.js';
import type { ApiConfig } from './config.js';
import type { OperationalLogger } from './logging.js';

export const SPONSORED = Symbol('SPONSORED');
export type SponsoredPlacement = 'home' | 'history' | 'summary';
export type SponsoredCard = NonNullable<ApiConfig['sponsoredCard']>;

export class SponsoredStore {
  private readonly pool: Pool;
  constructor(databaseUrl: string, private readonly card: SponsoredCard | undefined,
    logger: OperationalLogger) {
    this.pool = new Pool({ connectionString: databaseUrl, application_name: 'ridr-sponsored',
      max: 2, connectionTimeoutMillis: 2000, idleTimeoutMillis: 10000, statement_timeout: 3000 });
    this.pool.on('error', () => logger.write('sponsored_pool_error'));
  }

  async read(account: VerifiedAccount, placement: SponsoredPlacement, rideId?: string) {
    if (!this.card || (placement === 'summary' && !rideId)) return null;
    try {
      const result = await this.pool.query<{ eligible: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM ridr.profiles p
           WHERE p.id=$1 AND p.account_state='active' AND p.deleted_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM ridr.active_memberships a JOIN ridr.rides active ON active.id=a.ride_id
               WHERE a.user_id=p.id AND active.state='active'
             )
             AND NOT EXISTS (
               SELECT 1 FROM ridr.ad_entitlements e
               WHERE e.user_id=p.id AND e.ad_free_until>clock_timestamp()
             )
             AND ($2::uuid IS NULL OR EXISTS (
               SELECT 1 FROM ridr.memberships m JOIN ridr.rides completed ON completed.id=m.ride_id
               WHERE m.user_id=p.id AND completed.id=$2 AND completed.state='ended'
                 AND completed.started_at IS NOT NULL
                 AND completed.ended_at+interval '90 days'>clock_timestamp()
                 AND m.joined_at<completed.ended_at
                 AND coalesce(m.left_at,completed.ended_at)>completed.started_at
             ))
         ) AS eligible`,
        [account.id, placement === 'summary' ? rideId : null],
      );
      return result.rows[0]?.eligible === true ? this.card : null;
    } catch { throw unavailable(); }
  }

  async close() { await this.pool.end(); }
}

@Controller()
export class SponsoredController {
  constructor(@Inject(SPONSORED)
    private readonly services: { verifier: TokenVerifier; store: SponsoredStore } | null) {}

  @Get('sponsored-card')
  async read(@Req() request: Request, @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    if (!this.services) throw unavailable();
    const account = await this.services.verifier.verify(request.headers.authorization);
    const placement = query.placement;
    if ((placement !== 'home' && placement !== 'history' && placement !== 'summary') ||
        Object.keys(query).some((key) => key !== 'placement' && key !== 'rideId') ||
        (placement === 'summary' ? typeof query.rideId !== 'string' || !UUID.test(query.rideId)
          : query.rideId !== undefined))
      throw new ApiError(400, 'INVALID_REQUEST', 'Choose an allowed sponsored-card placement.');
    return { data: await this.services.store.read(account, placement,
      placement === 'summary' ? (query.rideId as string).toLowerCase() : undefined),
      requestId: String(response.getHeader('X-Request-Id')) };
  }
}
