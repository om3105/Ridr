import { LocationController, LocationGateway } from './location-transport.js';
import { osrmRouter } from './route-planning.js';
import { RouteController } from './routes.js';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Module } from '@nestjs/common';
import type { INestApplication, OnApplicationShutdown } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import type { ApiConfig } from './config.js';
import { PostgresHealth } from './database-health.js';
import type { DatabaseHealth } from './database-health.js';
import { DATABASE_HEALTH, HealthController, HealthGateway } from './health.js';
import { OperationalLogger } from './logging.js';
import type { LogSink } from './logging.js';
import { ACCOUNTS, AccountController } from './accounts.js';
import type { AccountServices } from './accounts.js';
import { PostgresSessions, SupabaseTokenVerifier } from './auth.js';
import { PostgresProfiles } from './profiles.js';
import { ApiErrorFilter } from './api-errors.js';
import { RIDES, RideController, type RideServices } from './rides.js';
import type { RideStore } from './ride-types.js';
import { PostgresRides } from './ride-store.js';
import { RideLimiter } from './ride-limits.js';

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_HEALTH) private readonly database: DatabaseHealth) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.close();
  }
}

@Injectable()
class AccountLifecycle implements OnApplicationShutdown {
  constructor(@Inject(ACCOUNTS) private readonly accounts: AccountServices | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.accounts) {
      await Promise.all([this.accounts.profiles.close(), this.accounts.verifier.close()]);
    }
  }
}

@Module({})
class AppModule {}

@Injectable()
class RideLifecycle implements OnApplicationShutdown {
  constructor(@Inject(RIDES) private readonly rides: RideServices | null) {}

  async onApplicationShutdown(): Promise<void> {
    await this.rides?.store.close();
  }
}

export async function createApp(
  config: ApiConfig,
  options: {
    database?: DatabaseHealth;
    logSink?: LogSink;
    accounts?: AccountServices;
    rides?: RideStore;
  } = {},
): Promise<INestApplication> {
  const logger = new OperationalLogger(options.logSink);
  const database = options.database ?? new PostgresHealth(config.databaseUrl, logger);
  let accounts = options.accounts ?? null;
  if (!accounts && config.auth) {
    const verifier = new SupabaseTokenVerifier(
      config.auth,
      new PostgresSessions(config.auth.databaseUrl, logger),
    );
    accounts = { verifier, profiles: new PostgresProfiles(config.databaseUrl, verifier, logger) };
  }
  const rideStore =
    options.rides ??
    (accounts && config.auth
      ? new PostgresRides(
          config.databaseUrl,
          accounts.verifier,
          logger,
          osrmRouter(config.routing ?? {}),
          config.pushTokenKey,
        )
      : null);
  const rides: RideServices | null =
    accounts && rideStore
      ? {
          verifier: accounts.verifier,
          store: rideStore,
          limiter: new RideLimiter(config.rideLimits),
        }
      : null;
  const app = await NestFactory.create(
    {
      module: AppModule,
      controllers: [
        HealthController,
        AccountController,
        RideController,
        RouteController,
        LocationController,
      ],
      providers: [
        { provide: DATABASE_HEALTH, useValue: database },
        DatabaseLifecycle,
        { provide: ACCOUNTS, useValue: accounts },
        AccountLifecycle,
        { provide: RIDES, useValue: rides },
        RideLifecycle,
        HealthGateway,
        LocationGateway,
      ],
    },
    { logger: false },
  );
  app.setGlobalPrefix('v1');
  app.enableCors({
    origin: config.corsOrigins,
    credentials: false,
    exposedHeaders: ['ETag', 'X-Request-Id', 'Retry-After'],
  });
  app.enableShutdownHooks();
  app.useGlobalFilters(new ApiErrorFilter(logger));
  app.use((request: Request, response: Response, next: NextFunction) => {
    const started = performance.now();
    const requestId = randomUUID();
    response.setHeader('X-Request-Id', requestId);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.on('finish', () => {
      const path = request.path;
      logger.write('http_request', {
        requestId,
        method: request.method,
        route: ['/v1/health/live', '/v1/health/ready', '/v1/me'].includes(path)
          ? path
          : 'unmatched',
        status: response.statusCode,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      });
    });
    next();
  });
  return app;
}
