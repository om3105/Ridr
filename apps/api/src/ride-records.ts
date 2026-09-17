import { unavailable } from './api-errors.js';
import type { Ride, Membership, PhysicalRole } from './ride-types.js';
export interface RideRow {
  id: string;
  name: string;
  transport: Ride['transport'];
  state: Ride['state'];
  leader_member_id: string;
  created_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
  revision: string;
  broadcast_seconds: 5 | 10 | 15;
  straggler_metres: number;
}

export interface MemberRow {
  id: string;
  ride_id: string;
  user_id: string;
  display_name: string;
  physical_role: PhysicalRole;
  joined_at: Date;
  left_at: Date | null;
  sharing: boolean;
  consent_epoch: string;
  revision: string;
}

export function integer(value: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw unavailable();
  return result;
}

export function rideProjection(row: RideRow): Ride {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    state: row.state,
    leaderMemberId: row.leader_member_id,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    endedAt: row.ended_at?.toISOString() ?? null,
    revision: integer(row.revision),
    settings: {
      broadcastIntervalSeconds: row.broadcast_seconds,
      stragglerDistanceM: row.straggler_metres,
    },
  };
}

export function memberProjection(row: MemberRow, ride: RideRow): Membership {
  return {
    id: row.id,
    rideId: row.ride_id,
    profileId: row.user_id,
    displayName: row.display_name,
    role: row.id === ride.leader_member_id ? 'leader' : row.physical_role,
    physicalRole: row.physical_role,
    joinedAt: row.joined_at.toISOString(),
    leftAt: row.left_at?.toISOString() ?? null,
    sharingEnabled: row.sharing,
    consentEpoch: integer(row.consent_epoch),
    revision: integer(row.revision),
  };
}
