export type Transport = 'motorcycle' | 'cycling' | 'car';
export type PhysicalRole = 'rider' | 'pillion';

export type Ride = {
  id: string;
  name: string;
  transport: Transport;
  state: 'lobby' | 'active' | 'ended';
  leaderMemberId: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  revision: number;
  settings: { broadcastIntervalSeconds: 5 | 10 | 15; stragglerDistanceM: number };
};

export type Membership = {
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
};

export type RideMembership = { ride: Ride; membership: Membership };
export type RideSnapshot = RideMembership & { members: Membership[] };
export type RideCollection = { items: RideMembership[]; nextCursor: string | null };
export type RideInvitation = {
  id: string;
  code?: string;
  url?: string;
  expiresAt: string;
  tokenAvailable: boolean;
};
export type CreateRideResult = RideMembership & { invite: RideInvitation };
export type InvitationPreview = {
  rideId: string;
  rideName: string;
  transport: Transport;
  state: 'lobby' | 'active';
  availableRoles: PhysicalRole[];
  expiresAt: string;
};
