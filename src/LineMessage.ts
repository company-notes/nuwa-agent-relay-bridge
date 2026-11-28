import type { TalkMessage } from '@evex-dev/linejs';

import { ConversationAddress } from './ConversationAddress.js';
import type { NativeMessage } from './Contracts.js';

export class LineMessage
{
  static normalize(message: TalkMessage, accountID: string): NativeMessage | undefined
  {
    const isGroup = message.to.type === 'GROUP';
    const isPrivate = message.to.type === 'USER' && message.to.id === accountID;

    if (message.isMyMessage || (!isGroup && !isPrivate))
    {
      return undefined;
    }

    const senderID = message.from.id;
    const content = this.content(message);
    const mentions = isGroup ? this.mentions(message, accountID) : { mentionsAccount: false, mentionsOther: false };

    return {
      messageID: message.raw.id, senderID,
      conversationID: isGroup ? ConversationAddress.group(message.to.id) : senderID,
      body: content.body, ...mentions,
      artifactLinks: content.artifactLinks, replyToID: message.getReplyTarget()?.id,
    };
  }

  private static mentions(message: TalkMessage, accountID: string): { mentionsAccount: boolean; mentionsOther: boolean }
  {
    if (message.raw.contentType !== 'NONE')
    {
      return { mentionsAccount: false, mentionsOther: false };
    }

    try
    {
      const mentions = message.getMentions();
      return {
        mentionsAccount: mentions.some(mention => mention.all === true || mention.mid === accountID),
        mentionsOther: mentions.some(mention => typeof mention.mid === 'string' && mention.mid !== accountID),
      };
    }
    catch
    {
      // Malformed metadata cannot establish an explicit addressee.
      return { mentionsAccount: false, mentionsOther: false };
    }
  }

  private static content(message: TalkMessage): { body: string; artifactLinks: string[] }
  {
    if (message.raw.contentType === 'STICKER')
    {
      const url = message.getStickerURL();
      const valid = /^https:\/\/stickershop\.line-scdn\.net\/stickershop\/v1\/sticker\/[0-9]+\/android\/sticker(?:_animation)?\.png$/.test(url);

      return { body: '[LINE sticker]', artifactLinks: valid ? [url] : [] };
    }

    if (typeof message.text === 'string' && message.text.trim())
    {
      return { body: message.text, artifactLinks: [] };
    }

    const type = String(message.raw.contentType);
    const media = ['IMAGE', 'VIDEO', 'AUDIO', 'FILE'].includes(type) ? type.toLowerCase() : 'non-text message';

    return { body: '[LINE ' + media + ' received; attachment data is not available in this release]', artifactLinks: [] };
  }
}
