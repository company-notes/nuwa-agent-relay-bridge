import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BaseClient } from '@evex-dev/linejs/base';

import { LineGroupDirectory } from '../src/LineGroupDirectory.js';

class ControlledLINE
{
  private readonly chats = new Map([
    ['company', { type: 'GROUP', chatMid: 'company', chatName: 'Company',
      extra: { groupExtra: { memberMids: { bot: 1, employee: 2 } } } }],
    ['invited', { type: 'GROUP', chatMid: 'invited', chatName: 'Invited',
      extra: { groupExtra: { memberMids: { employee: 1 }, inviteeMids: { bot: 2 } } } }],
  ]);

  readonly base = {
    profile: { mid: 'bot' },
    talk: {
      getAllChatMids: async () => ({ memberChatMids: ['company'], invitedChatMids: ['invited'] }),
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

  assert.deepEqual(await directory.list(), [{ id: 'company', name: 'Company', memberIDs: ['bot', 'employee'] }]);

  assert.deepEqual(await directory.members('company'), ['bot', 'employee']);
  assert.equal(await directory.members('invited'), undefined);
  assert.equal(await directory.members('missing'), undefined);
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

test('group roster reads request the complete member and invitee response and reject other chat types', async () =>
{
  const chat = {
    type: 'GROUP', chatMid: 'c-company', chatName: 'Company',
    extra: { groupExtra: { memberMids: new Map([['bot', 1], ['employee', 2]]) } },
  };
  const base = {
    profile: { mid: 'bot' },
    talk: {
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
  chat.type = 'PEER';
  assert.equal(await directory.members('c-company'), undefined);
  chat.type = 'GROUP';
  chat.extra.groupExtra.memberMids.delete('bot');
  assert.equal(await directory.members('c-company'), undefined);
});
