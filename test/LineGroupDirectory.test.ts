import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BaseClient } from '@evex-dev/linejs/base';

import { LineGroupDirectory } from '../src/LineGroupDirectory.js';

class ControlledLINE
{
  private readonly chats = new Map([
    ['c-company', { type: 'GROUP', chatMid: 'c-company', chatName: 'Company',
      extra: { groupExtra: { memberMids: { bot: 1, employee: 2 } } } }],
    ['c-invited', { type: 'GROUP', chatMid: 'c-invited', chatName: 'Invited',
      extra: { groupExtra: { memberMids: { employee: 1 }, inviteeMids: { bot: 2 } } } }],
  ]);

  readonly base = {
    profile: { mid: 'bot' },
    talk: {
      getAllChatMids: async () => ({ memberChatMids: ['c-company'], invitedChatMids: ['c-invited'] }),
      getChats: async ({ chatMids }: { chatMids: string[] }) => ({
        chats: chatMids.map(id => this.chats.get(id)),
      }),
      getChat: async ({ chatMid }: { chatMid: string }) => this.chats.get(chatMid),
    },
  } as unknown as BaseClient;
}

test('the administrator sees joined groups only and invited accounts cannot send group replies', async () =>
{
  const line = new ControlledLINE();
  const directory = new LineGroupDirectory(line.base);

  assert.deepEqual(await directory.list(), [{ id: 'c-company', name: 'Company', memberIDs: ['bot', 'employee'] }]);

  assert.deepEqual(await directory.members('c-company'), ['bot', 'employee']);
  assert.equal(await directory.members('c-invited'), undefined);
  assert.equal(await directory.members('c-missing'), undefined);
});

test('a joined group with a numeric or omitted default group enum still provides a verified roster', async () =>
{
  for (const type of [0, undefined])
  {
    const chat = {
      type, chatMid: 'c-company', chatName: 'Company',
      extra: { groupExtra: { memberMids: { bot: 1, employee: 2 } } },
    };
    const base = {
      profile: { mid: 'bot' },
      talk: {
        getAllChatMids: async () => ({ memberChatMids: ['c-company'] }),
        getChats: async () => ({ chats: [chat] }),
        getChat: async () => chat,
      },
    } as unknown as BaseClient;
    const directory = new LineGroupDirectory(base);

    assert.deepEqual(await directory.members('c-company'), ['bot', 'employee']);
    assert.deepEqual((await directory.list()).map(group => group.id), ['c-company']);
  }
});

test('group roster reads request the complete member response and reject private, mismatched or incomplete chats', async () =>
{
  const chat = {
    type: 'GROUP', chatMid: 'c-company', chatName: 'Company',
    extra: { groupExtra: { memberMids: new Map([['bot', 1], ['employee', 2]]) } },
  };
  const base = {
    profile: { mid: 'bot' },
    talk: {
      getAllChatMids: async () => ({ memberChatMids: ['c-company', 'u-private'] }),
      getChat: async (options: { withMembers: boolean; withInvitees: boolean }) =>
      {
        assert.equal(options.withMembers, true);
        assert.equal(options.withInvitees, true);
        return chat;
      },
    },
  } as unknown as BaseClient;
  const directory = new LineGroupDirectory(base);

  assert.deepEqual(await directory.members('c-company'), ['bot', 'employee']);

  chat.chatMid = 'u-private';
  assert.equal(await directory.members('u-private'), undefined);
  assert.equal(await directory.members('c-company'), undefined);

  chat.chatMid = 'c-company';
  chat.extra.groupExtra.memberMids.delete('bot');
  assert.equal(await directory.members('c-company'), undefined);
});

test('a joined group with contradictory chat type still uses its group ID and explicit roster', async () =>
{
  const chat = {
    type: 'PEER', chatMid: 'c-company', chatName: 'Company',
    extra: { groupExtra: { memberMids: { bot: 1, employee: 2 } } },
  };
  const base = {
    profile: { mid: 'bot' },
    talk: {
      getAllChatMids: async () => ({ memberChatMids: ['c-company'] }),
      getChats: async () => ({ chats: [chat] }),
      getChat: async () => chat,
    },
  } as unknown as BaseClient;
  const directory = new LineGroupDirectory(base);

  assert.deepEqual(await directory.members('c-company'), ['bot', 'employee']);
  assert.deepEqual((await directory.list()).map(group => group.id), ['c-company']);
});

test('a former member or a pending invitation cannot authorize a group even with a cached roster', async () =>
{
  const chat = {
    type: 'GROUP', chatMid: 'c-company', chatName: 'Company',
    extra: { groupExtra: { memberMids: { bot: 1, employee: 2 } } },
  };
  const base = {
    profile: { mid: 'bot' },
    talk: {
      getAllChatMids: async () => ({ memberChatMids: [], invitedChatMids: ['c-company'] }),
      getChat: async () => chat,
    },
  } as unknown as BaseClient;
  const directory = new LineGroupDirectory(base);

  assert.equal(await directory.members('c-company'), undefined);
  assert.deepEqual(await directory.list(), []);
});
