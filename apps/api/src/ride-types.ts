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

export interface RotateInvite {
  revision: number;
  idempotencyKey: string;
}

export interface RideStore {
  create(account: VerifiedAccount, change: CreateRide): Promise<CreatedRide>;
  preview(account: VerifiedAccount, credential: PreviewInvite): Promise<RidePreview>;
  join(account: VerifiedAccount, rideId: string, change: JoinRide): Promise<RideMembership>;
  read(account: VerifiedAccount, rideId: string): Promise<RideSnapshot>;
  list(account: VerifiedAccount, query: { limit: number; cursor?: string }): Promise<RideList>;
  rotate(account: VerifiedAccount, rideId: string, change: RotateInvite): Promise<Invite>;
  revoke(account: VerifiedAccount, rideId: string, change: { idempotencyKey: string }): Promise<void>;
  close(): Promise<void>;
}
