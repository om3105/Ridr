import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { ApiError, unavailable } from './api-errors.js';
import {
  RIDES,
  commandKey,
  parseMotion,
  rideId,
  rideRevision,
  type RideServices,
} from './rides.js';
import { parseGpx, validatePoints } from './route-planning.js';
import { rateLimited } from './ride-limits.js';

export function routeRevision(request: Pick<Request, 'header'>): number {
  const create = request.header('if-none-match');
  if (create !== undefined) {
    if (create !== '*' || request.header('if-match') !== undefined)
      throw new ApiError(400, 'INVALID_REQUEST', 'Use If-None-Match: * only for a new route.');
    return 0;
  }
  return rideRevision(request.header('if-match'));
}
@Controller('rides/:rideId/route')
export class RouteController {
  constructor(@Inject(RIDES) private readonly services: RideServices | null) {}
  private async actor(request: Request, response: Response) {
    if (!this.services) throw unavailable();
    const account = await this.services.verifier.verify(request.headers.authorization);
    const wait = this.services.limiter.consume('account', account.id);
    if (wait !== null) {
      response.setHeader('Retry-After', String(wait));
      throw rateLimited();
    }
    return account;
  }
  private result(data: unknown, response: Response, revision?: number) {
    if (revision) response.setHeader('ETag', `"${revision}"`);
    return { data, requestId: String(response.getHeader('X-Request-Id')) };
  }
  @Get()
  async read(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('rideId') id: string,
  ) {
    const actor = await this.actor(request, response);
    const route = await this.services!.store.route(actor, rideId(id));
    return this.result(route, response, route?.revision);
  }
  @Put()
  async draw(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('rideId') id: string,
    @Body() body: unknown,
  ) {
    const actor = await this.actor(request, response);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? ''))
      throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.');
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).sort().join(',') !== 'capturedAt,motion,points'
    )
      throw new ApiError(400, 'INVALID_REQUEST', 'Provide only points, motion and capturedAt.');
    const value = body as Record<string, unknown>;
    const route = await this.services!.store.saveRoute(actor, rideId(id), {
      ...parseMotion(value),
      source: 'drawn',
      points: validatePoints(value.points, 25),
      idempotencyKey: commandKey(request.header('idempotency-key')),
      revision: routeRevision(request),
    });
    return this.result(route, response, route.revision);
  }
  @Post('import')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2, parts: 4, fieldSize: 2048 },
    }),
  )
  async import(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('rideId') id: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const actor = await this.actor(request, response);
    if (
      !file ||
      !body ||
      Object.keys(body).sort().join(',') !== 'capturedAt,motion' ||
      typeof body.motion !== 'string'
    )
      throw new ApiError(400, 'INVALID_REQUEST', 'Upload one GPX file with motion and capturedAt.');
    let motion: unknown;
    try {
      motion = JSON.parse(body.motion);
    } catch {
      throw new ApiError(400, 'INVALID_REQUEST', 'Use a valid motion object.');
    }
    const route = await this.services!.store.saveRoute(actor, rideId(id), {
      ...parseMotion({ ...body, motion }),
      source: 'gpx',
      points: parseGpx(file.buffer, file.originalname),
      idempotencyKey: commandKey(request.header('idempotency-key')),
      revision: routeRevision(request),
    });
    return this.result(route, response, route.revision);
  }
}
