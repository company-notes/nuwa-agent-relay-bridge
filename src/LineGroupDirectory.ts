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

    const type = this.chatType(chat.type);
    const members: unknown = chat.extra?.groupExtra?.memberMids;

    if (!chat.chatMid.startsWith('c'))
    {
      this.logger.info('/group/roster/rejected', { reason: 'not_group_mid', chat_type: type });
      return undefined;
    }

    if (!members || typeof members !== 'object' || Array.isArray(members))
    {
      this.logger.info('/group/roster/rejected', { reason: 'missing_member_map', chat_type: type });
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

    this.logger.info('/group/roster/verified', { chat_type: type, member_count: memberIDs.length });

    return {
      id: chat.chatMid, name: (chat.chatName || chat.chatMid).replace(/[\p{Cc}\p{Cf}]/gu, ''),
      memberIDs,
    };
  }

  private chatType(type: unknown): string
  {
    if (type === undefined || type === null)
    {
      return 'absent';
    }

    if (type === 'GROUP' || type === 'ROOM' || type === 'PEER' || type === 0 || type === 1 || type === 2 ||
        type === '0' || type === '1' || type === '2')
    {
      return String(type);
    }

    return 'other_' + typeof type;
  }

  private async joinedIDs(): Promise<string[]>
  {
    const joined = await this.base.talk.getAllChatMids({
      request: { withMemberChats: true, withInvitedChats: false }, syncReason: 'INTERNAL',
    });
    const ids = joined?.memberChatMids ?? [];

    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string'))
    {
      throw new BridgeError('LINE joined group directory returned an invalid response.');
    }

    return ids.filter(id => id.startsWith('c'));
  }

  async members(groupID: string): Promise<string[] | undefined>
  {
    const joined = await this.joinedIDs();

    if (!joined.includes(groupID))
    {
      this.logger.info('/group/roster/rejected', { reason: 'not_joined_group' });
      return undefined;
    }

    const chat = await this.base.talk.getChat({ chatMid: groupID, withMembers: true, withInvitees: true });

    if (chat?.chatMid !== groupID)
    {
      this.logger.info('/group/roster/rejected', { reason: chat ? 'chat_id_mismatch' : 'missing_chat' });
      return undefined;
    }

    return this.parse(chat)?.memberIDs;
  }

  async list(): Promise<LINEGroup[]>
  {
    const ids = await this.joinedIDs();

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
        if (!ids.includes(chat?.chatMid))
        {
          continue;
        }

        const group = this.parse(chat);

        if (group)
        {
          groups.push(group);
        }
      }
    }

    return groups;
  }
}
