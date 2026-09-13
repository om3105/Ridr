import { validateDisplayName } from './validation';

export type Profile = {
  id: string;
  displayName: string;
  createdAt: string;
  revision: number;
  activeMembership: null | { id: string; rideId: string; sharingEnabled: boolean };
  entitlement: { adFree: boolean; evaluatedAt: string };
  deletionState: 'none';
};

export class ProfileError extends Error {
  constructor(
    public readonly code: 'unauthorized' | 'blocked' | 'conflict' | 'invalid' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseProfile(value: unknown, userId: string): Profile {
  const profile = object(value);
  const entitlement = object(profile?.entitlement);
  const membership = object(profile?.activeMembership);
  if (
    !profile ||
    profile.id !== userId ||
    typeof profile.displayName !== 'string' ||
    validateDisplayName(profile.displayName) ||
    typeof profile.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(profile.createdAt)) ||
    !Number.isSafeInteger(profile.revision) ||
    (profile.revision as number) < 1 ||
    profile.deletionState !== 'none' ||
    !entitlement ||
    typeof entitlement.adFree !== 'boolean' ||
    typeof entitlement.evaluatedAt !== 'string' ||
    !Number.isFinite(Date.parse(entitlement.evaluatedAt)) ||
    (profile.activeMembership !== null &&
      (!membership ||
        typeof membership.id !== 'string' ||
        typeof membership.rideId !== 'string' ||
        typeof membership.sharingEnabled !== 'boolean'))
  ) {
    throw new ProfileError(
      'invalid',
      'The account service returned an unexpected response. Try again.',
    );
  }
  return profile as unknown as Profile;
}

export async function requestProfile(options: {
  apiUrl: string;
  accessToken: string;
  userId: string;
  change?: { displayName: string; revision: number; idempotencyKey: string };
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<Profile> {
  const { change } = options;
  let origin: string;
  try {
    const url = new URL(options.apiUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error();
    origin = url.origin;
  } catch {
    throw new ProfileError('invalid', 'The account service address needs to be configured.');
  }
  if (
    change &&
    (validateDisplayName(change.displayName) ||
      !Number.isSafeInteger(change.revision) ||
      change.revision < 1 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        change.idempotencyKey,
      ))
  ) {
    throw new ProfileError(
      'invalid',
      'Check the profile name and reload your profile before saving.',
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
  try {
    const response = await (options.fetcher ?? fetch)(`${origin}/v1/me`, {
      method: change ? 'PATCH' : 'GET',
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        Accept: 'application/json',
        ...(change
          ? {
              'Content-Type': 'application/json',
              'If-Match': `"${change.revision}"`,
              'Idempotency-Key': change.idempotencyKey,
            }
          : {}),
      },
      ...(change ? { body: JSON.stringify({ displayName: change.displayName.trim() }) } : {}),
      signal: controller.signal,
    });
    if (response.status === 401)
      throw new ProfileError('unauthorized', 'Your session has ended. Sign in again.');
    if (response.status === 403)
      throw new ProfileError(
        'blocked',
        'This account is unavailable. Sign out to return to the welcome screen.',
      );
    if (response.status === 412 || response.status === 409)
      throw new ProfileError(
        'conflict',
        'Your profile changed elsewhere. Reload it before saving again.',
      );
    if (response.status === 400 || response.status === 422)
      throw new ProfileError('invalid', 'Check the profile name and try again.');
    if (!response.ok)
      throw new ProfileError(
        'unavailable',
        'The account service is unavailable. Your changes have not been confirmed. Try again.',
      );
    const body = object(await response.json());
    if (!body || typeof body.requestId !== 'string')
      throw new ProfileError(
        'invalid',
        'The account service returned an unexpected response. Try again.',
      );
    return parseProfile(body.data, options.userId);
  } catch (error) {
    if (error instanceof ProfileError) throw error;
    throw new ProfileError(
      'unavailable',
      'We could not reach the account service. Check your connection and try again.',
    );
  } finally {
    clearTimeout(timer);
  }
}
