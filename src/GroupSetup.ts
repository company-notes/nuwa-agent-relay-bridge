import type { Interface } from 'node:readline/promises';

import { BridgeError } from './BridgeError.js';
import { GroupMode, GroupPolicy, type GroupSettings } from './GroupPolicy.js';
import type { LINEGroup } from './LineGroupDirectory.js';
import { Selection } from './Selection.js';

export class GroupSetup
{
  constructor(private readonly input: Interface, private readonly groups: () => Promise<LINEGroup[]>) {}

  async select(): Promise<GroupSettings>
  {
    console.log('1. Disabled: private chats only');
    console.log('2. Open: all joined LINE groups');
    console.log('3. Allowlist: selected joined LINE groups with approved membership');
    console.log('Two-member groups accept ordinary messages. Larger groups use @Mention, @All or an assistant quote.');
    console.log('Group replies are visible to every member. Use an assistant with group-safe tools, data and memory.');

    const choice = (await this.input.question('Group access mode [1/2/3]: ')).trim();

    if (choice === '1')
    {
      return GroupPolicy.disabled;
    }

    if (choice === '2')
    {
      const confirmed = (await this.input.question('Confirm all joined groups may contact the assistant (type yes): ')).trim();

      if (confirmed !== 'yes')
      {
        throw new BridgeError('Open group access was not confirmed.');
      }

      return { mode: GroupMode.Open, approved_groups: [] };
    }

    if (choice !== '3')
    {
      throw new BridgeError('Select group access mode 1, 2, or 3.');
    }

    const groups = await this.groups();
    groups.forEach((group, index) => console.log(`${index + 1}. ${group.name} (${group.memberIDs.length} members, ${group.id})`));
    const selected = await Selection.choose(this.input, groups, 'Allowed group numbers, separated by commas (empty denies all): ');

    return {
      mode: GroupMode.Allowlist,
      approved_groups: selected.map(group => ({ id: group.id, member_ids: group.memberIDs })),
    };
  }
}
