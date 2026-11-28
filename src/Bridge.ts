import { BridgeError } from './BridgeError.js';
import type { BridgeBinding, MessagingBackend, NativeMessage, RelayClient, RelayMessage } from './Contracts.js';
import { DeliveryStore } from './DeliveryStore.js';
import { AccessPolicy } from './AccessPolicy.js';
import { ConversationRouter } from './ConversationRouter.js';
import { ConversationAddress } from './ConversationAddress.js';
import { GroupPolicy } from './GroupPolicy.js';
import { Logger } from './Logger.js';

export class Bridge
{
  private busy = false;
  private readonly router: ConversationRouter;
  private readonly logger = new Logger('bridge');

  constructor(
    private readonly binding: BridgeBinding,
    private readonly store: DeliveryStore,
    private readonly relay: RelayClient,
    private readonly backend: MessagingBackend,
    private readonly policy: AccessPolicy,
    private readonly groupPolicy = new GroupPolicy(GroupPolicy.disabled, backend, binding.accountID),
  )
  {
    this.router = new ConversationRouter(store);
  }

  receive(message: NativeMessage): boolean
  {
    if (!message.senderID || message.senderID === this.binding.accountID)
    {
      return false;
    }

    const groupID = ConversationAddress.groupID(message.conversationID);
    let groupAddressed: boolean | undefined;

    if (groupID !== undefined)
    {
      if (!this.groupPolicy.accepts(groupID))
      {
        return false;
      }

      const quote = message.replyToID ? this.store.findQuote(message.replyToID, message.conversationID) : undefined;
      const quotesAssistant = Boolean(quote?.replyMessageID);

      groupAddressed = Boolean(message.mentionsAccount || quotesAssistant);

      if (message.replyToID && !quote)
      {
        if (!groupAddressed)
        {
          return false;
        }

        message = { ...message, replyToID: undefined };
      }
    }
    else if (message.senderID !== message.conversationID || !this.policy.accepts(message.senderID))
    {
      return false;
    }

    if (!message.messageID || !message.body.trim() || message.body.length > 100_000)
    {
      throw new BridgeError('Invalid native text message.');
    }

    if (this.store.accept(message, groupAddressed))
    {
      this.logger.info('/native/message/received', { native_message_id: message.messageID });
    }

    return true;
  }

  private async submitPending(): Promise<void>
  {
    for (const message of this.store.pending())
    {
      const groupID = ConversationAddress.groupID(message.conversationID);
      const audience = groupID === undefined ? undefined : await this.groupPolicy.audience(groupID, message.senderID);
      const permitted = groupID === undefined ? await this.policy.permits(message.senderID) : audience !== undefined;

      if (!permitted)
      {
        this.store.block(message.messageID);
        this.logger.info('/native/message/blocked', { native_message_id: message.messageID });
        continue;
      }

      if (audience && audience.memberCount !== 2 && !message.groupAddressed)
      {
        this.store.ignore(message.messageID);
        continue;
      }

      const plan = this.router.plan(message, audience?.fingerprint);

      if (!plan)
      {
        this.store.block(message.messageID);
        this.logger.info('/native/quote/blocked', { native_message_id: message.messageID });
        continue;
      }

      const result = plan.threadID
        ? await this.relay.reply(plan.threadID, plan.body, message.submissionID,
          plan.replyMessageID ?? undefined, plan.artifactLinks)
        : await this.relay.send(this.binding.recipientAddress, plan.body, message.submissionID, plan.artifactLinks);

      if (!result.messageId || !result.threadId || (plan.threadID && result.threadId !== plan.threadID))
      {
        throw new BridgeError('Invalid Relay submission correlation.');
      }

      this.store.recordSubmission(message, result, plan.audience);
      this.logger.info('/relay/message/submitted', {
        native_message_id: message.messageID, relay_message_id: result.messageId, relay_thread_id: result.threadId,
      });
    }
  }

  private async deliver(message: RelayMessage): Promise<void>
  {
    if (message.kind !== 'reply' || message.recipientSessionID !== this.binding.sessionID)
    {
      return;
    }

    const route = this.store.threadRoute(message.threadId);

    if (!route || route.recipientSessionID !== message.senderSessionID || this.store.hasOutbound(message.id))
    {
      return;
    }

    if (!route.active || route.recipientSessionID !== this.binding.recipientSessionID)
    {
      this.store.blockOutbound(message);
      this.logger.info('/native/reply/blocked', {
        relay_message_id: message.id, relay_thread_id: message.threadId, reason: 'former_assistant',
      });
      return;
    }

    const conversationID = route.conversationID;
    const groupID = ConversationAddress.groupID(conversationID);
    const audience = groupID === undefined ? undefined : await this.groupPolicy.audience(groupID);
    const permitted = groupID === undefined
      ? await this.policy.permits(conversationID)
      : audience !== undefined && audience.fingerprint === this.store.threadAudience(message.threadId);

    if (!permitted)
    {
      this.store.blockOutbound(message);
      this.logger.info('/native/reply/blocked', { relay_message_id: message.id, relay_thread_id: message.threadId });
      return;
    }

    if (!this.store.claim(message))
    {
      return;
    }

    const body = [message.body, ...message.artifactLinks].join('\n');
    const nativeID = await this.backend.send(conversationID, body);

    if (!nativeID)
    {
      throw new BridgeError('Native delivery returned no message identifier.');
    }

    this.store.recordDelivery(message, conversationID, nativeID);
    this.logger.info('/native/message/delivered', {
      native_message_id: nativeID, relay_message_id: message.id, relay_thread_id: message.threadId,
    });
  }

  private async receiveInbox(): Promise<void>
  {
    const page = await this.relay.inbox();
    const previous = this.store.checkpoint;

    if (page.length >= 100 && (!previous || !page.some(message => message.id === previous)))
    {
      throw new BridgeError('Relay inbox window is saturated without a known checkpoint.');
    }

    for (const message of [...page].reverse())
    {
      await this.deliver(message);
    }

    if (page[0])
    {
      this.store.saveCheckpoint(page[0].id);
    }
  }

  async cycle(): Promise<void>
  {
    if (this.busy)
    {
      throw new BridgeError('A bridge cycle is already running.');
    }

    this.busy = true;

    try
    {
      await this.submitPending();
      await this.receiveInbox();
    }
    finally
    {
      this.busy = false;
    }
  }
}
