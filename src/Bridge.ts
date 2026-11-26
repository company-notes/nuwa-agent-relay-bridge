import type { BridgeBinding, MessagingBackend, NativeMessage, RelayClient, RelayMessage } from './Contracts.js';
import { DeliveryStore } from './DeliveryStore.js';

export class Bridge
{
  private busy = false;

  constructor(
    private readonly binding: BridgeBinding,
    private readonly store: DeliveryStore,
    private readonly relay: RelayClient,
    private readonly backend: MessagingBackend,
  ) {}

  receive(message: NativeMessage): boolean
  {
    if (message.senderID !== this.binding.employeeID ||
        message.conversationID !== this.binding.employeeID ||
        message.senderID === this.binding.accountID)
    {
      return false;
    }

    if (!message.messageID || !message.body.trim() || message.body.length > 100_000)
    {
      throw new Error('Invalid native text message.');
    }

    this.store.accept(message);
    return true;
  }

  private async submitPending(): Promise<void>
  {
    for (const message of this.store.pending())
    {
      const quote = message.replyToID
        ? this.store.findQuote(message.replyToID, message.conversationID)
        : undefined;

      if (message.replyToID && !quote)
      {
        this.store.block(message.messageID);
        continue;
      }

      const result = quote
        ? await this.relay.reply(quote.threadID, message.body, message.submissionID, quote.replyMessageID ?? undefined)
        : await this.relay.send(this.binding.recipientAddress, message.body, message.submissionID);

      if (!result.messageId || !result.threadId || (quote && result.threadId !== quote.threadID))
      {
        throw new Error('Invalid Relay submission correlation.');
      }

      this.store.recordSubmission(message, result);
    }
  }

  private async deliver(message: RelayMessage): Promise<void>
  {
    if (message.kind !== 'reply' ||
        message.recipientSessionID !== this.binding.sessionID ||
        message.senderSessionID !== this.binding.recipientSessionID)
    {
      return;
    }

    const conversationID = this.store.findThread(message.threadId);

    if (conversationID !== this.binding.employeeID || !this.store.claim(message))
    {
      return;
    }

    const body = [message.body, ...message.artifactLinks].join('\n');
    const nativeID = await this.backend.send(conversationID, body);

    if (!nativeID)
    {
      throw new Error('Native delivery returned no message identifier.');
    }

    this.store.recordDelivery(message, conversationID, nativeID);
  }

  private async receiveInbox(): Promise<void>
  {
    const page = await this.relay.inbox();
    const previous = this.store.checkpoint;

    if (page.length >= 100 && (!previous || !page.some(message => message.id === previous)))
    {
      throw new Error('Relay inbox window is saturated without a known checkpoint.');
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
      throw new Error('A bridge cycle is already running.');
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
