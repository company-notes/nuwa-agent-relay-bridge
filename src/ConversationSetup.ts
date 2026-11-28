import type { Interface } from 'node:readline/promises';

import type { LINEGroup } from './LineGroupDirectory.js';
import { Selection } from './Selection.js';
import { GroupActivationPolicy, type ConversationSettings } from './GroupActivationPolicy.js';
import { BridgeError } from './BridgeError.js';

export class ConversationSetup
{
  constructor(private readonly input: Interface, private readonly groups: () => Promise<LINEGroup[]>) {}

  async select(previous?: ConversationSettings): Promise<ConversationSettings | undefined>
  {
    console.log('Natural group conversation sends bounded recent text to Cloudflare Workers AI for addressee classification.');
    console.log('Selected groups must consent to cloud processing and contextual forwarding to the assistant.');

    const groups = await this.groups();
    groups.forEach((group, index) => console.log(`${index + 1}. ${group.name} (${group.memberIDs.length} members)`));

    const selected = await Selection.choose(this.input, groups, 'Enable for group numbers (empty disables): ');

    if (!selected.length)
    {
      return undefined;
    }

    const name = (await this.input.question('Assistant chat name [' + (previous?.assistant_name ?? '小媧') + ']: ')).trim()
      || previous?.assistant_name || '小媧';
    const settings = { assistant_name: name, approved_groups: selected.map(group => ({
      id: group.id, member_ids: group.memberIDs,
    })) };
    GroupActivationPolicy.validate(settings);

    const confirmation = (await this.input.question('Confirm member consent for cloud processing and contextual forwarding (type yes): ')).trim();

    if (confirmation !== 'yes')
    {
      throw new BridgeError('Natural group conversation approval was not confirmed.');
    }

    return settings;
  }
}
