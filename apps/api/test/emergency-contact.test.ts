import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { contactKey, openContact, sealContact, validContact } from '../src/emergency-contact.js';

test('contact encryption binds ciphertext to its owner and detects tampering', () => {
  const key = contactKey(Buffer.alloc(32, 7).toString('base64'))!;
  const owner = randomUUID();
  const contact = { name: 'Private person', phone: '+919876543210', revision: 1 };
  assert.equal(validContact(contact.name, contact.phone), true);
  assert.equal(validContact(contact.name, '9876543210'), false);
  const ciphertext = sealContact(contact, key, owner);
  assert.deepEqual(openContact(ciphertext, key, owner), contact);
  assert.equal(ciphertext.includes(Buffer.from(contact.phone)), false);
  assert.throws(() => openContact(ciphertext, key, randomUUID()));
  const tampered = Buffer.from(ciphertext);
  tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
  assert.throws(() => openContact(tampered, key, owner));
});
