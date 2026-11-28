import { BridgeError } from './BridgeError.js';
import { Client } from '@evex-dev/linejs';
import { BaseClient } from '@evex-dev/linejs/base';

import type { MessagingBackend, NativeMessage } from './Contracts.js';
import { ConversationAddress } from './ConversationAddress.js';
import { LineGroupDirectory, type LINEGroup } from './LineGroupDirectory.js';
import { LineStorage } from './LineStorage.js';
import { LineContactDirectory, type LINEFriend } from './LineContactDirectory.js';
import { LineMessage } from './LineMessage.js';
import { LineLoginPrompt } from './LineLoginPrompt.js';
import { Logger } from './Logger.js';

export class LineBackend implements MessagingBackend
{
  private static readonly tokenKey = 'nuwa_bridge_auth_token';
  private static readonly logger = new Logger('line');
  private readonly controller = new AbortController();
  private pendingReceive = Promise.resolve();

  private readonly contacts: LineContactDirectory;
  private readonly groups: LineGroupDirectory;

  private constructor(private readonly client: Client, readonly accountID: string, private readonly checkSession: () => void)
  {
    this.contacts = new LineContactDirectory(client.base);
    this.groups = new LineGroupDirectory(client.base);
  }

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

  async listFriends(): Promise<LINEFriend[]>
  {
    this.assertHealthy();
    return this.contacts.list();
  }

  async isFriend(senderID: string): Promise<boolean>
  {
    this.assertHealthy();
    return this.contacts.isFriend(senderID);
  }

  async listGroups(): Promise<LINEGroup[]>
  {
    this.assertHealthy();
    return this.groups.list();
  }

  async groupMembers(groupID: string): Promise<string[] | undefined>
  {
    this.assertHealthy();
    return this.groups.members(groupID);
  }

  listen(receive: (message: NativeMessage) => Promise<void>, onError: (error: unknown) => void): void
  {
    this.client.on('message', message =>
    {
      try
      {
        const native = LineMessage.normalize(message, this.accountID);

        if (native)
        {
          this.pendingReceive = this.pendingReceive.then(async () =>
          {
            if (!this.controller.signal.aborted)
            {
              await receive(native);
            }
          }).catch(onError);
        }
      }
      catch (error)
      {
        onError(error);
      }
    });
    this.client.listen({ talk: true, square: false, signal: this.controller.signal });
  }

  async drain(): Promise<void>
  {
    await this.pendingReceive;
  }

  async send(conversationID: string, body: string): Promise<string>
  {
    this.assertHealthy();

    const message = await this.client.base.talk.sendMessage({ to: ConversationAddress.nativeID(conversationID), text: body, e2ee: true });

    return message.id;
  }

  stop(): void
  {
    this.controller.abort();
  }
}
