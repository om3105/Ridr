import type { AlertSettings } from './ride-alerts.js';
import type { MessageEvent, RideMessage } from './messages.js';
import type { TrailPage } from './trails.js';
import type { LocationSample, LocationAck, LiveLocations } from './location.js';
import type { RouteChange, SavedRoute } from './route-planning.js';
import type { VerifiedAccount } from './auth.js';

export type Transport = 'motorcycle' | 'cycling' | 'car';
export type PhysicalRole = 'rider' | 'pillion';

export interface Ride {
  id: string;
  name: string;
  transport: Transport;
  state: 'lobby' | 'active' | 'ended';
  leaderMemberId: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  revision: number;
  settings: {
    broadcastIntervalSeconds: 5 | 10 | 15;
    stragglerDistanceM: number;
  };
}

export interface Membership {
  id: string;
  rideId: string;
  profileId: string;
  displayName: string;
  role: 'leader' | PhysicalRole;
  physicalRole: PhysicalRole;
  joinedAt: string;
  leftAt: string | null;
  sharingEnabled: boolean;
  consentEpoch: number;
  revision: number;
}

export interface Invite {
  id: string;
  code?: string;
  url?: string;
  expiresAt: string;
  tokenAvailable: boolean;
}

export interface RideMembership {
  ride: Ride;
  membership: Membership;
}

export interface CreatedRide extends RideMembership {
  invite: Invite;
}

export interface RidePreview {
  rideId: string;
  rideName: string;
  transport: Transport;
  state: 'lobby' | 'active';
  availableRoles: PhysicalRole[];
  expiresAt: string;
}

export interface RideSnapshot extends RideMembership {
  members: Membership[];
}

export interface RideList {
  items: RideMembership[];
  nextCursor: string | null;
}

export interface CreateRide {
  name: string;
  transport: Transport;
  idempotencyKey: string;
}

export type PreviewInvite = { code: string; token?: never } | { token: string; code?: never };

export interface JoinRide {
  inviteCode?: string;
  inviteToken?: string;
  physicalRole: PhysicalRole;
  idempotencyKey: string;
}

export interface RotateInvite extends Partial<MotionContext> {
  revision: number;
  idempotencyKey: string;
}

export interface RideStore {
  headcount(account: VerifiedAccount, rideId: string): Promise<HeadcountRound | null>;
  beginHeadcount(
    account: VerifiedAccount,
    rideId: string,
    change: MotionContext & Command,
  ): Promise<HeadcountRound>;
  confirmHeadcount(
    account: VerifiedAccount,
    rideId: string,
    roundId: string,
    pairId: string,
    change: MotionContext & Command & { scanReceiptId: string },
  ): Promise<HeadcountRound>;
  completeHeadcount(
    account: VerifiedAccount,
    rideId: string,
    roundId: string,
    change: MotionContext & Command & { revision: number },
  ): Promise<HeadcountRound>;
  readiness(account: VerifiedAccount, rideId: string): Promise<ReadinessOverview>;
  issueReadinessScan(
    account: VerifiedAccount,
    rideId: string,
    pairId: string,
    change: MotionContext & { roundId: string | null },
  ): Promise<ScanChallenge>;
  acceptReadinessScan(
    account: VerifiedAccount,
    rideId: string,
    pairId: string,
    change: MotionContext & Command & { challengeId: string; scannedToken: string },
  ): Promise<ScanReceipt>;
  attestReadiness(
    account: VerifiedAccount,
    rideId: string,
    pairId: string,
    change: MotionContext &
      Command & { revision: number; helmetConfirmed: true; ready: true; scanReceiptId: string },
  ): Promise<ReadinessAttestation>;
  currentPair(
    account: VerifiedAccount,
    rideId: string,
  ): Promise<{ pair: { id: string; partnerName: string } | null }>;
  issuePairInvitation(
    account: VerifiedAccount,
    rideId: string,
    change: MotionContext,
  ): Promise<PairInvitation>;
  previewPairInvitation(
    account: VerifiedAccount,
    rideId: string,
    change: MotionContext & { token: string },
  ): Promise<PairPreview>;
  pair(
    account: VerifiedAccount,
    rideId: string,
    change: MotionContext & Command & { pairInvitationId: string; token: string; consent: true },
  ): Promise<PairResult>;
  unpair(
    account: VerifiedAccount,
    rideId: string,
    pairId: string,
    change: MotionContext & Command,
  ): Promise<void>;
  sendMessage(account: VerifiedAccount, event: MessageEvent): Promise<RideMessage>;
  messageReceipts(
    account: VerifiedAccount,
    rideId: string,
    ids: string[],
  ): Promise<{ accepted: string[] }>;
  messages(
    account: VerifiedAccount,
    rideId: string,
    afterSequence: number,
    limit: number,
  ): Promise<{ items: RideMessage[]; nextSequence: number | null }>;
  uploadVoice(
    account: VerifiedAccount,
    rideId: string,
    upload: { mediaId: string; capturedAt: string; motion: MotionContext['motion']; bytes: Buffer },
  ): Promise<RideMessage>;
  voiceContent(account: VerifiedAccount, rideId: string, mediaId: string): Promise<Buffer>;
  registerPush(
    account: VerifiedAccount,
    deviceId: string,
    token: string | null,
  ): Promise<{ enabled: boolean; expiresAt: string | null }>;
  pushStatus(
    account: VerifiedAccount,
    deviceId: string,
  ): Promise<{
    configured: boolean;
    registered: boolean;
    deliveries: { state: string; count: number }[];
  }>;
  enableSharing(
    account: VerifiedAccount,
    rideId: string,
    change: Command & { revision: number },
  ): Promise<SharingState>;
  registerDevice(
    account: VerifiedAccount,
    deviceId: string,
    platform: 'ios' | 'android',
  ): Promise<void>;
  sample(
    account: VerifiedAccount,
    deviceId: string,
    sample: LocationSample,
    historical?: boolean,
  ): Promise<LocationAck>;
  trail(
    account: VerifiedAccount,
    rideId: string,
    memberId: string,
    cursor?: string,
  ): Promise<TrailPage>;
  alertSettings(
    account: VerifiedAccount,
    rideId: string,
    change: AlertSettings,
  ): Promise<{ value: number }>;
  acknowledgeAlert(
    account: VerifiedAccount,
    rideId: string,
    deviceId: string,
    alertId: string,
  ): Promise<{ acknowledged: boolean }>;
  locations(account: VerifiedAccount, rideId: string): Promise<LiveLocations>;
  route(account: VerifiedAccount, rideId: string): Promise<SavedRoute | null>;
  saveRoute(account: VerifiedAccount, rideId: string, change: RouteChange): Promise<SavedRoute>;
  create(account: VerifiedAccount, change: CreateRide): Promise<CreatedRide>;
  preview(account: VerifiedAccount, credential: PreviewInvite): Promise<RidePreview>;
  join(account: VerifiedAccount, rideId: string, change: JoinRide): Promise<RideMembership>;
  read(account: VerifiedAccount, rideId: string): Promise<RideSnapshot>;
  list(account: VerifiedAccount, query: { limit: number; cursor?: string }): Promise<RideList>;
  rotate(account: VerifiedAccount, rideId: string, change: RotateInvite): Promise<Invite>;
  revoke(
    account: VerifiedAccount,
    rideId: string,
    change: { idempotencyKey: string },
  ): Promise<void>;
  start(account: VerifiedAccount, rideId: string, change: StartRide): Promise<Ride>;
  end(account: VerifiedAccount, rideId: string, change: EndRide): Promise<Ride>;
  leave(account: VerifiedAccount, rideId: string, change: StopSharing): Promise<LeftRide>;
  stopSharing(account: VerifiedAccount, rideId: string, change: StopSharing): Promise<SharingState>;
  management(account: VerifiedAccount, rideId: string): Promise<RideManagement>;
  propose(
    account: VerifiedAccount,
    rideId: string,
    kind: ProposalKind,
    change: ProposeChange,
  ): Promise<ProposedChange>;
  accept(
    account: VerifiedAccount,
    rideId: string,
    proposalId: string,
    kind: ProposalKind,
    change: AcceptChange,
  ): Promise<Ride | Membership>;
  cancel(
    account: VerifiedAccount,
    rideId: string,
    proposalId: string,
    kind: ProposalKind,
    change: Command,
  ): Promise<void>;
  close(): Promise<void>;
}

export interface Command {
  idempotencyKey: string;
}
export interface PairInvitation {
  pairInvitationId: string;
  token: string;
  expiresAt: string;
}
export interface PairPreview {
  pairInvitationId: string;
  counterpart: { memberId: string; displayName: string; physicalRole: PhysicalRole };
  expiresAt: string;
}
export interface PairResult {
  pair: { id: string; riderMemberId: string; pillionMemberId: string; createdAt: string };
  readinessScanReceiptId: string;
  readinessScanExpiresAt: string;
}
export interface PairReadiness {
  id: string;
  revision: number;
  rider: { memberId: string; displayName: string };
  pillion: { memberId: string; displayName: string };
  ready: boolean;
  confirmedAt: string | null;
}
export interface ReadinessOverview {
  ownMemberId: string;
  ownPair: PairReadiness | null;
  leaderPairs: PairReadiness[] | null;
}
export interface ScanChallenge {
  challengeId: string;
  token: string;
  expiresAt: string;
}
export interface ScanReceipt {
  scanReceiptId: string;
  pairId: string;
  expiresAt: string;
}
export interface ReadinessAttestation {
  pairId: string;
  memberId: string;
  helmetConfirmed: true;
  ready: true;
  confirmedAt: string;
}
export interface HeadcountPair {
  id: string;
  riderName: string;
  pillionName: string;
  confirmed: boolean;
  confirmedAt: string | null;
}
export interface HeadcountRound {
  id: string;
  state: 'open' | 'completed';
  revision: number;
  openedAt: string;
  completedAt: string | null;
  pairingRevision: number;
  pairIds: string[];
  confirmedPairIds: string[];
  pairs: HeadcountPair[] | null;
  ownPair: HeadcountPair | null;
}
export interface MotionContext {
  motion: {
    state: 'stopped' | 'moving' | 'unknown';
    source: 'speed' | 'activity' | 'unavailable';
    observedAt: string;
  };
  capturedAt: string;
}
export interface StartRide extends MotionContext, Command {
  revision: number;
}
export interface EndRide extends Command {
  reason: 'completed' | 'cancelled';
  capturedAt: string;
  consentEpoch: number;
}
export interface StopSharing extends Command {
  stoppedAt: string;
  consentEpoch: number;
}
export interface LeftRide {
  leftAt: string;
  revision: number;
}
export interface SharingState {
  enabled: boolean;
  consentEpoch: number;
  revision: number;
  effectiveAt: string;
}
export type ProposalKind = 'role_change' | 'leadership';
export interface ProposeChange extends StartRide {
  targetMemberId: string;
  physicalRole?: PhysicalRole;
}
export interface AcceptChange extends MotionContext, Command {}
export interface ProposedChange {
  proposalId: string;
  expiresAt: string;
}
export interface Proposal {
  id: string;
  kind: ProposalKind;
  requesterMemberId: string;
  targetMemberId: string;
  physicalRole: PhysicalRole | null;
  expiresAt: string;
}
export interface RideManagement extends RideMembership {
  proposals: Proposal[];
}
