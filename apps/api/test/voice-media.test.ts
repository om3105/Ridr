import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { inspectVoice, probeVoice } from '../src/voice-media.js';

const sample = resolve(process.cwd(), 'test/fixtures/one-second-aac.m4a');
test('native AAC sample passes container, codec and duration checks', async () => {
  const bytes = await readFile(sample);
  const header = inspectVoice(bytes);
  assert.ok(header.durationSeconds > 0 && header.durationSeconds < 2);
  const probed = await probeVoice(sample);
  assert.ok(probed > 0 && probed < 2);
  assert.throws(() => inspectVoice(Buffer.alloc(128)));
  await assert.rejects(probeVoice(resolve(process.cwd(), 'test/fixtures/missing.m4a')));
});
