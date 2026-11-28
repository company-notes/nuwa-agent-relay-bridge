import { BridgeError } from './BridgeError.js';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface, type Interface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';

import { Bridge } from './Bridge.js';
import { AccessMode, AccessPolicy } from './AccessPolicy.js';
import { GroupMode, GroupPolicy } from './GroupPolicy.js';
import { GroupSetup } from './GroupSetup.js';
import { AccessSetup } from './AccessSetup.js';
import { BridgeConfiguration, type BridgeConfig } from './BridgeConfiguration.js';
import { DeliveryStore } from './DeliveryStore.js';
import { LineBackend } from './LineBackend.js';
import { LineStorage } from './LineStorage.js';
import { Logger } from './Logger.js';
import { OAuthCredentials } from './OAuthCredentials.js';
import { PrivateJSON } from './PrivateJSON.js';
import { ProcessLock } from './ProcessLock.js';
import { RemoteRelayClient } from './RemoteRelayClient.js';

class Application
{
  private static readonly logger = new Logger('bridge');
  private readonly directory = resolve(process.env.NUWA_BRIDGE_HOME ?? join(homedir(), '.config', 'nuwa-agent-relay-bridge'));
  private readonly config = new BridgeConfiguration(new PrivateJSON(join(this.directory, 'config.json')));
  private readonly oauthFile = new PrivateJSON(join(this.directory, 'oauth.json'));
  private readonly oauth = new OAuthCredentials(this.oauthFile);
  private readonly relay = new RemoteRelayClient(this.oauth);
  private readonly storage = new LineStorage(new PrivateJSON(join(this.directory, 'line.json')));

  private initialize(): void
  {
    if (process.platform !== 'linux')
    {
      throw new BridgeError('This pilot targets a Linux host.');
    }

    process.umask(0o077);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    chmodSync(this.directory, 0o700);
  }

  private async setup(): Promise<void>
  {
    if (this.config.exists)
    {
      await this.configureAccess();
      return;
    }

    if (!this.oauthFile.exists)
    {
      await this.oauth.login();
    }

    const identity = await this.relay.ensureIdentity();
    console.log('Bridge address:', identity.canonical);
    const input = createInterface({ input: process.stdin, output: process.stdout });

    try
    {
      const address = (await input.question('Designated assistant canonical address: ')).trim();
      const recipient = await this.resolveAssistant(identity.sessionID, identity.canonical, address);

      const line = await LineBackend.connect(this.storage, true);

      try
      {
        const access = await new AccessSetup(input, () => line.listFriends()).select();
        this.config.write({
          session_id: identity.sessionID, canonical: identity.canonical, account_id: line.accountID,
          recipient_session_id: recipient.id, recipient_address: recipient.canonical, access,
          groups: GroupPolicy.disabled,
        });
        this.printStart();
      }
      finally
      {
        line.stop();
      }
    }
    finally
    {
      input.close();
    }
  }

  private async resolveAssistant(sessionID: string, canonical: string, address: string)
  {
    const recipient = await this.relay.resolve(address);

    if (sessionID === recipient.id || canonical.split('/')[0] !== recipient.canonical.split('/')[0])
    {
      throw new BridgeError('Select a different assistant in the same organization.');
    }

    return recipient;
  }

  private async configureAssistant(): Promise<void>
  {
    const config = this.config.read();

    await this.relay.verifyIdentity(config.session_id, config.canonical);

    const input = createInterface({ input: process.stdin, output: process.stdout });

    try
    {
      console.log('Current assistant:', config.recipient_address);
      const address = (await input.question('New assistant canonical address: ')).trim();
      const recipient = await this.resolveAssistant(config.session_id, config.canonical, address);

      if (recipient.id === config.recipient_session_id && recipient.canonical === config.recipient_address)
      {
        console.log('Assistant is unchanged.');
        return;
      }

      console.log('New conversations use the selected assistant. Delayed replies and quotes from former routes are withheld.');
      const confirmation = (await input.question('Switch assistant? Type yes to confirm: ')).trim().toLowerCase();

      if (confirmation !== 'yes')
      {
        console.log('Assistant is unchanged.');
        return;
      }

      const next = { ...config, recipient_session_id: recipient.id, recipient_address: recipient.canonical };
      const path = join(this.directory, 'delivery.sqlite3');
      const store = new DeliveryStore(path, this.config.binding(config));

      try
      {
        store.prepareAssistantSwitch(this.config.binding(next));
        this.config.write(next);
      }
      finally
      {
        store.close();
      }

      const switched = new DeliveryStore(path, this.config.binding(next));
      switched.close();

      console.log('Designated assistant:', next.recipient_address);
      this.printStart();
    }
    finally
    {
      input.close();
    }
  }

  private printStart(): void
  {
    const executable = process.env.NUWA_BRIDGE_EXECUTABLE ?? 'nuwa-bridge';
    console.log('Bridge setup complete. Run: ' + executable + ' start');
  }

  private async configureAccess(): Promise<void>
  {
    await this.configurePolicy(async (config, line, input) =>
    {
      console.log('Current access mode:', AccessMode[config.access.mode]);
      config.access = await new AccessSetup(input, () => line.listFriends()).select();
    });
  }

  private async configureGroups(): Promise<void>
  {
    await this.configurePolicy(async (config, line, input) =>
    {
      console.log('Current group mode:', GroupMode[(config.groups ?? GroupPolicy.disabled).mode]);
      config.groups = await new GroupSetup(input, () => line.listGroups()).select();
    });
  }

  private async configurePolicy(update: (config: BridgeConfig, line: LineBackend, input: Interface) => Promise<void>): Promise<void>
  {
    const config = this.config.read();
    const line = await LineBackend.connect(this.storage, false);
    const input = createInterface({ input: process.stdin, output: process.stdout });

    try
    {
      if (line.accountID !== config.account_id)
      {
        throw new BridgeError('LINE account differs from its configured identity.');
      }

      await update(config, line, input);
      this.config.write(config);
      this.printStart();
    }
    finally
    {
      input.close();
      line.stop();
    }
  }

  private async start(): Promise<void>
  {
    const config = this.config.read();
    const binding = this.config.binding(config);

    await this.relay.verifyIdentity(binding.sessionID, config.canonical);
    const recipient = await this.relay.resolve(binding.recipientAddress);

    if (recipient.id !== binding.recipientSessionID)
    {
      throw new BridgeError('Designated assistant identity changed.');
    }

    const line = await LineBackend.connect(this.storage, false);

    try
    {
      if (line.accountID !== binding.accountID)
      {
        throw new BridgeError('LINE account differs from its configured identity.');
      }

      const store = new DeliveryStore(join(this.directory, 'delivery.sqlite3'), binding);
      const bridge = new Bridge(binding, store, this.relay, line, new AccessPolicy(config.access, line),
        new GroupPolicy(config.groups ?? GroupPolicy.disabled, line, binding.accountID));

      let stopped = false;
      let receiveFailure: unknown;
      const stop = () => { stopped = true; line.stop(); };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);

      try
      {
        line.listen(async message => { await bridge.receive(message); }, error =>
        {
          receiveFailure = error;
          Application.logger.failure('native_receive_failed', error);

          stop();
        });
        console.log('Bridge running:', config.canonical);

        while (!stopped)
        {
          line.assertHealthy();

          try
          {
            await bridge.cycle();
          }
          catch (error)
          {
            Application.logger.failure('cycle_failed', error);
          }

          await delay(2000);
        }
      }
      finally
      {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
        stop();
        await line.drain();
        store.close();
      }

      if (receiveFailure !== undefined)
      {
        throw receiveFailure;
      }
    }
    finally
    {
      line.stop();
    }
  }

  private status(): void
  {
    const config = this.config.read();
    const store = new DeliveryStore(join(this.directory, 'delivery.sqlite3'), this.config.binding(config));

    try
    {
      console.log('Bridge address:', config.canonical);
      console.log('Designated assistant:', config.recipient_address);
      console.log('Access mode:', AccessMode[config.access.mode]);
      console.log('Group mode:', GroupMode[(config.groups ?? GroupPolicy.disabled).mode]);
      console.log('Pending inbound submissions:', store.pendingCount);
      console.log('Blocked inbound messages:', store.blocked);
      console.log('Blocked outbound replies:', store.blockedOutbound);
      console.log('Uncertain native deliveries:', store.unresolved);
    }
    finally
    {
      store.close();
    }
  }

  async run(command: string | undefined): Promise<void>
  {
    if (command === '--version')
    {
      const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
      console.log('Nuwa Agent Relay Bridge ' + manifest.version);
      return;
    }

    if (!command || command === '--help' || command === 'help')
    {
      console.log('Usage: nuwa-bridge <setup | access | groups | assistant | start | status | --version>');
      return;
    }

    this.initialize();

    if (!['setup', 'access', 'groups', 'assistant', 'start', 'status'].includes(command))
    {
      throw new BridgeError('Use setup, access, groups, assistant, start, or status.');
    }

    const lockPath = join(this.directory, 'bridge.lock');
    const lock = ProcessLock.acquire(lockPath);

    try
    {
      if (command === 'setup')
      {
        await this.setup();
      }
      else if (command === 'access')
      {
        await this.configureAccess();
      }
      else if (command === 'groups')
      {
        await this.configureGroups();
      }
      else if (command === 'assistant')
      {
        await this.configureAssistant();
      }
      else if (command === 'status')
      {
        this.status();
      }
      else
      {
        await this.start();
      }
    }
    finally
    {
      lock.close();
    }
  }
}

new Application().run(process.argv[2]).catch(error =>
{
  new Logger('cli').failure('operation_failed', error);
  process.exitCode = 1;
});
