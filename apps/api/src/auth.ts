import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { Pool } from 'pg';
import type { AuthConfig } from './config.js';
import type { OperationalLogger } from './logging.js';
import { unauthenticated, unavailable } from './api-errors.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface VerifiedAccount {
  id: string;
  sessionId: string;
  initialDisplayName: string;
  expiresAt: number;
}

export interface SessionAuthority {
  assertActive(account: VerifiedAccount): Promise<void>;
  close(): Promise<void>;
}

export interface TokenVerifier {
  verify(authorization: string | undefined): Promise<VerifiedAccount>;
  assertActive(account: VerifiedAccount): Promise<void>;
  close(): Promise<void>;
}

export class PostgresSessions implements SessionAuthority {
  private readonly pool: Pool;

  constructor(databaseUrl: string, logger: OperationalLogger) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      application_name: 'ridr-session-check',
      max: 5,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      statement_timeout: 2000,
      query_timeout: 2500,
    });
    this.pool.on('error', () => logger.write('session_pool_error'));
  }

  async assertActive(account: VerifiedAccount): Promise<void> {
    let active: boolean;
    try {
      // The read-only view excludes unverified, deleted, banned and expired users/sessions.
      // Never positively cache this result: a signed JWT can outlive provider sign-out.
      const result = await this.pool.query<{ active: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM ridr_auth.active_sessions WHERE session_id = $1 AND user_id = $2
        ) AS active`,
        [account.sessionId, account.id],
      );
      active = result.rows[0]?.active === true;
    } catch {
      throw unavailable();
    }
    if (!active) throw unauthenticated();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class SupabaseTokenVerifier implements TokenVerifier {
  private readonly key;
  private readonly algorithms: string[];

  constructor(
    private readonly config: AuthConfig,
    private readonly sessions: SessionAuthority,
  ) {
    this.key = config.jwtSecret
      ? new TextEncoder().encode(config.jwtSecret)
      : createRemoteJWKSet(new URL(`${config.url}/.well-known/jwks.json`), {
          timeoutDuration: 3000,
        });
    this.algorithms = config.jwtSecret ? ['HS256'] : ['ES256', 'RS256'];
  }

  async verify(authorization: string | undefined): Promise<VerifiedAccount> {
    const match = authorization?.match(
      /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i,
    );
    if (!match || match[1]!.length > 16384) throw unauthenticated();
    let payload;
    try {
      ({ payload } = await jwtVerify(match[1]!, this.key, {
        issuer: this.config.url,
        audience: 'authenticated',
        algorithms: this.algorithms,
        requiredClaims: ['sub', 'exp', 'iat', 'session_id', 'email', 'role'],
      }));
    } catch (error) {
      if (
        error instanceof errors.JWTExpired ||
        error instanceof errors.JWTClaimValidationFailed ||
        error instanceof errors.JWTInvalid ||
        error instanceof errors.JWSInvalid ||
        error instanceof errors.JWSSignatureVerificationFailed ||
        error instanceof errors.JOSEAlgNotAllowed ||
        error instanceof errors.JWKSNoMatchingKey
      )
        throw unauthenticated();
      // Provider failures do not establish that a user's session ended.
      // jose also uses plain JOSEError for unsuccessful JWKS HTTP responses.
      throw unavailable();
    }
    if (
      typeof payload.sub !== 'string' ||
      !UUID.test(payload.sub) ||
      typeof payload.session_id !== 'string' ||
      !UUID.test(payload.session_id) ||
      payload.role !== 'authenticated' ||
      payload.is_anonymous === true ||
      typeof payload.email !== 'string' ||
      !payload.email.includes('@') ||
      typeof payload.iat !== 'number' ||
      payload.iat > Math.floor(Date.now() / 1000) + 5
    )
      throw unauthenticated();

    const metadata = payload.user_metadata;
    const name =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>).display_name
        : undefined;
    const initialDisplayName =
      typeof name === 'string' && validDisplayName(name) ? name.trim() : 'Ridr rider';
    const account = {
      id: payload.sub.toLowerCase(),
      sessionId: payload.session_id.toLowerCase(),
      initialDisplayName,
      expiresAt: payload.exp!,
    };
    await this.assertActive(account);
    return account;
  }

  async assertActive(account: VerifiedAccount): Promise<void> {
    if (account.expiresAt <= Date.now() / 1000) throw unauthenticated();
    await this.sessions.assertActive(account);
  }

  async close(): Promise<void> {
    await this.sessions.close();
  }
}

export function validDisplayName(value: string): boolean {
  const length = [...value.trim()].length;
  const forbidden = [...value].some((character) => {
    const point = character.codePointAt(0)!;
    return point < 32 || (point >= 127 && point <= 159) || character === '<' || character === '>';
  });
  return length >= 1 && length <= 80 && !forbidden;
}
