import { BridgeError } from './BridgeError.js';
import { Client, type TalkMessage } from '@evex-dev/linejs';
import { BaseClient } from '@evex-dev/linejs/base';

import type { MessagingBackend, NativeMessage } from './Contracts.js';
import { LineStorage } from './LineStorage.js';
import { LineLoginPrompt } from './LineLoginPrompt.js';
import { Logger } from './Logger.js';

export class LineBackend implements MessagingBackend
{
  private static readonly tokenKey = 'nuwa_bridge_auth_token';
  private static readonly logger = new Logger('line');
  private readonly controller = new AbortController();

  private constructor(private readonly client: Client, readonly accountID: string, private readonly checkSession: () => void) {}

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
        LineBackend.logger.failure('session_storage_failed', error);
      });
    });

    const saved = await storage.get(LineBackend.tokenKey);

    const prompt = new LineLoginPrompt();

    if (!(typeof saved === 'string' && saved) && !interactive)
    {
      throw new BridgeError('LINE authorization is required. Run setup.');
    }

    try
    {
      if (typeof saved === 'string' && saved)
      {
        prompt.resume();
        await base.loginProcess.login({ authToken: saved });
      }
      else
      {
        base.on('qrcall', url => prompt.qr(url));
        base.on('pincall', pin => prompt.pin(pin));
        await base.loginProcess.login({ qr: true });
      }
    }
    catch (error)
    {
      throw prompt.failure(error);
    }

    await pendingSave;

    if (failure || !base.profile?.mid)
    {
      throw new BridgeError('LINE account initialization failed.');
    }

    return new LineBackend(new Client(base), base.profile.mid, () =>
    {
      if (failure)
      {
        throw new BridgeError('LINE session storage failed; administrator recovery is required.');
      }
    });
  }

  assertHealthy(): void
  {
    this.checkSession();
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
        reject(new BridgeError('Employee pairing timed out.'));
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
    this.assertHealthy();

    const message = await this.client.base.talk.sendMessage({ to: conversationID, text: body, e2ee: true });

    return message.id;
  }

  stop(): void
  {
    this.controller.abort();
  }
}
