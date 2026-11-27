import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';

import { RemoteRelayClient } from '../src/RemoteRelayClient.js';

type ToolCall = { id: string; method: string; params: { name: string; arguments: Record<string, unknown> } };

test('a bridge request and continuation traverse the authenticated HTTP tool contract', async t =>
{
  const calls: ToolCall[] = [];
  const credentials: string[] = [];
  const server = createServer(async (request, response) =>
  {
    let body = '';

    for await (const chunk of request)
    {
      body += chunk.toString();
    }

    const call = JSON.parse(body) as ToolCall;
    calls.push(call);
    credentials.push(request.headers.authorization ?? '');

    const value = call.params.name === 'relayInbox'
      ? [{
        id: 'incoming-1', threadId: 'thread-1', kind: 'reply', senderSessionID: 'assistant',
        recipientSessionID: 'bridge', body: 'Report ready', artifactLinks: [],
      }]
      : { messageId: 'submitted-1', threadId: 'thread-1' };
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
      jsonrpc: '2.0', id: call.id, result: { content: [{ type: 'text', text: JSON.stringify(value) }] },
    }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const client = new RemoteRelayClient({ async accessToken() { return 'controlled-token'; } },
    'http://127.0.0.1:' + address.port + '/mcp');
  const sent = await client.send('example/may/main', 'Prepare report', 'submission-1');
  const inbox = await client.inbox();
  const sticker = 'https://stickershop.line-scdn.net/stickershop/v1/sticker/123/android/sticker.png';
  await client.reply(sent.threadId, '[LINE sticker]', 'submission-2', inbox[0]!.id, [sticker]);

  assert.deepEqual(credentials, ['Bearer controlled-token', 'Bearer controlled-token', 'Bearer controlled-token']);
  assert.deepEqual(calls.map(call => call.method), ['tools/call', 'tools/call', 'tools/call']);

  assert.deepEqual(calls.map(call => call.params), [
    { name: 'sendToAgent', arguments: { to: 'example/may/main', message: 'Prepare report', submissionID: 'submission-1' } },
    { name: 'relayInbox', arguments: {} },
    { name: 'relayReplyThread', arguments: {
      threadID: 'thread-1', body: '[LINE sticker]', submissionID: 'submission-2', messageID: 'incoming-1',
      artifactLinks: [sticker],
    } },
  ]);
});
