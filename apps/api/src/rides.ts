import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError, inviteUnavailable, unavailable } from './api-errors.js';
import { UUID, validDisplayName, type TokenVerifier } from './auth.js';
import type {
  CreateRide,
  JoinRide,
  RideStore,
  MotionContext,
  StartRide,
  EndRide,
  StopSharing,
  ProposeChange,
  AcceptChange,
  ProposalKind,
} from './ride-types.js';
import { RideLimiter, rateLimited } from './ride-limits.js';

export const RIDES = Symbol('RIDES');
export interface RideServices {
  verifier: TokenVerifier;
  store: RideStore;
  limiter: RideLimiter;
}

function object(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ApiError(400, 'INVALID_REQUEST', 'Use a JSON object with the required fields.');
  return body as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    throw new ApiError(400, 'INVALID_REQUEST', 'Use only the required request fields.');
}

export function commandKey(value: string | undefined): string {
  if (!value || !UUID.test(value))
    throw new ApiError(400, 'INVALID_REQUEST', 'Idempotency-Key must be a UUID.');
  return value.toLowerCase();
}

export function rideId(value: string): string {
  if (!UUID.test(value)) throw new ApiError(400, 'INVALID_REQUEST', 'Ride ID must be a UUID.');
  return value.toLowerCase();
}

export function rideRevision(value: string | undefined): number {
  if (value === undefined)
    throw new ApiError(428, 'PRECONDITION_REQUIRED', 'Reload the ride before making this change.');
  const match = /^"([1-9][0-9]*)"$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1])))
    throw new ApiError(
      400,
      'INVALID_REQUEST',
      'If-Match must contain one quoted positive revision.',
    );
  return Number(match[1]);
}

function credential(value: unknown, kind: 'code' | 'token'): string {
  if (typeof value === 'string') {
    const normalized = kind === 'code' ? value.trim().replace(/[ -]/g, '').toUpperCase() : value;
    if ((kind === 'code' ? /^[A-HJ-NP-Z2-9]{10}$/ : /^[A-Za-z0-9_-]{43}$/).test(normalized))
      return normalized;
  }
  throw inviteUnavailable();
}

export function parseCreateRide(body: unknown, key: string | undefined): CreateRide {
  const value = object(body);
  exact(value, ['name', 'transport']);
  const fields: Record<string, string> = {};
  if (typeof value.name !== 'string' || !validDisplayName(value.name))
    fields.name = 'Use 1–80 plain-text characters without control characters or angle brackets.';
  if (!['motorcycle', 'cycling', 'car'].includes(value.transport as string))
    fields.transport = 'Choose motorcycle, cycling or car.';
  if (Object.keys(fields).length)
    throw new ApiError(422, 'VALIDATION_FAILED', 'Check the ride details.', fields);
  return {
    name: (value.name as string).trim(),
    transport: value.transport as CreateRide['transport'],
    idempotencyKey: commandKey(key),
  };
}

export function parsePreview(body: unknown): { code: string } | { token: string } {
  const value = object(body);
  const kind = Object.hasOwn(value, 'code') ? 'code' : 'token';
  exact(value, [kind]);
  const secret = credential(value[kind], kind);
  return kind === 'code' ? { code: secret } : { token: secret };
}

export function parseJoin(body: unknown, key: string | undefined): JoinRide {
  const value = object(body);
  const field = Object.hasOwn(value, 'inviteCode') ? 'inviteCode' : 'inviteToken';
  exact(value, [field, 'physicalRole']);
  if (value.physicalRole !== 'rider' && value.physicalRole !== 'pillion')
    throw new ApiError(422, 'VALIDATION_FAILED', 'Choose your role.', {
      physicalRole: 'Choose Rider or Pillion.',
    });
  const secret = credential(value[field], field === 'inviteCode' ? 'code' : 'token');
  return {
    ...(field === 'inviteCode' ? { inviteCode: secret } : { inviteToken: secret }),
    physicalRole: value.physicalRole,
    idempotencyKey: commandKey(key),
  };
}

export function parseRideList(query: Record<string, unknown>): { limit: number; cursor?: string } {
  if (Object.keys(query).some((key) => key !== 'limit' && key !== 'cursor'))
    throw new ApiError(400, 'INVALID_REQUEST', 'Only limit and cursor are accepted.');
  const value = query.limit ?? '50';
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,2}$/.test(value) || Number(value) > 100)
    throw new ApiError(400, 'INVALID_REQUEST', 'Limit must be between 1 and 100.');
  if (
    query.cursor !== undefined &&
    (typeof query.cursor !== 'string' || query.cursor.length < 1 || query.cursor.length > 1024)
  )
    throw new ApiError(400, 'INVALID_REQUEST', 'Use the next cursor returned by the ride list.');
  return {
    limit: Number(value),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor as string }),
  };
}

function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== (value.includes('.') ? value : value.replace('Z', '.000Z'))
  )
    throw new ApiError(400, 'INVALID_REQUEST', 'Use a valid UTC timestamp.');
  return value;
}
function consentEpoch(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new ApiError(400, 'INVALID_REQUEST', 'Use the last acknowledged consent epoch.');
  return value;
}
export function parseMotion(value: Record<string, unknown>): MotionContext {
  const motion = object(value.motion);
  exact(motion, ['state', 'source', 'observedAt']);
  if (
    !['stopped', 'moving', 'unknown'].includes(motion.state as string) ||
    !['speed', 'activity', 'unavailable'].includes(motion.source as string)
  )
    throw new ApiError(400, 'INVALID_REQUEST', 'Use a supported motion state and source.');
  return {
    motion: {
      state: motion.state as MotionContext['motion']['state'],
      source: motion.source as MotionContext['motion']['source'],
      observedAt: timestamp(motion.observedAt),
    },
    capturedAt: timestamp(value.capturedAt),
  };
}
export function parseStart(
  body: unknown,
  key: string | undefined,
  expected: string | undefined,
): StartRide {
  const value = object(body);
  exact(value, ['motion', 'capturedAt']);
  return {
    ...parseMotion(value),
    revision: rideRevision(expected),
    idempotencyKey: commandKey(key),
  };
}
export function parseEnd(body: unknown, key: string | undefined): EndRide {
  const value = object(body);
  exact(value, ['reason', 'capturedAt', 'consentEpoch']);
  if (value.reason !== 'completed' && value.reason !== 'cancelled')
    throw new ApiError(400, 'INVALID_REQUEST', 'Choose completed or cancelled.');
  return {
    reason: value.reason,
    capturedAt: timestamp(value.capturedAt),
    consentEpoch: consentEpoch(value.consentEpoch),
    idempotencyKey: commandKey(key),
  };
}
export function parseStop(body: unknown, key: string | undefined, sharing = false): StopSharing {
  const value = object(body);
  exact(value, sharing ? ['enabled', 'stoppedAt', 'consentEpoch'] : ['stoppedAt', 'consentEpoch']);
  if (sharing && value.enabled !== false)
    throw new ApiError(400, 'INVALID_REQUEST', 'Only stopping sharing is available.');
  return {
    stoppedAt: timestamp(value.stoppedAt),
    consentEpoch: consentEpoch(value.consentEpoch),
    idempotencyKey: commandKey(key),
  };
}
export function parseProposal(
  body: unknown,
  key: string | undefined,
  expected: string | undefined,
  kind: ProposalKind,
): ProposeChange {
  const value = object(body);
  exact(
    value,
    kind === 'role_change'
      ? ['targetMemberId', 'physicalRole', 'motion', 'capturedAt']
      : ['targetMemberId', 'motion', 'capturedAt'],
  );
  if (typeof value.targetMemberId !== 'string')
    throw new ApiError(400, 'INVALID_REQUEST', 'Choose a current member.');
  if (kind === 'role_change' && value.physicalRole !== 'rider' && value.physicalRole !== 'pillion')
    throw new ApiError(422, 'VALIDATION_FAILED', 'Choose Rider or Pillion.');
  return {
    ...parseMotion(value),
    targetMemberId: rideId(value.targetMemberId),
    ...(kind === 'role_change' ? { physicalRole: value.physicalRole as 'rider' | 'pillion' } : {}),
    revision: rideRevision(expected),
    idempotencyKey: commandKey(key),
  };
}
export function parseAccept(body: unknown, key: string | undefined): AcceptChange {
  const value = object(body);
  exact(value, ['motion', 'capturedAt']);
  return { ...parseMotion(value), idempotencyKey: commandKey(key) };
}
function pairToken(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value))
    throw new ApiError(400, 'INVALID_REQUEST', 'Scan a valid pair QR.');
  return value;
}

function json(contentType: string | undefined) {
  if (!contentType || !/^application\/json(?:\s*;|$)/i.test(contentType))
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json for this request.');
}

function envelope<T>(data: T, response: Response, revision?: number) {
  if (revision !== undefined) response.setHeader('ETag', `"${revision}"`);
  return { data, requestId: String(response.getHeader('X-Request-Id')) };
}

@Controller()
export class RideController {
  constructor(@Inject(RIDES) private readonly services: RideServices | null) {}

  @Get('rides/:rideId/headcounts/current')
  async currentHeadcount(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response);
    return envelope(await this.services!.store.headcount(account, rideId(id)), response);
  }

  @Post('rides/:rideId/headcounts')
  async beginHeadcount(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response, true);
    json(request.headers['content-type']);
    const value = object(body);
    exact(value, ['motion', 'capturedAt']);
    return envelope(
      await this.services!.store.beginHeadcount(account, rideId(id), {
        ...parseMotion(value),
        idempotencyKey: commandKey(request.header('idempotency-key')),
      }),
      response,
    );
  }

  @Put('rides/:rideId/headcounts/:roundId/pairs/:pairId')
  async confirmHeadcount(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Param('roundId') roundId: string,
    @Param('pairId') pairId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response, true);
    json(request.headers['content-type']);
    const value = object(body);
    exact(value, ['scanReceiptId', 'motion', 'capturedAt']);
    return envelope(
      await this.services!.store.confirmHeadcount(
        account,
        rideId(id),
        rideId(roundId),
        rideId(pairId),
        {
          ...parseMotion(value),
          scanReceiptId: rideId(String(value.scanReceiptId)),
          idempotencyKey: commandKey(request.header('idempotency-key')),
        },
      ),
      response,
    );
  }

  @Post('rides/:rideId/headcounts/:roundId/complete')
  @HttpCode(200)
  async completeHeadcount(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Param('roundId') roundId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response, true);
    json(request.headers['content-type']);
    const value = object(body);
    exact(value, ['motion', 'capturedAt']);
    return envelope(
      await this.services!.store.completeHeadcount(account, rideId(id), rideId(roundId), {
        ...parseMotion(value),
        revision: rideRevision(request.header('if-match')),
        idempotencyKey: commandKey(request.header('idempotency-key')),
      }),
      response,
    );
  }

  @Get('rides/:rideId/readiness')
  async readiness(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response);
    return envelope(await this.services!.store.readiness(account, rideId(id)), response);
  }

  @Post('rides/:rideId/pairs/:pairId/scan-challenges')
  async issueReadinessScan(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Param('pairId') pairId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response, true);
    json(request.headers['content-type']);
    const value = object(body);
    exact(value, ['roundId', 'motion', 'capturedAt']);
    if (value.roundId !== null && (typeof value.roundId !== 'string' || !UUID.test(value.roundId)))
      throw new ApiError(400, 'INVALID_REQUEST', 'Use a valid rest-stop round ID or null.');
    return envelope(
      await this.services!.store.issueReadinessScan(account, rideId(id), rideId(pairId), {
        ...parseMotion(value),
        roundId: value.roundId === null ? null : rideId(value.roundId),
      }),
      response,
    );
  }

  @Post('rides/:rideId/pairs/:pairId/scan-receipts')
  async acceptReadinessScan(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Param('pairId') pairId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response, true);
    json(request.headers['content-type']);
    const value = object(body);
    exact(value, ['challengeId', 'scannedToken', 'motion', 'capturedAt']);
    return envelope(
      await this.services!.store.acceptReadinessScan(account, rideId(id), rideId(pairId), {
        ...parseMotion(value),
        challengeId: rideId(String(value.challengeId)),
        scannedToken: pairToken(value.scannedToken),
        idempotencyKey: commandKey(request.header('idempotency-key')),
      }),
      response,
    );
  }

  @Put('rides/:rideId/pairs/:pairId/readiness/me')
  async attestReadiness(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Param('pairId') pairId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response, true);
    json(request.headers['content-type']);
    const value = object(body);
    exact(value, ['helmetConfirmed', 'ready', 'scanReceiptId', 'motion', 'capturedAt']);
    if (value.helmetConfirmed !== true || value.ready !== true)
      throw new ApiError(
        400,
        'INVALID_REQUEST',
        'Only your own explicit helmet and readiness confirmation is accepted.',
      );
    return envelope(
      await this.services!.store.attestReadiness(account, rideId(id), rideId(pairId), {
        ...parseMotion(value),
        helmetConfirmed: true,
        ready: true,
        scanReceiptId: rideId(String(value.scanReceiptId)),
        revision: rideRevision(request.header('if-match')),
        idempotencyKey: commandKey(request.header('idempotency-key')),
      }),
      response,
    );
  }

  @Get('rides/:rideId/pairs/me')
  async currentPair(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response);
    return envelope(await this.services!.store.currentPair(account, rideId(id)), response);
  }

  @Post('rides/:rideId/pair-invitations')
  async issuePairInvitation(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response, true);
    json(request.headers['content-type']);
    const value = object(body);
    exact(value, ['motion', 'capturedAt']);
    return envelope(
      await this.services!.store.issuePairInvitation(account, rideId(id), parseMotion(value)),
      response,
    );
  }

  @Post('rides/:rideId/pair-invitations/preview')
  @HttpCode(200)
  async previewPairInvitation(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response, true);
    json(request.headers['content-type']);
    const value = object(body);
    exact(value, ['token', 'motion', 'capturedAt']);
    return envelope(
      await this.services!.store.previewPairInvitation(account, rideId(id), {
        ...parseMotion(value),
        token: pairToken(value.token),
      }),
      response,
    );
  }

  @Post('rides/:rideId/pairs')
  async pair(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response, true);
    json(request.headers['content-type']);
    const value = object(body);
    exact(value, ['pairInvitationId', 'token', 'consent', 'motion', 'capturedAt']);
    if (value.consent !== true)
      throw new ApiError(400, 'INVALID_REQUEST', 'Explicit pairing consent is required.');
    return envelope(
      await this.services!.store.pair(account, rideId(id), {
        ...parseMotion(value),
        pairInvitationId: rideId(String(value.pairInvitationId)),
        token: pairToken(value.token),
        consent: true,
        idempotencyKey: commandKey(request.header('idempotency-key')),
      }),
      response,
    );
  }

  @Delete('rides/:rideId/pairs/:pairId')
  @HttpCode(204)
  async unpair(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Param('pairId') pairId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response);
    json(request.headers['content-type']);
    const value = object(body);
    exact(value, ['motion', 'capturedAt']);
    await this.services!.store.unpair(account, rideId(id), rideId(pairId), {
      ...parseMotion(value),
      idempotencyKey: commandKey(request.header('idempotency-key')),
    });
  }

  private async actor(request: Request, response: Response, limited = false) {
    if (!this.services) throw unavailable();
    const consume = (kind: 'ip' | 'account', id: string) => {
      const wait = this.services!.limiter.consume(kind, id);
      if (wait !== null) {
        response.setHeader('Retry-After', String(wait));
        throw rateLimited();
      }
    };
    // Express does not trust forwarding headers; clients cannot choose their own IP bucket.
    if (limited) consume('ip', request.ip ?? request.socket.remoteAddress ?? 'unknown');
    const account = await this.services.verifier.verify(request.headers.authorization);
    if (limited) consume('account', account.id);
    return account;
  }

  @Post('rides')
  async create(
    @Req() request: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response, true);
    json(request.headers['content-type']);
    const result = await this.services!.store.create(
      account,
      parseCreateRide(body, request.header('idempotency-key')),
    );
    return envelope(result, response, result.ride.revision);
  }

  @Post('invites/preview')
  @HttpCode(200)
  async preview(
    @Req() request: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response, true);
    json(request.headers['content-type']);
    return envelope(await this.services!.store.preview(account, parsePreview(body)), response);
  }

  @Post('rides/:rideId/join')
  @HttpCode(200)
  async join(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response, true);
    json(request.headers['content-type']);
    const result = await this.services!.store.join(
      account,
      rideId(id),
      parseJoin(body, request.header('idempotency-key')),
    );
    return envelope(result, response, result.ride.revision);
  }

  @Get('rides')
  async list(
    @Req() request: Request,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response);
    return envelope(await this.services!.store.list(account, parseRideList(query)), response);
  }

  @Get('rides/:rideId')
  async read(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response);
    const result = await this.services!.store.read(account, rideId(id));
    return envelope(result, response, result.ride.revision);
  }

  @Post('rides/:rideId/invites')
  async rotate(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response, true);
    json(request.headers['content-type']);
    const value = object(body);
    exact(
      value,
      Object.hasOwn(value, 'motion') || Object.hasOwn(value, 'capturedAt')
        ? ['rotate', 'motion', 'capturedAt']
        : ['rotate'],
    );
    if (value.rotate !== true)
      throw new ApiError(400, 'INVALID_REQUEST', 'Confirm invitation replacement.');
    return envelope(
      await this.services!.store.rotate(account, rideId(id), {
        revision: rideRevision(request.header('if-match')),
        idempotencyKey: commandKey(request.header('idempotency-key')),
        ...(Object.hasOwn(value, 'motion') ? parseMotion(value) : {}),
      }),
      response,
    );
  }

  @Delete('rides/:rideId/invites/current')
  @HttpCode(204)
  async revoke(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response);
    if (body !== undefined && body !== null)
      throw new ApiError(400, 'INVALID_REQUEST', 'This request does not accept a body.');
    await this.services!.store.revoke(account, rideId(id), {
      idempotencyKey: commandKey(request.header('idempotency-key')),
    });
  }

  @Get('rides/:rideId/management')
  async management(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response);
    const result = await this.services!.store.management(account, rideId(id));
    return envelope(result, response, result.ride.revision);
  }

  @Post('rides/:rideId/start')
  @HttpCode(200)
  async start(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response);
    json(request.headers['content-type']);
    const result = await this.services!.store.start(
      account,
      rideId(id),
      parseStart(body, request.header('idempotency-key'), request.header('if-match')),
    );
    return envelope(result, response, result.revision);
  }

  @Post('rides/:rideId/end')
  @HttpCode(200)
  async end(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response);
    json(request.headers['content-type']);
    const result = await this.services!.store.end(
      account,
      rideId(id),
      parseEnd(body, request.header('idempotency-key')),
    );
    return envelope(result, response, result.revision);
  }

  @Post('rides/:rideId/leave')
  @HttpCode(200)
  async leave(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response);
    json(request.headers['content-type']);
    const result = await this.services!.store.leave(
      account,
      rideId(id),
      parseStop(body, request.header('idempotency-key')),
    );
    return envelope(result, response, result.revision);
  }

  @Put('rides/:rideId/alert-settings')
  async alertSettings(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.actor(request, response);
    json(request.headers['content-type']);
    const value = object(body);
    const kind = value.kind;
    if (kind !== 'straggler' && kind !== 'battery')
      throw new ApiError(400, 'INVALID_REQUEST', 'Choose a warning setting.');
    exact(
      value,
      kind === 'straggler' ? ['kind', 'value', 'motion', 'capturedAt'] : ['kind', 'value'],
    );
    if (
      !Number.isInteger(value.value) ||
      (kind === 'battery'
        ? ![10, 20, 30].includes(Number(value.value))
        : Number(value.value) < 200 || Number(value.value) > 2000)
    )
      throw new ApiError(400, 'INVALID_REQUEST', 'Choose a valid threshold.');
    const result = await this.services!.store.alertSettings(actor, rideId(id), {
      kind,
      value: Number(value.value),
      idempotencyKey: commandKey(request.header('idempotency-key')),
      ...(kind === 'straggler'
        ? { ...parseMotion(value), revision: rideRevision(request.header('if-match')) }
        : {}),
    });
    return envelope(result, response);
  }
  @Post('rides/:rideId/alerts/:alertId/acknowledgements')
  async acknowledgeAlert(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Param('alertId') alertId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.actor(request, response);
    return envelope(
      await this.services!.store.acknowledgeAlert(
        actor,
        rideId(id),
        rideId(request.header('x-device-id') ?? ''),
        rideId(alertId),
      ),
      response,
    );
  }
  @Put('rides/:rideId/sharing')
  @HttpCode(200)
  async stopSharing(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response);
    json(request.headers['content-type']);
    const enabling = body && typeof body === 'object' && 'enabled' in body && body.enabled === true;
    if (enabling) exact(object(body), ['enabled']);
    const result = enabling
      ? await this.services!.store.enableSharing(account, rideId(id), {
          revision: rideRevision(request.header('if-match')),
          idempotencyKey: commandKey(request.header('idempotency-key')),
        })
      : await this.services!.store.stopSharing(
          account,
          rideId(id),
          parseStop(body, request.header('idempotency-key'), true),
        );
    return envelope(result, response, result.revision);
  }

  @Post('rides/:rideId/role-proposals')
  async proposeRole(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response, true);
    json(request.headers['content-type']);
    const result = await this.services!.store.propose(
      account,
      rideId(id),
      'role_change',
      parseProposal(
        body,
        request.header('idempotency-key'),
        request.header('if-match'),
        'role_change',
      ),
    );
    return envelope(result, response);
  }
  @Post('rides/:rideId/role-proposals/:proposalId/accept')
  @HttpCode(200)
  async acceptRole(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Param('proposalId') proposal: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response);
    json(request.headers['content-type']);
    const result = await this.services!.store.accept(
      account,
      rideId(id),
      rideId(proposal),
      'role_change',
      parseAccept(body, request.header('idempotency-key')),
    );
    return envelope(result, response, result.revision);
  }
  @Delete('rides/:rideId/role-proposals/:proposalId')
  @HttpCode(204)
  async cancelRole(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Param('proposalId') proposal: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response);
    if (body !== undefined && body !== null)
      throw new ApiError(400, 'INVALID_REQUEST', 'This request does not accept a body.');
    await this.services!.store.cancel(account, rideId(id), rideId(proposal), 'role_change', {
      idempotencyKey: commandKey(request.header('idempotency-key')),
    });
  }

  @Post('rides/:rideId/leadership-proposals')
  async proposeLeadership(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response, true);
    json(request.headers['content-type']);
    const result = await this.services!.store.propose(
      account,
      rideId(id),
      'leadership',
      parseProposal(
        body,
        request.header('idempotency-key'),
        request.header('if-match'),
        'leadership',
      ),
    );
    return envelope(result, response);
  }
  @Post('rides/:rideId/leadership-proposals/:proposalId/accept')
  @HttpCode(200)
  async acceptLeadership(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Param('proposalId') proposal: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response);
    json(request.headers['content-type']);
    const result = await this.services!.store.accept(
      account,
      rideId(id),
      rideId(proposal),
      'leadership',
      parseAccept(body, request.header('idempotency-key')),
    );
    return envelope(result, response, result.revision);
  }
  @Delete('rides/:rideId/leadership-proposals/:proposalId')
  @HttpCode(204)
  async cancelLeadership(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Param('proposalId') proposal: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request, response);
    if (body !== undefined && body !== null)
      throw new ApiError(400, 'INVALID_REQUEST', 'This request does not accept a body.');
    await this.services!.store.cancel(account, rideId(id), rideId(proposal), 'leadership', {
      idempotencyKey: commandKey(request.header('idempotency-key')),
    });
  }
}
