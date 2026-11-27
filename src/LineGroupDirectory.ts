import type { BaseClient } from '@evex-dev/linejs/base';

import { BridgeError } from './BridgeError.js';

export interface LINEGroup
{
  id: string;
  name: string;
  memberIDs: string[];
}

export class LineGroupDirectory
{
  constructor(private readonly base: BaseClient) {}

  private parse(chat: Awaited<ReturnType<BaseClient['talk']['getChat']>>): LINEGroup | undefined
  {
    const members = chat?.extra?.groupExtra?.memberMids;

    if (!chat || chat.type !== 'GROUP' || typeof chat.chatMid !== 'string' ||
        !members || typeof members !== 'object' || Array.isArray(members))
    {
      return undefined;
    }

    const memberIDs = Object.keys(members);

    if (!this.base.profile?.mid || !memberIDs.includes(this.base.profile.mid))
    {
      return undefined;
    }

    return {
      id: chat.chatMid, name: (chat.chatName || chat.chatMid).replace(/[\p{Cc}\p{Cf}]/gu, ''),
      memberIDs,
    };
  }

  async members(groupID: string): Promise<string[] | undefined>
  {
    const chat = await this.base.talk.getChat({ chatMid: groupID, withMembers: true, withInvitees: false });
    const group = this.parse(chat);

    return group?.id === groupID ? group.memberIDs : undefined;
  }

  async list(): Promise<LINEGroup[]>
  {
    const joined = await this.base.talk.getAllChatMids({
      request: { withMemberChats: true, withInvitedChats: false }, syncReason: 'INTERNAL',
    });
    const ids = joined?.memberChatMids;

    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string'))
    {
      throw new BridgeError('LINE joined group directory returned an invalid response.');
    }

    const groups: LINEGroup[] = [];

    for (let offset = 0; offset < ids.length; offset += 50)
    {
      const result = await this.base.talk.getChats({
        chatMids: ids.slice(offset, offset + 50), withMembers: true, withInvitees: false,
      });

      if (!Array.isArray(result?.chats))
      {
        throw new BridgeError('LINE group directory returned an invalid response.');
      }

      for (const chat of result.chats)
      {
        const group = this.parse(chat);

        if (group && ids.includes(group.id))
        {
          groups.push(group);
        }
      }
    }

    return groups;
  }
}
