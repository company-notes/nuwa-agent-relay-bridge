import type { BaseClient } from '@evex-dev/linejs/base';

import { BridgeError } from './BridgeError.js';
import { Logger } from './Logger.js';

export interface LINEGroup
{
  id: string;
  name: string;
  memberIDs: string[];
}

export class LineGroupDirectory
{
  private readonly logger = new Logger('line-groups');

  constructor(private readonly base: BaseClient) {}

  private parse(chat: Awaited<ReturnType<BaseClient['talk']['getChat']>>): LINEGroup | undefined
  {
    if (!chat || typeof chat.chatMid !== 'string')
    {
      this.logger.info('/group/roster/rejected', { reason: 'missing_chat' });
      return undefined;
    }

    // LINE's Chat type uses enum GROUP = 0. A missing default discriminator
    // is accepted only with a group MID and explicit group roster.
    const type: unknown = chat.type;
    const isGroup = type === 'GROUP' || ((type === 0 || type === undefined) && chat.chatMid.startsWith('c'));
    const members: unknown = chat.extra?.groupExtra?.memberMids;

    if (!isGroup)
    {
      this.logger.info('/group/roster/rejected', { reason: 'not_group' });
      return undefined;
    }

    if (!members || typeof members !== 'object' || Array.isArray(members))
    {
      this.logger.info('/group/roster/rejected', { reason: 'missing_member_map' });
      return undefined;
    }

    const keys = members instanceof Map ? [...members.keys()] : Object.keys(members);
    if (keys.some(id => typeof id !== 'string' || !id))
    {
      this.logger.info('/group/roster/rejected', { reason: 'invalid_member_ids' });
      return undefined;
    }

    const memberIDs: string[] = keys;

    if (!this.base.profile?.mid || !memberIDs.includes(this.base.profile.mid))
    {
      this.logger.info('/group/roster/rejected', { reason: 'account_not_in_roster', member_count: memberIDs.length });
      return undefined;
    }

    return {
      id: chat.chatMid, name: (chat.chatName || chat.chatMid).replace(/[\p{Cc}\p{Cf}]/gu, ''),
      memberIDs,
    };
  }

  async members(groupID: string): Promise<string[] | undefined>
  {
    const chat = await this.base.talk.getChat({ chatMid: groupID, withMembers: true, withInvitees: true });
    const group = this.parse(chat);

    if (group && group.id !== groupID)
    {
      this.logger.info('/group/roster/rejected', { reason: 'chat_id_mismatch' });
      return undefined;
    }

    return group?.memberIDs;
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
        chatMids: ids.slice(offset, offset + 50), withMembers: true, withInvitees: true,
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
