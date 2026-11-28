import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TalkMessage } from '@evex-dev/linejs';

import { LineMessage } from '../src/LineMessage.js';

class NativeEvent
{
  static make(type: string, text?: string, link = 'https://stickershop.line-scdn.net/stickershop/v1/sticker/123/android/sticker.png'): TalkMessage
  {
    return {
      isMyMessage: false, from: { id: 'friend' }, to: { type: 'USER', id: 'company' },
      raw: { id: 'native-1', contentType: type }, text,
      getReplyTarget: () => null, getStickerURL: () => link,
    } as unknown as TalkMessage;
  }
}

test('a LINE sticker is forwarded even when the native event has no text', () =>
{
  const message = LineMessage.normalize(NativeEvent.make('STICKER'), 'company');

  assert.equal(message?.body, '[LINE sticker]');
  assert.equal(message?.conversationID, 'friend');

  assert.deepEqual(message?.artifactLinks, ['https://stickershop.line-scdn.net/stickershop/v1/sticker/123/android/sticker.png']);
});

test('private media is represented explicitly and untrusted sticker URLs are excluded', () =>
{
  const photo = LineMessage.normalize(NativeEvent.make('IMAGE'), 'company');
  const sticker = LineMessage.normalize(NativeEvent.make('STICKER', undefined, 'https://example.invalid/private'), 'company');

  assert.match(photo?.body ?? '', /image received; attachment data is not available/);
  assert.deepEqual(sticker?.artifactLinks, []);
});

test('a real group mention retains its group destination instead of becoming a private message', () =>
{
  const event = {
    isMyMessage: false, from: { id: 'u-employee' }, to: { type: 'GROUP', id: 'c-company' },
    raw: { id: 'group-message', contentType: 'NONE' }, text: '@Company hello',
    getReplyTarget: () => null, getMentions: () => [{ all: false, mid: 'u-company' }],
  } as unknown as TalkMessage;

  const message = LineMessage.normalize(event, 'u-company');

  assert.equal(message?.conversationID, 'group:c-company');
  assert.equal(message?.mentionsAccount, true);
});

test('a native @Everyone addresses the company assistant while an individual mention of another person does not', () =>
{
  const event = {
    isMyMessage: false, from: { id: 'u-employee' }, to: { type: 'GROUP', id: 'c-company' },
    raw: { id: 'group-message', contentType: 'NONE' }, text: '@Everyone hello',
    getReplyTarget: () => null, getMentions: () => [{ all: true }, { all: false, mid: 'u-other' }],
  } as unknown as TalkMessage;

  assert.equal(LineMessage.normalize(event, 'u-company')?.mentionsAccount, true);

  const other = { ...event, getMentions: () => [{ all: false, mid: 'u-other' }] } as unknown as TalkMessage;
  assert.equal(LineMessage.normalize(other, 'u-company')?.mentionsAccount, false);
});
