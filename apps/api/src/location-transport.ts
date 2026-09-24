import {
  Body,
  Controller,
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
import type { OnApplicationShutdown } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import type { Request, Response } from 'express';
import { ApiError, unauthenticated, unavailable } from './api-errors.js';
import { RIDES, rideId, type RideServices } from './rides.js';
import { exactObject, parseSample } from './location.js';
import { RideLimiter } from './ride-limits.js';
const rateLimited = () =>
  new ApiError(429, 'RATE_LIMITED', 'Too many location requests. Wait and retry.');

@Controller()
export class LocationController {
  private readonly limiter = new RideLimiter({ accountPerMinute: 120, ipPerMinute: 120 });
  constructor(@Inject(RIDES) private readonly services: RideServices | null) {}
  private async actor(request: Request) {
    if (!this.services) throw unavailable();
    const account = await this.services.verifier.verify(request.headers.authorization);
    if (this.limiter.consume('account', account.id) !== null) throw rateLimited();
    return account;
  }
  private envelope(data: unknown, response: Response) {
    return { data, requestId: String(response.getHeader('X-Request-Id')) };
  }
  @Put('me/devices/:deviceId')
  @HttpCode(204)
  async device(@Req() request: Request, @Param('deviceId') id: string, @Body() body: unknown) {
    const account = await this.actor(request);
    const value = exactObject(body, ['platform']);
    if (value.platform !== 'ios' && value.platform !== 'android')
      throw new ApiError(400, 'INVALID_REQUEST', 'Choose iOS or Android.');
    await this.services!.store.registerDevice(account, rideId(id), value.platform);
  }
  @Put('me/devices/:deviceId/push')
  async push(
    @Req() request: Request,
    @Param('deviceId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const account = await this.actor(request),
      value = exactObject(body, ['token']);
    if (value.token !== null && typeof value.token !== 'string')
      throw new ApiError(400, 'INVALID_REQUEST', 'Provide a push token or null.');
    return this.envelope(
      await this.services!.store.registerPush(account, rideId(id), value.token),
      response,
    );
  }
  @Get('me/devices/:deviceId/push')
  async pushStatus(
    @Req() request: Request,
    @Param('deviceId') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.envelope(
      await this.services!.store.pushStatus(await this.actor(request), rideId(id)),
      response,
    );
  }
  @Get('rides/:rideId/location-status')
  async status(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.actor(request);
    const snapshot = await this.services!.store.management(actor, rideId(id));
    return this.envelope(
      {
        active: snapshot.ride.state === 'active' && !snapshot.membership.leftAt,
        sharing: snapshot.membership.sharingEnabled,
        epoch: snapshot.membership.consentEpoch,
      },
      response,
    );
  }
  @Get('rides/:rideId/members/:memberId/trail')
  async trail(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Param('memberId') memberId: string,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.actor(request);
    if (
      Object.keys(query).some((key) => key !== 'cursor') ||
      (query.cursor !== undefined && typeof query.cursor !== 'string')
    )
      throw new ApiError(400, 'INVALID_REQUEST', 'Invalid trail query.');
    return this.envelope(
      await this.services!.store.trail(
        actor,
        rideId(id),
        rideId(memberId),
        query.cursor as string | undefined,
      ),
      response,
    );
  }
  @Get('rides/:rideId/locations')
  async locations(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.actor(request);
    return this.envelope(await this.services!.store.locations(actor, rideId(id)), response);
  }
  @Post('rides/:rideId/events')
  @HttpCode(200)
  async sample(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.actor(request);
    const value = exactObject(body, ['event']);
    const sample = parseSample(value.event);
    if (sample.rideId !== rideId(id))
      throw new ApiError(400, 'INVALID_REQUEST', 'Ride does not match.');
    return this.envelope(
      await this.services!.store.sample(actor, rideId(request.header('x-device-id') ?? ''), sample),
      response,
    );
  }
  @Post('history/:rideId/samples')
  @HttpCode(200)
  async history(
    @Req() request: Request,
    @Param('rideId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.actor(request);
    const value = exactObject(body, ['samples']);
    if (!Array.isArray(value.samples) || value.samples.length < 1 || value.samples.length > 200)
      throw new ApiError(400, 'INVALID_REQUEST', 'Send 1 to 200 samples.');
    const samples = value.samples.map(parseSample);
    const device = rideId(request.header('x-device-id') ?? '');
    if (samples.some((sample) => sample.rideId !== rideId(id)))
      throw new ApiError(400, 'INVALID_REQUEST', 'Ride does not match.');
    const result: {
      acceptedIds: string[];
      duplicateIds: string[];
      rejected: { id: string; code: string }[];
    } = { acceptedIds: [], duplicateIds: [], rejected: [] };
    for (const sample of samples) {
      try {
        const ack = await this.services!.store.sample(actor, device, sample, true);
        result[ack.status === 'duplicate' ? 'duplicateIds' : 'acceptedIds'].push(sample.id);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status >= 500 || error.status === 401)
          throw error;
        result.rejected.push({ id: sample.id, code: error.code });
      }
    }
    return this.envelope(result, response);
  }
}

// Each delivery rechecks membership and the provider session. No coordinates are
// broadcast to rooms whose authorization may have become stale.
@WebSocketGateway({ namespace: '/v1/rides', transports: ['websocket'], maxHttpBufferSize: 16384 })
export class LocationGateway implements OnApplicationShutdown {
  private readonly limiter = new RideLimiter({ accountPerMinute: 120, ipPerMinute: 120 });
  private readonly subscriptions = new Map<
    Socket,
    { rideId: string; busy: boolean; timer: ReturnType<typeof setInterval> }
  >();
  constructor(@Inject(RIDES) private readonly services: RideServices | null) {}
  private async actor(socket: Socket) {
    if (!this.services) throw unavailable();
    const token: unknown = socket.handshake.auth.token;
    if (typeof token !== 'string' || token.length > 8192) throw unauthenticated();
    const actor = await this.services.verifier.verify(`Bearer ${token}`);
    if (actor.expiresAt <= Date.now() / 1000) throw unauthenticated();
    return actor;
  }
  async handleConnection(socket: Socket) {
    try {
      await this.actor(socket);
    } catch {
      socket.disconnect(true);
    }
  }
  handleDisconnect(socket: Socket) {
    const subscription = this.subscriptions.get(socket);
    if (subscription) clearInterval(subscription.timer);
    this.subscriptions.delete(socket);
  }
  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    try {
      const value = exactObject(body, ['rideId', 'afterSequence']);
      if (!Number.isSafeInteger(value.afterSequence) || Number(value.afterSequence) < 0)
        throw new ApiError(400, 'INVALID_REQUEST', 'Invalid sequence.');
      const id = rideId(String(value.rideId));
      const account = await this.actor(socket);
      if (this.limiter.consume('account', account.id) !== null) throw rateLimited();
      const data = await this.services!.store.locations(account, id);
      if (!socket.connected) throw unauthenticated();
      this.handleDisconnect(socket);
      const subscription = {
        rideId: id,
        busy: false,
        timer: setInterval(() => {
          void this.deliver(socket);
        }, 1000),
      };
      this.subscriptions.set(socket, subscription);
      // A full snapshot replaces cached positions on every reconnect, including removals.
      return { data };
    } catch (error) {
      return this.failure(error);
    }
  }
  private async deliver(socket: Socket) {
    const subscription = this.subscriptions.get(socket);
    if (!subscription || subscription.busy) return;
    subscription.busy = true;
    try {
      const actor = await this.actor(socket);
      const data = await this.services!.store.locations(actor, subscription.rideId);
      if (socket.connected && this.subscriptions.get(socket) === subscription)
        socket.emit('location.snapshot', data);
    } catch {
      this.handleDisconnect(socket);
      socket.emit('access.revoked');
      socket.disconnect(true);
    } finally {
      subscription.busy = false;
    }
  }
  @SubscribeMessage('command')
  async command(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    try {
      const actor = await this.actor(socket);
      if (this.limiter.consume('account', actor.id) !== null) throw rateLimited();
      const value = exactObject(body, ['event']);
      return {
        data: await this.services!.store.sample(
          actor,
          rideId(String(socket.handshake.auth.deviceId)),
          parseSample(value.event),
        ),
      };
    } catch (error) {
      return this.failure(error);
    }
  }
  private failure(error: unknown) {
    return { error: { code: error instanceof ApiError ? error.code : 'TEMPORARILY_UNAVAILABLE' } };
  }
  onApplicationShutdown() {
    for (const socket of this.subscriptions.keys()) {
      this.handleDisconnect(socket);
      socket.disconnect(true);
    }
  }
}
