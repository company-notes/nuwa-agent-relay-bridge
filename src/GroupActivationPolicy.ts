import type { NativeMessage } from './Contracts.js';
import type { ConversationDecision } from './ConversationDecision.js';
import type { GroupApproval, GroupAudience } from './GroupPolicy.js';

export interface ConversationSettings
{
  assistant_name: string;
  approved_groups: GroupApproval[];
}

export class GroupActivationPolicy
{
  constructor(_settings?: ConversationSettings, _decision?: ConversationDecision, _clock?: () => number) {}

  async activate(_groupID: string, audience: GroupAudience, _message: NativeMessage, addressed: boolean): Promise<boolean>
  {
    return addressed || audience.memberCount === 2;
  }

  recordReply(_groupID: string, _audience: GroupAudience, _body: string, _nativeID: string): void {}
}
