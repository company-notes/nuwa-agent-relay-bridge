import type { NativeMessage } from './Contracts.js';
import type { ConversationDecision } from './ConversationDecision.js';
import { ConversationWindow } from './ConversationWindow.js';
import { ConversationHistory } from './ConversationHistory.js';
import { GroupMode, GroupPolicy, type GroupApproval, type GroupAudience, type GroupSettings } from './GroupPolicy.js';
import { BridgeError } from './BridgeError.js';
import { Logger } from './Logger.js';

export interface ConversationSettings
{
  assistant_name: string;
  approved_groups: GroupApproval[];
}

interface Activation
{
  context?: string;
}

export class GroupActivationPolicy
{
  static readonly threshold = 0.8;
  private static readonly cooldown = 30_000;
  private readonly approvals: ReadonlyMap<string, string>;
  private readonly logger = new Logger('group-activation');
  private retryAt = 0;

  constructor(private readonly history: ConversationHistory, groupSettings: GroupSettings,
    private readonly settings?: ConversationSettings, private readonly decision?: ConversationDecision,
    private readonly clock: () => number = Date.now)
  {
    this.approvals = GroupActivationPolicy.approvedAudiences(settings, groupSettings);
    this.history.reconcile(this.approvals);
    this.prune();
  }

  static approvedAudiences(settings: ConversationSettings | undefined, groupSettings: GroupSettings): ReadonlyMap<string, string>
  {
    const approvals = new Map<string, string>();

    if (!settings || groupSettings.mode === GroupMode.Disabled)
    {
      return approvals;
    }

    GroupActivationPolicy.validate(settings);
    const allowed = new Map(groupSettings.approved_groups.map(group => [group.id, GroupPolicy.fingerprint(group.member_ids)]));

    for (const group of settings.approved_groups)
    {
      const audience = GroupPolicy.fingerprint(group.member_ids);

      if (groupSettings.mode === GroupMode.Open || allowed.get(group.id) === audience)
      {
        approvals.set(group.id, audience);
      }
    }

    return approvals;
  }

  static validate(settings: ConversationSettings): void
  {
    if (!settings || typeof settings.assistant_name !== 'string' || !settings.assistant_name.trim() ||
        settings.assistant_name.length > 64 || /[\p{Cc}\p{Cf}]/u.test(settings.assistant_name))
    {
      throw new BridgeError('Invalid conversation assistant name.');
    }

    GroupPolicy.validate({ mode: GroupMode.Allowlist, approved_groups: settings.approved_groups });
  }

  prune(): void
  {
    this.history.prune(this.clock());
  }

  authorizesContext(groupID: string, audience?: GroupAudience): boolean
  {
    return audience !== undefined && this.approvals.get(groupID) === audience.fingerprint;
  }

  observeAudience(groupID: string, audience?: GroupAudience): void
  {
    this.history.observeAudience(groupID, this.authorizesContext(groupID, audience) ? audience?.fingerprint : undefined);
  }

  async activate(groupID: string, audience: GroupAudience, message: NativeMessage, addressed: boolean): Promise<Activation | undefined>
  {
    this.observeAudience(groupID, audience);
    const direct = addressed || audience.memberCount === 2;

    if (!this.authorizesContext(groupID, audience))
    {
      return direct ? {} : this.skip(message, 'not_approved');
    }

    const name = this.settings!.assistant_name;
    const now = this.clock();
    this.history.prune(now);
    const window = direct ? undefined : this.history.window(groupID, audience.fingerprint, message.messageID);

    this.history.append(groupID, audience.fingerprint, message.messageID, message.body, now, message.senderID);

    if (!window)
    {
      return {};
    }

    if (message.mentionsOther || message.replyToID)
    {
      return this.skip(message, 'addressed_elsewhere');
    }

    if (!this.decision || now < this.retryAt)
    {
      return this.skip(message, 'decision_unavailable');
    }

    if (message.body.length > ConversationWindow.maxText)
    {
      return this.skip(message, 'message_too_long');
    }

    if (!window.hasAssistant && !message.body.toLowerCase().includes(name.toLowerCase()))
    {
      return this.skip(message, 'no_assistant_context');
    }

    const input = window.snapshot(name, message.senderID, message.body, now);

    const start = this.clock();

    try
    {
      const probability = await this.decision.probabilityOfAddress(input);

      if (!Number.isFinite(probability) || probability < 0 || probability > 1)
      {
        throw new BridgeError('Invalid decision probability.');
      }

      const forward = probability >= GroupActivationPolicy.threshold;
      this.logger.info('/group/conversation/decided', {
        native_message_id: message.messageID, reason: forward ? 'addressed' : 'not_addressed',
        probability, elapsed_ms: Math.max(0, this.clock() - start),
      });

      if (!forward)
      {
        return undefined;
      }

      return { context: JSON.stringify({ history: input.history, currentSpeaker: input.latest.speaker, currentTime: input.latest.time }) };
    }
    catch (error)
    {
      this.retryAt = this.clock() + GroupActivationPolicy.cooldown;
      this.logger.failure('/group/conversation/failed', error);

      return undefined;
    }
  }

  private skip(message: NativeMessage, reason: string): undefined
  {
    this.logger.info('/group/conversation/skipped', { native_message_id: message.messageID, reason });
    return undefined;
  }

  recordReply(groupID: string, audience: GroupAudience, body: string, nativeID: string): void
  {
    this.observeAudience(groupID, audience);

    if (this.authorizesContext(groupID, audience))
    {
      const now = this.clock();
      this.history.prune(now);
      this.history.append(groupID, audience.fingerprint, nativeID, body, now);
    }
  }
}
