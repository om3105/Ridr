import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { saveEmergencyContact, validPhone } from '../src/auth/emergency-contact';

test('contact accepts an international number and sends no member identity or group event', async () => {
  assert.equal(validPhone('+919876543210'), true);
  assert.equal(validPhone('9876543210'), false);
  assert.equal(validPhone('+12'), false);
  const sent: { url: string; body: string; headers: Headers }[] = [];
  const options = {
    apiUrl: 'https://ridr.example/',
    accessToken: 'test',
    userId: randomUUID(),
    fetcher: async (url: RequestInfo | URL, init?: RequestInit) => {
      sent.push({
        url: String(url),
        body: String(init?.body),
        headers: new Headers(init?.headers),
      });
      return new Response(
        JSON.stringify({
          data: { name: 'Contact', phone: '+919876543210', revision: 1 },
          requestId: randomUUID(),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    },
  };
  const key = randomUUID();
  assert.equal(
    (await saveEmergencyContact(options, 'Contact', '+919876543210', 0, key)).revision,
    1,
  );
  assert.equal(sent[0]!.url, 'https://ridr.example/v1/me/emergency-contact');
  assert.deepEqual(JSON.parse(sent[0]!.body), { name: 'Contact', phone: '+919876543210' });
  assert.equal(sent[0]!.headers.get('If-None-Match'), '*');
  assert.equal(sent[0]!.headers.get('Idempotency-Key'), key);
});
