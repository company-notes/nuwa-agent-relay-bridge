import type { InboundRecord, SubmissionPlan } from './DeliveryStore.js';
import { DeliveryStore } from './DeliveryStore.js';

export class ConversationRouter
{
  constructor(private readonly store: DeliveryStore) {}

  plan(message: InboundRecord): SubmissionPlan | undefined
  {
    const existing = this.store.submissionPlan(message.messageID);

    if (existing)
    {
      return existing;
    }

    const newTopic = /^\/new\s+\S/i.test(message.body);
    const route = newTopic ? undefined : message.replyToID
      ? this.store.findQuote(message.replyToID, message.conversationID)
      : this.store.currentThread(message.conversationID);

    if (!newTopic && message.replyToID && !route)
    {
      return undefined;
    }

    const plan = {
      threadID: route?.threadID ?? null, replyMessageID: route?.replyMessageID ?? null,
      body: newTopic ? message.body.replace(/^\/new\s+/i, '') : message.body,
      artifactLinks: message.artifactLinks ?? [],
    };

    this.store.savePlan(message.messageID, plan);

    return plan;
  }
}
