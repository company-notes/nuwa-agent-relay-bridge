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
    const mentionsAccount = isGroup && this.mentionsAccount(message, accountID);

    return {
      messageID: message.raw.id, senderID,
      conversationID: isGroup ? ConversationAddress.group(message.to.id) : senderID,
      body: content.body, mentionsAccount,
      artifactLinks: content.artifactLinks, replyToID: message.getReplyTarget()?.id,
    };
  }

  private static mentionsAccount(message: TalkMessage, accountID: string): boolean
  {
    if (message.raw.contentType !== 'NONE')
    {
      return false;
    }

    try
    {
      return message.getMentions().some(mention => mention.all === true || mention.mid === accountID);
    }
    catch
    {
      // Malformed mention metadata cannot activate a group message.
      return false;
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
