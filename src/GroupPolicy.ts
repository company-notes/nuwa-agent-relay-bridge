import { BridgeError } from './BridgeError.js';
import { Logger } from './Logger.js';
import type { MessagingBackend } from './Contracts.js';

export enum GroupMode
{
  Disabled = 1,
  Open = 2,
  Allowlist = 3,
}

export interface GroupApproval
{
  id: string;
}

export interface GroupSettings
{
  mode: GroupMode;
  approved_groups: GroupApproval[];
}

export interface GroupMembership
{
  memberCount: number;
}

export class GroupPolicy
{
  static readonly disabled: GroupSettings = { mode: GroupMode.Disabled, approved_groups: [] };
  private readonly approvals: Set<string>;
  private readonly logger = new Logger('group-policy');

  constructor(readonly settings: GroupSettings, private readonly backend: MessagingBackend,
    private readonly accountID: string)
  {
    GroupPolicy.validate(settings);
    this.approvals = new Set(settings.approved_groups.map(group => group.id));
  }

  static validate(settings: GroupSettings): void
  {
    if (!settings || ![GroupMode.Disabled, GroupMode.Open, GroupMode.Allowlist].includes(settings.mode) ||
        !Array.isArray(settings.approved_groups) ||
        settings.approved_groups.some(group => !group || typeof group.id !== 'string' || !group.id))
    {
      throw new BridgeError('Invalid group access policy.');
    }
  }

  accepts(groupID: string): boolean
  {
    return Boolean(groupID) && (this.settings.mode === GroupMode.Open ||
      (this.settings.mode === GroupMode.Allowlist && this.approvals.has(groupID)));
  }

  async membership(groupID: string, senderID?: string): Promise<GroupMembership | undefined>
  {
    if (!this.accepts(groupID))
    {
      this.logger.info('/group/access/rejected', { reason: 'group_not_allowed' });
      return undefined;
    }

    const members = await this.backend.groupMembers(groupID);

    if (!members)
    {
      this.logger.info('/group/access/rejected', { reason: 'roster_unavailable' });
      return undefined;
    }

    if (!members.includes(this.accountID) || (senderID && !members.includes(senderID)))
    {
      this.logger.info('/group/access/rejected', {
        reason: members.includes(this.accountID) ? 'sender_not_in_roster' : 'account_not_in_roster',
        member_count: members.length,
      });
      return undefined;
    }

    return { memberCount: new Set(members).size };
  }
}
