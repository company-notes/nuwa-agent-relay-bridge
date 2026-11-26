import { Client, type TalkMessage } from '@evex-dev/linejs';
import { BaseClient } from '@evex-dev/linejs/base';

import type { MessagingBackend, NativeMessage } from './Contracts.js';
import { LineStorage } from './LineStorage.js';

export class LineBackend implements MessagingBackend
{
  private static readonly tokenKey = 'nuwa_bridge_auth_token';
  private readonly controller = new AbortController();

  private constructor(private readonly client: Client, readonly accountID: string) {}

  static async connect(storage: LineStorage, interactive: boolean): Promise<LineBackend>
  {
    const base = new BaseClient({ device: 'IOSIPAD', storage });
    let failure: unknown;
    let pendingSave = Promise.resolve();
    base.on('update:authtoken', token =>
    {
      base.authToken = token;
      pendingSave = pendingSave.then(() => storage.set(LineBackend.tokenKey, token)).catch(error =>
      {
        failure = error;
        console.error('LINE session storage failed; administrator recovery is required.');
      });
    });

    const saved = await storage.get(LineBackend.tokenKey);

    if (typeof saved === 'string' && saved)
    {
      await base.loginProcess.login({ authToken: saved });
    }
    else
    {
      if (!interactive)
      {
        throw new Error('LINE authorization is required. Run setup.');
      }

      base.on('qrcall', url => console.log('Open the LINE login URL on your authorized device:', url));
      base.on('pincall', pin => console.log('Enter this temporary PIN in LINE:', pin));
      await base.loginProcess.login({ qr: true });
    }

    await pendingSave;

    if (failure || !base.profile?.mid)
    {
      throw new Error('LINE account initialization failed.');
    }

    const backend = new LineBackend(new Client(base), base.profile.mid);
    return backend;
  }

  private normalize(message: TalkMessage): NativeMessage | undefined
  {
    if (message.isMyMessage || message.to.type !== 'USER' || message.to.id !== this.accountID ||
        typeof message.text !== 'string' || !message.text.trim())
    {
      return undefined;
    }

    const senderID = message.from.id;
    return {
      messageID: message.raw.id, senderID, conversationID: senderID, body: message.text,
      replyToID: message.getReplyTarget()?.id,
    };
  }

  async pairEmployee(challenge: string): Promise<string>
  {
    return await new Promise<string>((resolve, reject) =>
    {
      const timer = setTimeout(() =>
      {
        this.stop();
        reject(new Error('Employee pairing timed out.'));
      }, 180_000);
      this.listen(message =>
      {
        if (message.body.trim() !== challenge)
        {
          return;
        }

        clearTimeout(timer);
        this.stop();
        resolve(message.senderID);
      }, error =>
      {
        clearTimeout(timer);
        this.stop();
        reject(error);
      });
    });
  }

  listen(receive: (message: NativeMessage) => void, onError: (error: unknown) => void): void
  {
    this.client.on('message', message =>
    {
      try
      {
        const native = this.normalize(message);

        if (native)
        {
          receive(native);
        }
      }
      catch (error)
      {
        onError(error);
      }
    });
    this.client.listen({ talk: true, square: false, signal: this.controller.signal });
  }

  async send(conversationID: string, body: string): Promise<string>
  {
    const message = await this.client.base.talk.sendMessage({ to: conversationID, text: body, e2ee: true });
    return message.id;
  }

  stop(): void
  {
    this.controller.abort();
  }
}
