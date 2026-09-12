import { Controller, Get, Inject, Res } from '@nestjs/common';
import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { Response } from 'express';
import type { DatabaseHealth, Readiness } from './database-health.js';

export const DATABASE_HEALTH = Symbol('DATABASE_HEALTH');
export const LIVE_STATUS = { status: 'ok', service: 'ridr-api' } as const;

@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE_HEALTH) private readonly database: DatabaseHealth) {}

  @Get('live')
  live(): typeof LIVE_STATUS {
    return LIVE_STATUS;
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response): Promise<Readiness> {
    const readiness = await this.database.check();
    response.status(readiness.status === 'ok' ? 200 : 503);
    response.setHeader('Cache-Control', 'no-store');
    return readiness;
  }
}

// A public, data-free transport probe. Ride namespaces are added only with authorization.
@WebSocketGateway({
  namespace: '/health',
  transports: ['websocket'],
  maxHttpBufferSize: 1024,
})
export class HealthGateway {
  @SubscribeMessage('health.ping')
  ping(): typeof LIVE_STATUS {
    return LIVE_STATUS;
  }
}
