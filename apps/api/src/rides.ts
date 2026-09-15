import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError, inviteUnavailable, unavailable } from './api-errors.js';
import { UUID, validDisplayName, type TokenVerifier } from './auth.js';
import type { CreateRide, JoinRide, RideStore } from './ride-types.js';
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
    throw new ApiError(
      428,
      'PRECONDITION_REQUIRED',
      'Reload the ride before replacing its invitation.',
    );
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
    exact(value, ['rotate']);
    if (value.rotate !== true)
      throw new ApiError(400, 'INVALID_REQUEST', 'Confirm invitation replacement.');
    return envelope(
      await this.services!.store.rotate(account, rideId(id), {
        revision: rideRevision(request.header('if-match')),
        idempotencyKey: commandKey(request.header('idempotency-key')),
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
}
