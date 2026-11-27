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
