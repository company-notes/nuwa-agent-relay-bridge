import type { NativeMessage } from './Contracts.js';
import type { ConversationDecision } from './ConversationDecision.js';
import { ConversationWindow } from './ConversationWindow.js';
import { GroupMode, GroupPolicy, type GroupApproval, type GroupAudience } from './GroupPolicy.js';
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
  private static readonly maxGroups = 64;
  private readonly approvals = new Map<string, string>();
  private readonly windows = new Map<string, ConversationWindow>();
  private readonly logger = new Logger('group-activation');
  private retryAt = 0;

  constructor(private readonly settings?: ConversationSettings, private readonly decision?: ConversationDecision,
    private readonly clock: () => number = Date.now)
  {
    if (settings)
    {
      GroupActivationPolicy.validate(settings);

      for (const group of settings.approved_groups)
      {
        this.approvals.set(group.id, GroupPolicy.fingerprint(group.member_ids));
      }
    }
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
    const now = this.clock();

    for (const [id, window] of this.windows)
    {
      if (!window.prune(now))
      {
        this.windows.delete(id);
      }
    }
  }

  authorizesContext(groupID: string, audience?: GroupAudience): boolean
  {
    return audience !== undefined && this.approvals.get(groupID) === audience.fingerprint;
  }

  observeAudience(groupID: string, audience?: GroupAudience): void
  {
    const window = this.windows.get(groupID);

    if (window && (window.audience !== audience?.fingerprint || !this.authorizesContext(groupID, audience)))
    {
      this.windows.delete(groupID);
    }
  }

  private window(groupID: string, audience: GroupAudience): ConversationWindow | undefined
  {
    this.observeAudience(groupID, audience);
    this.prune();

    if (!this.settings || !this.decision || !this.authorizesContext(groupID, audience))
    {
      return undefined;
    }

    const window = this.windows.get(groupID) ?? new ConversationWindow(audience.fingerprint);
    this.windows.delete(groupID);
    this.windows.set(groupID, window);

    if (this.windows.size > GroupActivationPolicy.maxGroups)
    {
      this.windows.delete(this.windows.keys().next().value!);
    }

    return window;
  }

  async activate(groupID: string, audience: GroupAudience, message: NativeMessage, addressed: boolean): Promise<Activation | undefined>
  {
    const window = this.window(groupID, audience);
    const name = this.settings?.assistant_name;
    const direct = addressed || audience.memberCount === 2;

    if (!window || !this.decision || !name)
    {
      return direct ? {} : undefined;
    }

    const candidate = window.hasRecentAssistant || message.body.toLowerCase().includes(name.toLowerCase());
    const eligible = !direct && !message.mentionsOther && !message.replyToID && candidate &&
      message.body.length <= ConversationWindow.maxText && this.clock() >= this.retryAt;
    const input = eligible ? window.snapshot(name, message.senderID, message.body) : undefined;

    window.append(message.body, this.clock(), message.senderID);

    if (direct)
    {
      return {};
    }

    if (!input)
    {
      return undefined;
    }

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

      return { context: JSON.stringify({ history: input.history, currentSpeaker: input.latest.speaker }) };
    }
    catch (error)
    {
      this.retryAt = this.clock() + GroupActivationPolicy.cooldown;
      this.logger.failure('/group/conversation/failed', error);

      return undefined;
    }
  }

  recordReply(groupID: string, audience: GroupAudience, body: string): void
  {
    this.window(groupID, audience)?.append(body, this.clock());
  }
}
