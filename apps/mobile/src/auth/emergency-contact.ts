import { request, RideError, type RideClientOptions } from '../rides/api';
import { validateDisplayName } from './validation';

export type EmergencyContact = { name: string; phone: string; revision: number };
export const validPhone = (value: string) => /^\+[1-9][0-9]{7,14}$/.test(value);
function parse(value: unknown): EmergencyContact {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RideError('invalid', 'The emergency contact response is invalid.');
  const item = value as Record<string, unknown>;
  if (
    typeof item.name !== 'string' ||
    validateDisplayName(item.name) ||
    typeof item.phone !== 'string' ||
    !validPhone(item.phone) ||
    !Number.isSafeInteger(item.revision) ||
    Number(item.revision) < 1
  )
    throw new RideError('invalid', 'The emergency contact response is invalid.');
  return item as EmergencyContact;
}
export function getEmergencyContact(options: RideClientOptions) {
  return request(options, {
    path: '/v1/me/emergency-contact',
    parse: (value) => (value === null ? null : parse(value)),
  });
}
export function saveEmergencyContact(
  options: RideClientOptions,
  name: string,
  phone: string,
  revision: number,
  idempotencyKey: string,
) {
  if (
    validateDisplayName(name) ||
    !validPhone(phone) ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  )
    throw new RideError('invalid', 'Enter a contact name and international phone number.');
  return request(options, {
    path: '/v1/me/emergency-contact',
    method: 'PUT',
    body: { name: name.trim(), phone },
    revision,
    idempotencyKey,
    parse,
  });
}
export function deleteEmergencyContact(options: RideClientOptions, idempotencyKey: string) {
  return request(options, {
    path: '/v1/me/emergency-contact',
    method: 'DELETE',
    idempotencyKey,
    noContent: true,
    parse: () => undefined,
  });
}
