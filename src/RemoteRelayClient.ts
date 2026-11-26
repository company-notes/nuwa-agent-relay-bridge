import { BridgeError } from './BridgeError.js';
import { randomUUID } from 'node:crypto';

import type { RelayClient, RelayMessage, RelaySubmission } from './Contracts.js';

type CredentialProvider = { accessToken(): Promise<string> };
type Identity = { bound: boolean; canonical: string; sessionID: string };
type ResolvedSession = { id: string; canonical: string };
type RPCResponse = { id: string; result?: { isError?: boolean; content?: { type: string; text?: string }[] } };

export class RemoteRelayClient implements RelayClient
{
  constructor(
    private readonly credentials: CredentialProvider,
    private readonly endpoint = 'https://mcp.agent-relay.company-notes.com/mcp',
  ) {}

  private async call<T>(name: string, args: Record<string, unknown> = {}): Promise<T>
  {
    const id = randomUUID();
    const token = await this.credentials.accessToken();

    const response = await fetch(this.endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45_000),
      headers: {
        Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
    });

    if (!response.ok)
    {
      throw new BridgeError('Nuwa request failed: ' + name + ' HTTP ' + response.status);
    }

    const rpc = await response.json() as RPCResponse;
    const content = rpc.result?.content;

    if (rpc.id !== id || rpc.result?.isError || content?.length !== 1 ||
        content[0]?.type !== 'text' || typeof content[0].text !== 'string')
    {
      throw new BridgeError('Nuwa tool operation failed: ' + name);
    }

    return JSON.parse(content[0].text) as T;
  }

  async ensureIdentity(): Promise<Identity>
  {
    const identity = await this.call<Identity>('agentAddressEnsureIdentity', { agentDisplayName: 'LINE Bridge' });

    if (!identity.bound || !identity.sessionID || !identity.canonical)
    {
      throw new BridgeError('Nuwa did not establish the bridge identity.');
    }

    return identity;
  }

  async verifyIdentity(sessionID: string, canonical: string): Promise<void>
  {
    const status = await this.call<{ session: Identity | null }>('agentAddressGetStatus');

    if (!status.session?.bound || status.session.sessionID !== sessionID || status.session.canonical !== canonical)
    {
      throw new BridgeError('Nuwa identity differs from the configured bridge identity.');
    }
  }

  async resolve(address: string): Promise<ResolvedSession>
  {
    const session = await this.call<ResolvedSession>('agentAddressResolve', { address });

    if (!session.id || session.canonical !== address)
    {
      throw new BridgeError('Select a verified full Nuwa session address.');
    }

    return session;
  }

  send(to: string, body: string, submissionID: string): Promise<RelaySubmission>
  {
    return this.call('sendToAgent', { to, message: body, submissionID });
  }

  reply(threadID: string, body: string, submissionID: string, messageID?: string): Promise<RelaySubmission>
  {
    return this.call('relayReplyThread', { threadID, body, submissionID, ...(messageID ? { messageID } : {}) });
  }

  async inbox(): Promise<RelayMessage[]>
  {
    const messages = await this.call<RelayMessage[]>('relayInbox');

    if (!Array.isArray(messages) || messages.some(message => !message.id || !message.threadId ||
        typeof message.body !== 'string' || !Array.isArray(message.artifactLinks) ||
        message.artifactLinks.some(link => typeof link !== 'string')))
    {
      throw new BridgeError('Invalid Nuwa inbox response.');
    }

    return messages;
  }
}
