import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { validDisplayName } from './auth.js';
import { unavailable } from './api-errors.js';

export interface EmergencyContact {
  name: string;
  phone: string;
  revision: number;
}
export const validContact = (name: unknown, phone: unknown): name is string =>
  typeof name === 'string' &&
  validDisplayName(name) &&
  typeof phone === 'string' &&
  /^\+[1-9][0-9]{7,14}$/.test(phone);

export function contactKey(pushTokenKey: string | undefined): Buffer | null {
  if (!pushTokenKey) return null;
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(pushTokenKey, 'base64'),
      Buffer.alloc(0),
      'ridr-emergency-contact-v1',
      32,
    ),
  );
}

export function sealContact(contact: EmergencyContact, key: Buffer, userId: string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(userId));
  const body = Buffer.concat([cipher.update(JSON.stringify(contact), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]);
}

export function openContact(ciphertext: Buffer, key: Buffer, userId: string): EmergencyContact {
  try {
    if (ciphertext.length < 29) throw new Error('short');
    const cipher = createDecipheriv('aes-256-gcm', key, ciphertext.subarray(0, 12));
    cipher.setAAD(Buffer.from(userId));
    cipher.setAuthTag(ciphertext.subarray(12, 28));
    const contact = JSON.parse(
      Buffer.concat([cipher.update(ciphertext.subarray(28)), cipher.final()]).toString('utf8'),
    ) as EmergencyContact;
    if (
      !validContact(contact.name, contact.phone) ||
      !Number.isSafeInteger(contact.revision) ||
      contact.revision < 1
    )
      throw new Error('invalid');
    return contact;
  } catch {
    throw unavailable();
  }
}
