import type { BaseClient } from '@evex-dev/linejs/base';

import { BridgeError } from './BridgeError.js';

export interface LINEFriend
{
  id: string;
  name: string;
}

export class LineContactDirectory
{
  constructor(private readonly base: BaseClient) {}

  private async friendIDs(): Promise<string[]>
  {
    const [contacts, blocked] = await Promise.all([
      this.base.talk.getAllContactIds({ syncReason: 'INTERNAL' }),
      this.base.talk.getBlockedContactIds({ syncReason: 'INTERNAL' }),
    ]);

    if (!Array.isArray(contacts) || !Array.isArray(blocked) ||
        [...contacts, ...blocked].some(id => typeof id !== 'string'))
    {
      throw new BridgeError('LINE contact directory returned an invalid response.');
    }

    const excluded = new Set(blocked);
    return [...new Set(contacts)].filter(id => !excluded.has(id) && id !== this.base.profile?.mid);
  }

  async isFriend(senderID: string): Promise<boolean>
  {
    return (await this.friendIDs()).includes(senderID);
  }

  async list(): Promise<LINEFriend[]>
  {
    const ids = await this.friendIDs();
    const names = new Map<string, string>();

    for (let offset = 0; offset < ids.length; offset += 50)
    {
      const contacts = await this.base.talk.getContacts({ mids: ids.slice(offset, offset + 50) });

      for (const contact of contacts)
      {
        names.set(contact.mid, contact.displayName);
      }
    }

    return ids.map(id => ({ id, name: (names.get(id) || id).replace(/[\p{Cc}\p{Cf}]/gu, '') }));
  }
}
