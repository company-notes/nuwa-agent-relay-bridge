import { BridgeError } from './BridgeError.js';
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
  member_ids: string[];
}

export interface GroupSettings
{
  mode: GroupMode;
  approved_groups: GroupApproval[];
}

export class GroupPolicy
{
  static readonly disabled: GroupSettings = { mode: GroupMode.Disabled, approved_groups: [] };
  private readonly approvals: Map<string, Set<string>>;

  constructor(readonly settings: GroupSettings, private readonly backend: MessagingBackend,
    private readonly accountID: string)
  {
    GroupPolicy.validate(settings);
    this.approvals = new Map(settings.approved_groups.map(group => [group.id, new Set(group.member_ids)]));
  }

  static validate(settings: GroupSettings): void
  {
    if (!settings || ![GroupMode.Disabled, GroupMode.Open, GroupMode.Allowlist].includes(settings.mode) ||
        !Array.isArray(settings.approved_groups) ||
        settings.approved_groups.some(group => !group || typeof group.id !== 'string' || !group.id ||
          !Array.isArray(group.member_ids) || !group.member_ids.length ||
          group.member_ids.some(id => typeof id !== 'string' || !id)))
    {
      throw new BridgeError('Invalid group access policy.');
    }
  }

  accepts(groupID: string): boolean
  {
    return Boolean(groupID) && (this.settings.mode === GroupMode.Open ||
      (this.settings.mode === GroupMode.Allowlist && this.approvals.has(groupID)));
  }

  async permits(groupID: string, senderID?: string): Promise<boolean>
  {
    if (!this.accepts(groupID))
    {
      return false;
    }

    const members = await this.backend.groupMembers(groupID);
    if (!members || !members.includes(this.accountID) || (senderID && !members.includes(senderID)))
    {
      return false;
    }

    if (this.settings.mode === GroupMode.Open)
    {
      return true;
    }

    const approved = this.approvals.get(groupID);
    const current = new Set(members);

    return Boolean(approved && approved.size === current.size && [...current].every(id => approved.has(id)));
  }
}
