import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Patch,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { UUID, validDisplayName } from './auth.js';
import { validContact, type EmergencyContact } from './emergency-contact.js';
import type { TokenVerifier } from './auth.js';
import { ApiError, unavailable } from './api-errors.js';
import type { Profile, ProfileChange, ProfileStore } from './profiles.js';

export const ACCOUNTS = Symbol('ACCOUNTS');
export interface AccountServices {
  verifier: TokenVerifier;
  profiles: ProfileStore;
}

export function parseProfileChange(
  body: unknown,
  revision: string | undefined,
  idempotencyKey: string | undefined,
): ProfileChange {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !Object.hasOwn(body, 'displayName')
  ) {
    throw new ApiError(400, 'INVALID_REQUEST', 'Only displayName is accepted.');
  }
  const displayName = (body as Record<string, unknown>).displayName;
  if (typeof displayName !== 'string' || !validDisplayName(displayName)) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'Check your display name.', {
      displayName: 'Use 1–80 plain-text characters without control characters or angle brackets.',
    });
  }
  if (!idempotencyKey || !UUID.test(idempotencyKey)) {
    throw new ApiError(400, 'INVALID_REQUEST', 'Idempotency-Key must be a UUID.');
  }
  if (revision === undefined) {
    throw new ApiError(428, 'PRECONDITION_REQUIRED', 'If-Match is required when saving a profile.');
  }
  const match = revision.match(/^"([1-9][0-9]*)"$/);
  if (!match || !Number.isSafeInteger(Number(match[1]))) {
    throw new ApiError(
      400,
      'INVALID_REQUEST',
      'If-Match must contain one quoted positive revision.',
    );
  }
  return { displayName, revision: Number(match[1]), idempotencyKey: idempotencyKey.toLowerCase() };
}

@Controller('me')
export class AccountController {
  constructor(@Inject(ACCOUNTS) private readonly accounts: AccountServices | null) {}

  @Get('emergency-contact')
  async emergencyContact(
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ data: EmergencyContact | null; requestId: string }> {
    if (!this.accounts) throw unavailable();
    const account = await this.accounts.verifier.verify(authorization);
    const contact = await this.accounts.profiles.readContact(account);
    if (contact) response.setHeader('ETag', `"${contact.revision}"`);
    return { data: contact, requestId: String(response.getHeader('X-Request-Id')) };
  }

  @Put('emergency-contact')
  async saveEmergencyContact(
    @Headers('authorization') authorization: string | undefined,
    @Headers('if-match') revision: string | undefined,
    @Headers('if-none-match') none: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ data: EmergencyContact; requestId: string }> {
    if (!this.accounts) throw unavailable();
    const account = await this.accounts.verifier.verify(authorization);
    if (!contentType || !/^application\/json(?:\s*;|$)/i.test(contentType))
      throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.');
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 2 ||
      !Object.hasOwn(body, 'name') ||
      !Object.hasOwn(body, 'phone')
    )
      throw new ApiError(400, 'INVALID_REQUEST', 'Use only a contact name and phone.');
    const value = body as Record<string, unknown>;
    if (!validContact(value.name, value.phone))
      throw new ApiError(
        422,
        'VALIDATION_FAILED',
        'Check the contact name and international phone number.',
      );
    if (!idempotencyKey || !UUID.test(idempotencyKey))
      throw new ApiError(400, 'INVALID_REQUEST', 'Idempotency-Key must be a UUID.');
    let expected: number | null;
    if (none === '*' && revision === undefined) expected = null;
    else if (
      none === undefined &&
      revision &&
      /^"[1-9][0-9]*"$/.test(revision) &&
      Number.isSafeInteger(Number(revision.slice(1, -1)))
    )
      expected = Number(revision.slice(1, -1));
    else
      throw new ApiError(
        428,
        'PRECONDITION_REQUIRED',
        'Use If-None-Match: * to create or a current If-Match revision to edit.',
      );
    const contact = await this.accounts.profiles.saveContact(account, {
      name: value.name.trim(),
      phone: value.phone as string,
      revision: expected,
      idempotencyKey: idempotencyKey.toLowerCase(),
    });
    response.setHeader('ETag', `"${contact.revision}"`);
    return { data: contact, requestId: String(response.getHeader('X-Request-Id')) };
  }

  @Delete('emergency-contact')
  @HttpCode(204)
  async deleteEmergencyContact(
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<void> {
    if (!this.accounts) throw unavailable();
    const account = await this.accounts.verifier.verify(authorization);
    if (!idempotencyKey || !UUID.test(idempotencyKey))
      throw new ApiError(400, 'INVALID_REQUEST', 'Idempotency-Key must be a UUID.');
    await this.accounts.profiles.deleteContact(account, idempotencyKey.toLowerCase());
  }

  @Get()
  async me(
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ data: Profile; requestId: string }> {
    if (!this.accounts) throw unavailable();
    const account = await this.accounts.verifier.verify(authorization);
    return this.respond(await this.accounts.profiles.read(account), response);
  }

  @Patch()
  async update(
    @Headers('authorization') authorization: string | undefined,
    @Headers('if-match') revision: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ data: Profile; requestId: string }> {
    if (!this.accounts) throw unavailable();
    const account = await this.accounts.verifier.verify(authorization);
    if (!contentType || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
      throw new ApiError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Use application/json for a profile change.',
      );
    }
    const change = parseProfileChange(body, revision, idempotencyKey);
    return this.respond(await this.accounts.profiles.update(account, change), response);
  }

  private respond(data: Profile, response: Response): { data: Profile; requestId: string } {
    response.setHeader('ETag', `"${data.revision}"`);
    return { data, requestId: String(response.getHeader('X-Request-Id')) };
  }
}
