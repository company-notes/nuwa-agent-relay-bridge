import type { Interface } from 'node:readline/promises';

import { AccessMode, type AccessSettings } from './AccessPolicy.js';
import { BridgeError } from './BridgeError.js';
import type { LINEFriend } from './LineContactDirectory.js';

export class AccessSetup
{
  constructor(private readonly input: Interface, private readonly contacts: () => Promise<LINEFriend[]>) {}

  async select(): Promise<AccessSettings>
  {
    console.log('1. Open: anyone who can send a private LINE message');
    console.log('2. Friends: company LINE contact list, excluding blocked contacts');
    console.log('3. Allowlist: selected company LINE contacts');
    console.log('Use an assistant restricted to the data and tools approved for every permitted sender.');

    const choice = (await this.input.question('Access mode [1/2/3]: ')).trim();

    if (choice === '1')
    {
      const confirmed = (await this.input.question('Confirm public access to this assistant (type yes): ')).trim();

      if (confirmed !== 'yes')
      {
        throw new BridgeError('Public access was not confirmed.');
      }

      return { mode: AccessMode.Open, allowed_user_ids: [] };
    }

    if (choice === '2')
    {
      await this.contacts();
      return { mode: AccessMode.Friends, allowed_user_ids: [] };
    }

    if (choice !== '3')
    {
      throw new BridgeError('Select access mode 1, 2, or 3.');
    }

    const friends = await this.contacts();
    friends.forEach((friend, index) => console.log(`${index + 1}. ${friend.name} (${friend.id})`));
    const selection = (await this.input.question('Allowed contact numbers, separated by commas (empty denies all): ')).trim();
    const numbers = selection ? selection.split(',').map(value => Number(value.trim())) : [];

    if (numbers.some(value => !Number.isInteger(value) || value < 1 || value > friends.length))
    {
      throw new BridgeError('Invalid contact selection.');
    }

    return { mode: AccessMode.Allowlist, allowed_user_ids: [...new Set(numbers.map(value => friends[value - 1]!.id))] };
  }
}
