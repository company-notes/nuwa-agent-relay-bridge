import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LineLoginPrompt } from '../src/LineLoginPrompt.js';

test('an administrator can scan a locally rendered QR without a raw login URL in the terminal', () =>
{
  const output: string[] = [];
  const prompt = new LineLoginPrompt(message => output.push(message));
  const url = 'https://example.invalid/qr?secret=synthetic-test-secret';
  prompt.qr(url);

  assert.match(output.join('\n'), /Scan this QR code/);
  assert.match(output[1] ?? '', /[▀▄█]/);
  assert.doesNotMatch(output.join('\n'), /synthetic-test-secret|https:\/\//);
});

test('a failed LINE confirmation provides actionable diagnostics without exposing request secrets', () =>
{
  const prompt = new LineLoginPrompt(() => {});
  prompt.qr('https://example.invalid/qr');
  const error = prompt.failure(new Error('Request internal failed: status=410 method=checkQrCodeVerified bodyLength=99 secret=synthetic'));

  assert.match(error.message, /QR confirmation/);
  assert.match(error.message, /expired session, HTTP 410, operation checkQrCodeVerified/);
  assert.doesNotMatch(error.message, /synthetic|bodyLength/);

  prompt.pin('123456');
  assert.match(prompt.failure(new Error('timed out')).message, /confirming PIN.*timeout/);

  prompt.resume();
  assert.match(prompt.failure(new Error('fetch failed')).message, /restoring the saved LINE session.*network failure/);
});
