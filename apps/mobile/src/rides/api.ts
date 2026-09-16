import { validateDisplayName } from '../auth/validation';
import {
  invitationCodePattern,
  invitationTokenPattern,
  parseInvitationLink,
  type InvitationCredential,
} from './invitations';
import type {
  CreateRideResult,
  InvitationPreview,
  LeaveRideResult,
  Membership,
  MotionContext,
  PhysicalRole,
  ProposalReceipt,
  Ride,
  RideCollection,
  RideInvitation,
  RideManagement,
  RideMembership,
  RideProposal,
  RideSnapshot,
  StopSharingResult,
  Transport,
} from './models';

export type RideClientOptions = {
  apiUrl: string;
  accessToken: string;
  userId: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

export type RideErrorCode =
  | 'unauthorized'
  | 'blocked'
  | 'not_found'
  | 'expired'
  | 'full'
  | 'conflict'
  | 'invalid'
  | 'rate_limited'
  | 'unavailable';

export class RideError extends Error {
  constructor(
    public readonly code: RideErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly unconfirmed = false,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && uuidPattern.test(value);
const integer = (value: unknown, minimum = 1): value is number =>
  Number.isSafeInteger(value) && (value as number) >= minimum;
const textName = (value: unknown): value is string =>
  typeof value === 'string' && validateDisplayName(value) === null;
const transport = (value: unknown): value is Transport =>
  value === 'motorcycle' || value === 'cycling' || value === 'car';
const physicalRole = (value: unknown): value is PhysicalRole =>
  value === 'rider' || value === 'pillion';
const timestamp = (value: unknown): value is string => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  return new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
};

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function invalidResponse(): never {
  throw new RideError('invalid', 'The ride service returned an unexpected response. Try again.');
}

function invalidRequest(): never {
  throw new RideError('invalid', 'Check the ride details and invitation, then try again.');
}

function parseRide(value: unknown, expectedId?: string): Ride {
  const ride = object(value);
  const settings = object(ride?.settings);
  if (
    !ride ||
    !onlyKeys(ride, [
      'id',
      'name',
      'transport',
      'state',
      'leaderMemberId',
      'createdAt',
      'startedAt',
      'endedAt',
      'revision',
      'settings',
    ]) ||
    !uuid(ride.id) ||
    (expectedId !== undefined && ride.id !== expectedId) ||
    !textName(ride.name) ||
    !transport(ride.transport) ||
    !['lobby', 'active', 'ended'].includes(ride.state as string) ||
    !uuid(ride.leaderMemberId) ||
    !timestamp(ride.createdAt) ||
    (ride.startedAt !== null && !timestamp(ride.startedAt)) ||
    (ride.endedAt !== null && !timestamp(ride.endedAt)) ||
    !integer(ride.revision) ||
    !settings ||
    !onlyKeys(settings, ['broadcastIntervalSeconds', 'stragglerDistanceM']) ||
    ![5, 10, 15].includes(settings.broadcastIntervalSeconds as number) ||
    !integer(settings.stragglerDistanceM, 200) ||
    settings.stragglerDistanceM > 2000 ||
    (ride.state === 'lobby' && (ride.startedAt !== null || ride.endedAt !== null)) ||
    (ride.state === 'active' && (ride.startedAt === null || ride.endedAt !== null)) ||
    (ride.state === 'ended' && ride.endedAt === null)
  )
    invalidResponse();
  return ride as unknown as Ride;
}

function parseMembership(
  value: unknown,
  ride: Ride,
  userId?: string,
  allowDeparted = false,
): Membership {
  const member = object(value);
  if (
    !member ||
    !onlyKeys(member, [
      'id',
      'rideId',
      'profileId',
      'displayName',
      'role',
      'physicalRole',
      'joinedAt',
      'leftAt',
      'sharingEnabled',
      'consentEpoch',
      'revision',
    ]) ||
    !uuid(member.id) ||
    member.rideId !== ride.id ||
    !uuid(member.profileId) ||
    (userId !== undefined && member.profileId !== userId) ||
    !textName(member.displayName) ||
    !physicalRole(member.physicalRole) ||
    member.role !== (member.id === ride.leaderMemberId ? 'leader' : member.physicalRole) ||
    (member.role === 'leader' && member.physicalRole !== 'rider') ||
    (ride.transport !== 'motorcycle' && member.physicalRole === 'pillion') ||
    !timestamp(member.joinedAt) ||
    (member.leftAt !== null && (!allowDeparted || !timestamp(member.leftAt))) ||
    typeof member.sharingEnabled !== 'boolean' ||
    ((ride.state !== 'active' || member.leftAt !== null) && member.sharingEnabled) ||
    !integer(member.consentEpoch, 0) ||
    !integer(member.revision)
  )
    invalidResponse();
  return member as unknown as Membership;
}

function parseRideMembership(value: unknown, userId: string, rideId?: string): RideMembership {
  const data = object(value);
  if (!data) invalidResponse();
  const ride = parseRide(data.ride, rideId);
  return { ride, membership: parseMembership(data.membership, ride, userId) };
}

function parseInvite(value: unknown): RideInvitation {
  const invite = object(value);
  if (
    !invite ||
    !onlyKeys(invite, ['id', 'code', 'url', 'expiresAt', 'tokenAvailable']) ||
    !uuid(invite.id) ||
    !timestamp(invite.expiresAt) ||
    typeof invite.tokenAvailable !== 'boolean'
  )
    invalidResponse();
  if (invite.tokenAvailable) {
    if (
      typeof invite.code !== 'string' ||
      !invitationCodePattern.test(invite.code) ||
      typeof invite.url !== 'string' ||
      !parseInvitationLink(invite.url)
    )
      invalidResponse();
  } else if ('code' in invite || 'url' in invite) invalidResponse();
  return invite as unknown as RideInvitation;
}

function checkedCredential(value: InvitationCredential): InvitationCredential {
  const credential = object(value);
  if (!credential || !onlyKeys(credential, ['code', 'token'])) invalidRequest();
  if (
    typeof credential.code === 'string' &&
    invitationCodePattern.test(credential.code) &&
    !('token' in credential)
  )
    return { code: credential.code };
  if (
    typeof credential.token === 'string' &&
    invitationTokenPattern.test(credential.token) &&
    !('code' in credential)
  )
    return { token: credential.token };
  return invalidRequest();
}

function checkMutation(rideId: string | undefined, key: string): void {
  if ((rideId !== undefined && !uuid(rideId)) || !uuid(key)) invalidRequest();
}

async function responseError(response: Response, mutation: boolean): Promise<RideError> {
  let code: unknown;
  try {
    code = object(object(await response.json())?.error)?.code;
  } catch {
    /* Status remains authoritative. */
  }
  if (response.status === 401)
    return new RideError('unauthorized', 'Your session has ended. Sign in again.');
  if (response.status === 403)
    return new RideError(
      'blocked',
      'This account or ride action is unavailable. Reload your rides.',
    );
  if (response.status === 404)
    return new RideError(
      'not_found',
      'This ride or invitation is unavailable. Ask the leader for a new invitation.',
    );
  if (response.status === 410)
    return new RideError(
      'expired',
      'This invitation has expired. Ask the leader for a new invitation.',
    );
  if (response.status === 409 && code === 'RIDE_FULL')
    return new RideError(
      'full',
      'This ride already has 50 people. Ask the leader before trying again.',
    );
  if ([409, 412, 428].includes(response.status))
    return new RideError(
      'conflict',
      code === 'ACTIVE_RIDE_CONFLICT'
        ? 'You already belong to another active ride. Finish that ride before joining this one.'
        : 'The ride or request changed. Reload your rides before trying again.',
    );
  if (response.status === 429) {
    const retry = response.headers.get('Retry-After');
    const seconds =
      retry && /^\d+$/.test(retry) && Number.isSafeInteger(Number(retry)) ? Number(retry) : null;
    return new RideError(
      'rate_limited',
      'Too many attempts. Wait before trying again.',
      true,
      false,
      seconds,
    );
  }
  if ([400, 413, 415, 422].includes(response.status))
    return new RideError('invalid', 'Check the ride details and invitation, then try again.');
  return new RideError(
    'unavailable',
    mutation
      ? 'The ride service is unavailable. Your request is unconfirmed; retry the same request.'
      : 'The ride service is unavailable. Try again.',
    true,
    mutation,
  );
}

async function request<T>(
  options: RideClientOptions,
  requestOptions: {
    path: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    idempotencyKey?: string;
    revision?: number;
    parse: (value: unknown) => T;
    noContent?: boolean;
  },
): Promise<T> {
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
    throw new RideError('invalid', 'The ride service address needs to be configured.');
  }
  if (!uuid(options.userId) || !options.accessToken || /[\r\n]/.test(options.accessToken))
    invalidRequest();
  const mutation = requestOptions.idempotencyKey !== undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
  try {
    const response = await (options.fetcher ?? fetch)(`${origin}${requestOptions.path}`, {
      method: requestOptions.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        Accept: 'application/json',
        ...(requestOptions.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(requestOptions.idempotencyKey
          ? { 'Idempotency-Key': requestOptions.idempotencyKey }
          : {}),
        ...(requestOptions.revision !== undefined
          ? { 'If-Match': `"${requestOptions.revision}"` }
          : {}),
      },
      ...(requestOptions.body !== undefined ? { body: JSON.stringify(requestOptions.body) } : {}),
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) throw await responseError(response, mutation);
    try {
      if (requestOptions.noContent) {
        if (response.status !== 204) invalidResponse();
        return requestOptions.parse(undefined);
      }
      const envelope = object(await response.json());
      if (!envelope || !onlyKeys(envelope, ['data', 'requestId']) || !uuid(envelope.requestId))
        invalidResponse();
      return requestOptions.parse(envelope.data);
    } catch {
      throw new RideError(
        'invalid',
        mutation
          ? 'The ride response could not be confirmed. Retry the same request.'
          : 'The ride service returned an unexpected response. Try again.',
        true,
        mutation,
      );
    }
  } catch (error) {
    if (error instanceof RideError) throw error;
    throw new RideError(
      'unavailable',
      mutation
        ? 'Your request is unconfirmed. Check your connection and retry the same request.'
        : 'We could not reach the ride service. Check your connection and try again.',
      true,
      mutation,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function createRide(
  options: RideClientOptions,
  change: {
    name: string;
    transport: Transport;
    idempotencyKey: string;
  },
): Promise<CreateRideResult> {
  checkMutation(undefined, change.idempotencyKey);
  if (!textName(change.name) || !transport(change.transport)) invalidRequest();
  return request(options, {
    path: '/v1/rides',
    method: 'POST',
    idempotencyKey: change.idempotencyKey,
    body: { name: change.name.trim(), transport: change.transport },
    parse: (value) => {
      const data = object(value);
      if (!data || !onlyKeys(data, ['ride', 'membership', 'invite'])) invalidResponse();
      const result = parseRideMembership(data, options.userId);
      if (
        result.ride.state !== 'lobby' ||
        result.ride.name !== change.name.trim() ||
        result.ride.transport !== change.transport ||
        result.membership.role !== 'leader' ||
        result.membership.sharingEnabled
      )
        invalidResponse();
      return { ...result, invite: parseInvite(data.invite) };
    },
  });
}

export async function previewInvitation(
  options: RideClientOptions,
  credential: InvitationCredential,
): Promise<InvitationPreview> {
  return request(options, {
    path: '/v1/invites/preview',
    method: 'POST',
    body: checkedCredential(credential),
    parse: (value) => {
      const data = object(value);
      if (
        !data ||
        !onlyKeys(data, [
          'rideId',
          'rideName',
          'transport',
          'state',
          'availableRoles',
          'expiresAt',
        ]) ||
        !uuid(data.rideId) ||
        !textName(data.rideName) ||
        !transport(data.transport) ||
        !['lobby', 'active'].includes(data.state as string) ||
        !timestamp(data.expiresAt) ||
        !Array.isArray(data.availableRoles) ||
        data.availableRoles.length < 1 ||
        data.availableRoles.length > 2 ||
        !data.availableRoles.every(physicalRole) ||
        new Set(data.availableRoles).size !== data.availableRoles.length ||
        (data.transport !== 'motorcycle' && data.availableRoles.some((role) => role !== 'rider'))
      )
        invalidResponse();
      return data as unknown as InvitationPreview;
    },
  });
}

export async function joinRide(
  options: RideClientOptions,
  change: {
    rideId: string;
    credential: InvitationCredential;
    physicalRole: PhysicalRole;
    idempotencyKey: string;
  },
): Promise<RideMembership> {
  checkMutation(change.rideId, change.idempotencyKey);
  if (!physicalRole(change.physicalRole)) invalidRequest();
  const credential = checkedCredential(change.credential);
  return request(options, {
    path: `/v1/rides/${change.rideId}/join`,
    method: 'POST',
    idempotencyKey: change.idempotencyKey,
    body: {
      ...('code' in credential
        ? { inviteCode: credential.code }
        : { inviteToken: credential.token }),
      physicalRole: change.physicalRole,
    },
    parse: (value) => {
      const data = object(value);
      if (!data || !onlyKeys(data, ['ride', 'membership'])) invalidResponse();
      const result = parseRideMembership(data, options.userId, change.rideId);
      // Existing membership wins on a repeated join; joining never changes its role or consent.
      if (result.ride.state === 'ended') invalidResponse();
      return result;
    },
  });
}

export async function getRide(options: RideClientOptions, rideId: string): Promise<RideSnapshot> {
  if (!uuid(rideId)) invalidRequest();
  return request(options, {
    path: `/v1/rides/${rideId}`,
    parse: (value) => {
      const data = object(value);
      if (!data || !onlyKeys(data, ['ride', 'membership', 'members'])) invalidResponse();
      const result = parseRideMembership(data, options.userId, rideId);
      if (!Array.isArray(data.members) || data.members.length < 1 || data.members.length > 50)
        invalidResponse();
      const members = data.members.map((member) => parseMembership(member, result.ride));
      if (
        new Set(members.map((member) => member.id)).size !== members.length ||
        new Set(members.map((member) => member.profileId)).size !== members.length ||
        !members.some((member) => member.id === result.ride.leaderMemberId) ||
        !members.some((member) =>
          Object.keys(result.membership).every(
            (key) => member[key as keyof Membership] === result.membership[key as keyof Membership],
          ),
        )
      )
        invalidResponse();
      return { ...result, members };
    },
  });
}

export async function listRides(
  options: RideClientOptions,
  query: { limit?: number; cursor?: string } = {},
): Promise<RideCollection> {
  const limit = query.limit ?? 50;
  if (
    !integer(limit) ||
    limit > 100 ||
    (query.cursor !== undefined && !/^[A-Za-z0-9_-]{1,1024}$/.test(query.cursor))
  )
    invalidRequest();
  return request(options, {
    path: `/v1/rides?limit=${limit}${query.cursor ? `&cursor=${encodeURIComponent(query.cursor)}` : ''}`,
    parse: (value) => {
      const data = object(value);
      if (
        !data ||
        !onlyKeys(data, ['items', 'nextCursor']) ||
        !Array.isArray(data.items) ||
        data.items.length > limit ||
        (data.nextCursor !== null &&
          (typeof data.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(data.nextCursor)))
      )
        invalidResponse();
      const items = data.items.map((item) => {
        const row = object(item);
        if (!row || !onlyKeys(row, ['ride', 'membership'])) invalidResponse();
        const result = parseRideMembership(row, options.userId);
        if (result.ride.state === 'ended') invalidResponse();
        return result;
      });
      if (new Set(items.map((item) => item.ride.id)).size !== items.length) invalidResponse();
      return { items, nextCursor: data.nextCursor as string | null };
    },
  });
}

export async function rotateInvitation(
  options: RideClientOptions,
  change: {
    rideId: string;
    revision: number;
    idempotencyKey: string;
    motionContext?: MotionContext;
  },
): Promise<RideInvitation> {
  checkMutation(change.rideId, change.idempotencyKey);
  if (!integer(change.revision)) invalidRequest();
  return request(options, {
    path: `/v1/rides/${change.rideId}/invites`,
    method: 'POST',
    body: {
      rotate: true,
      ...(change.motionContext ? checkedMotion(change.motionContext) : {}),
    },
    idempotencyKey: change.idempotencyKey,
    revision: change.revision,
    parse: parseInvite,
  });
}

export async function revokeInvitation(
  options: RideClientOptions,
  change: { rideId: string; idempotencyKey: string },
): Promise<void> {
  checkMutation(change.rideId, change.idempotencyKey);
  return request(options, {
    path: `/v1/rides/${change.rideId}/invites/current`,
    method: 'DELETE',
    idempotencyKey: change.idempotencyKey,
    noContent: true,
    parse: () => undefined,
  });
}

function checkedMotion(context: MotionContext): MotionContext {
  const motion = object(context.motion);
  if (
    !motion ||
    !onlyKeys(motion, ['state', 'source', 'observedAt']) ||
    !['stopped', 'moving', 'unknown'].includes(motion.state as string) ||
    !['speed', 'activity', 'unavailable'].includes(motion.source as string) ||
    !timestamp(motion.observedAt) ||
    !timestamp(context.capturedAt)
  )
    invalidRequest();
  return {
    motion: {
      state: motion.state as MotionContext['motion']['state'],
      source: motion.source as MotionContext['motion']['source'],
      observedAt: motion.observedAt,
    },
    capturedAt: context.capturedAt,
  };
}

function parseProposal(value: unknown, ride: Ride): RideProposal {
  const proposal = object(value);
  if (
    !proposal ||
    !onlyKeys(proposal, [
      'id',
      'kind',
      'requesterMemberId',
      'targetMemberId',
      'physicalRole',
      'expiresAt',
    ]) ||
    !uuid(proposal.id) ||
    !['role_change', 'leadership'].includes(proposal.kind as string) ||
    !uuid(proposal.requesterMemberId) ||
    !uuid(proposal.targetMemberId) ||
    !timestamp(proposal.expiresAt) ||
    (proposal.kind === 'leadership'
      ? proposal.physicalRole !== null
      : !physicalRole(proposal.physicalRole)) ||
    (ride.transport !== 'motorcycle' && proposal.physicalRole === 'pillion')
  )
    invalidResponse();
  return proposal as unknown as RideProposal;
}

function parseProposalReceipt(value: unknown): ProposalReceipt {
  const data = object(value);
  if (
    !data ||
    !onlyKeys(data, ['proposalId', 'expiresAt']) ||
    !uuid(data.proposalId) ||
    !timestamp(data.expiresAt)
  )
    invalidResponse();
  return data as unknown as ProposalReceipt;
}

export async function getRideManagement(
  options: RideClientOptions,
  rideId: string,
): Promise<RideManagement> {
  if (!uuid(rideId)) invalidRequest();
  return request(options, {
    path: `/v1/rides/${rideId}/management`,
    parse: (value) => {
      const data = object(value);
      if (!data || !onlyKeys(data, ['ride', 'membership', 'proposals'])) invalidResponse();
      const ride = parseRide(data.ride, rideId);
      const membership = parseMembership(data.membership, ride, options.userId, true);
      if (!Array.isArray(data.proposals)) invalidResponse();
      const proposals = data.proposals.map((value) => parseProposal(value, ride));
      if (
        new Set(proposals.map((proposal) => proposal.id)).size !== proposals.length ||
        proposals.some(
          (proposal) =>
            proposal.requesterMemberId !== membership.id &&
            proposal.targetMemberId !== membership.id,
        ) ||
        ((ride.state === 'ended' || membership.leftAt !== null) && proposals.length > 0)
      )
        invalidResponse();
      return { ride, membership, proposals };
    },
  });
}

type RideCommand = { rideId: string; idempotencyKey: string };
type StationaryChange = RideCommand & MotionContext & { revision: number };

export async function startRide(
  options: RideClientOptions,
  change: StationaryChange,
): Promise<Ride> {
  checkMutation(change.rideId, change.idempotencyKey);
  if (!integer(change.revision)) invalidRequest();
  return request(options, {
    path: `/v1/rides/${change.rideId}/start`,
    method: 'POST',
    body: checkedMotion(change),
    revision: change.revision,
    idempotencyKey: change.idempotencyKey,
    parse: (value) => {
      const ride = parseRide(value, change.rideId);
      if (ride.state !== 'active') invalidResponse();
      return ride;
    },
  });
}

export async function endRide(
  options: RideClientOptions,
  change: RideCommand & {
    reason: 'completed' | 'cancelled';
    capturedAt: string;
    consentEpoch: number;
  },
): Promise<Ride> {
  checkMutation(change.rideId, change.idempotencyKey);
  if (
    !['completed', 'cancelled'].includes(change.reason) ||
    !timestamp(change.capturedAt) ||
    !integer(change.consentEpoch, 0)
  )
    invalidRequest();
  return request(options, {
    path: `/v1/rides/${change.rideId}/end`,
    method: 'POST',
    body: {
      reason: change.reason,
      capturedAt: change.capturedAt,
      consentEpoch: change.consentEpoch,
    },
    idempotencyKey: change.idempotencyKey,
    parse: (value) => {
      const ride = parseRide(value, change.rideId);
      if (ride.state !== 'ended') invalidResponse();
      return ride;
    },
  });
}

type PrivacyStop = RideCommand & { stoppedAt: string; consentEpoch: number };

function checkedPrivacyStop(change: PrivacyStop) {
  checkMutation(change.rideId, change.idempotencyKey);
  if (!timestamp(change.stoppedAt) || !integer(change.consentEpoch, 0)) invalidRequest();
  return { stoppedAt: change.stoppedAt, consentEpoch: change.consentEpoch };
}

export async function leaveRide(
  options: RideClientOptions,
  change: PrivacyStop,
): Promise<LeaveRideResult> {
  const body = checkedPrivacyStop(change);
  return request(options, {
    path: `/v1/rides/${change.rideId}/leave`,
    method: 'POST',
    body,
    idempotencyKey: change.idempotencyKey,
    parse: (value) => {
      const data = object(value);
      if (
        !data ||
        !onlyKeys(data, ['leftAt', 'revision']) ||
        !timestamp(data.leftAt) ||
        !integer(data.revision)
      )
        invalidResponse();
      return data as unknown as LeaveRideResult;
    },
  });
}

export async function stopRideSharing(
  options: RideClientOptions,
  change: PrivacyStop,
): Promise<StopSharingResult> {
  const body = { enabled: false, ...checkedPrivacyStop(change) };
  return request(options, {
    path: `/v1/rides/${change.rideId}/sharing`,
    method: 'PUT',
    body,
    idempotencyKey: change.idempotencyKey,
    parse: (value) => {
      const data = object(value);
      if (
        !data ||
        !onlyKeys(data, ['enabled', 'consentEpoch', 'revision', 'effectiveAt']) ||
        typeof data.enabled !== 'boolean' ||
        !integer(data.consentEpoch, 0) ||
        !integer(data.revision) ||
        !timestamp(data.effectiveAt)
      )
        invalidResponse();
      return data as unknown as StopSharingResult;
    },
  });
}

export async function proposeRole(
  options: RideClientOptions,
  change: StationaryChange & { targetMemberId: string; physicalRole: PhysicalRole },
): Promise<ProposalReceipt> {
  checkMutation(change.rideId, change.idempotencyKey);
  if (
    !integer(change.revision) ||
    !uuid(change.targetMemberId) ||
    !physicalRole(change.physicalRole)
  )
    invalidRequest();
  return request(options, {
    path: `/v1/rides/${change.rideId}/role-proposals`,
    method: 'POST',
    body: {
      targetMemberId: change.targetMemberId,
      physicalRole: change.physicalRole,
      ...checkedMotion(change),
    },
    revision: change.revision,
    idempotencyKey: change.idempotencyKey,
    parse: parseProposalReceipt,
  });
}

export async function proposeLeadership(
  options: RideClientOptions,
  change: StationaryChange & { targetMemberId: string },
): Promise<ProposalReceipt> {
  checkMutation(change.rideId, change.idempotencyKey);
  if (!integer(change.revision) || !uuid(change.targetMemberId)) invalidRequest();
  return request(options, {
    path: `/v1/rides/${change.rideId}/leadership-proposals`,
    method: 'POST',
    body: { targetMemberId: change.targetMemberId, ...checkedMotion(change) },
    revision: change.revision,
    idempotencyKey: change.idempotencyKey,
    parse: parseProposalReceipt,
  });
}

type AcceptProposal = MotionContext & {
  ride: Ride;
  proposal: RideProposal;
  idempotencyKey: string;
};

function checkedAcceptance(change: AcceptProposal, kind: RideProposal['kind']) {
  checkMutation(change.ride.id, change.idempotencyKey);
  if (
    !uuid(change.proposal.id) ||
    !uuid(change.proposal.targetMemberId) ||
    change.proposal.kind !== kind
  )
    invalidRequest();
  return checkedMotion(change);
}

export async function acceptRole(
  options: RideClientOptions,
  change: AcceptProposal,
): Promise<Membership> {
  const body = checkedAcceptance(change, 'role_change');
  if (!physicalRole(change.proposal.physicalRole)) invalidRequest();
  return request(options, {
    path: `/v1/rides/${change.ride.id}/role-proposals/${change.proposal.id}/accept`,
    method: 'POST',
    body,
    idempotencyKey: change.idempotencyKey,
    parse: (value) => {
      const member = parseMembership(value, change.ride, options.userId);
      if (
        member.id !== change.proposal.targetMemberId ||
        member.physicalRole !== change.proposal.physicalRole
      )
        invalidResponse();
      return member;
    },
  });
}

export async function acceptLeadership(
  options: RideClientOptions,
  change: AcceptProposal,
): Promise<Ride> {
  const body = checkedAcceptance(change, 'leadership');
  return request(options, {
    path: `/v1/rides/${change.ride.id}/leadership-proposals/${change.proposal.id}/accept`,
    method: 'POST',
    body,
    idempotencyKey: change.idempotencyKey,
    parse: (value) => {
      const ride = parseRide(value, change.ride.id);
      if (ride.state === 'ended' || ride.leaderMemberId !== change.proposal.targetMemberId)
        invalidResponse();
      return ride;
    },
  });
}

export async function cancelRideProposal(
  options: RideClientOptions,
  change: RideCommand & { kind: RideProposal['kind']; proposalId: string },
): Promise<void> {
  checkMutation(change.rideId, change.idempotencyKey);
  if (!uuid(change.proposalId) || !['role_change', 'leadership'].includes(change.kind))
    invalidRequest();
  const resource = change.kind === 'role_change' ? 'role-proposals' : 'leadership-proposals';
  return request(options, {
    path: `/v1/rides/${change.rideId}/${resource}/${change.proposalId}`,
    method: 'DELETE',
    idempotencyKey: change.idempotencyKey,
    noContent: true,
    parse: () => undefined,
  });
}
