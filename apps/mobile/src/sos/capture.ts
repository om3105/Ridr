import type { SosPosition } from './api';

let staged: { rideId: string; position: SosPosition | null } | null = null;
export function stageSosPosition(rideId: string, position: SosPosition | null) {
  staged = { rideId, position };
}
export function takeSosPosition(rideId: string) {
  const value = staged?.rideId === rideId ? staged.position : null;
  staged = null;
  return value;
}
