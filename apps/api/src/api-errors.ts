import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import type { OperationalLogger } from './logging.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export function unauthenticated(): ApiError {
  return new ApiError(401, 'UNAUTHENTICATED', 'Sign in again to continue.');
}

export function inviteUnavailable(): ApiError {
  return new ApiError(
    404,
    'INVITE_UNAVAILABLE',
    'This invitation is unavailable. Ask the leader for a new one.',
  );
}

export function unavailable(): ApiError {
  return new ApiError(
    503,
    'TEMPORARILY_UNAVAILABLE',
    'Account service is unavailable. Please try again.',
  );
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: OperationalLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = response.getHeader('X-Request-Id');
    let error: ApiError;
    if (exception instanceof ApiError) {
      error = exception;
    } else if (exception instanceof HttpException && exception.getStatus() < 500) {
      const status = exception.getStatus();
      const code =
        status === 404 ? 'NOT_FOUND' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST';
      error = new ApiError(
        status,
        code,
        status === 404 ? 'Resource not found.' : 'The request could not be accepted.',
      );
    } else {
      this.logger.write('request_failed', { requestId: String(requestId) });
      error = unavailable();
    }
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        requestId,
        ...(error.fields ? { fields: error.fields } : {}),
      },
    });
  }
}
