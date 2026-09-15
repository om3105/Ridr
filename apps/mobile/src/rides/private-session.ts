import type { InvitationCredential } from './invitations';

// Invite credentials never enter navigation parameters, diagnostics, or persistent storage.
let generation = 0;
let pending: InvitationCredential | null = null;
let invalidLink = false;
let version = 0;
const listeners = new Set<() => void>();
function changed() {
  version++;
  listeners.forEach((listener) => listener());
}
export function rideSessionGeneration() {
  return generation;
}
export function clearRideSession() {
  generation++;
  pending = null;
  invalidLink = false;
  changed();
}
export function receiveInvitation(credential: InvitationCredential | null) {
  pending = credential;
  invalidLink = credential === null;
  changed();
}
export function peekInvitation() {
  return { credential: pending, invalid: invalidLink };
}
export function clearIncomingInvitation() {
  pending = null;
  invalidLink = false;
  changed();
}
export function invitationVersion() {
  return version;
}
export function subscribeInvitation(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
