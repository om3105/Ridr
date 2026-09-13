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

export async function createApp(
  config: ApiConfig,
  options: { database?: DatabaseHealth; logSink?: LogSink; accounts?: AccountServices } = {},
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
  const app = await NestFactory.create(
    {
      module: AppModule,
      controllers: [HealthController, AccountController],
      providers: [
        { provide: DATABASE_HEALTH, useValue: database },
        DatabaseLifecycle,
        { provide: ACCOUNTS, useValue: accounts },
        AccountLifecycle,
        HealthGateway,
      ],
    },
    { logger: false },
  );
  app.setGlobalPrefix('v1');
  app.enableCors({
    origin: config.corsOrigins,
    credentials: false,
    exposedHeaders: ['ETag', 'X-Request-Id'],
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
