import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { Bridge } from '../src/Bridge.js';
import type { BridgeBinding, MessagingBackend, NativeMessage, RelayClient, RelayMessage, RelaySubmission } from '../src/Contracts.js';
import { DeliveryStore } from '../src/DeliveryStore.js';

class ControlledRelay implements RelayClient
{
  readonly submissions: { id: string; thread: string; body: string; replyTo?: string }[] = [];
  readonly messages: RelayMessage[] = [];
  failAfterAccept = false;

  async send(_to: string, body: string, id: string): Promise<RelaySubmission>
  {
    const prior = this.submissions.find(item => item.id === id);
    const thread = prior?.thread ?? 'thread-' + id;

    if (!prior)
    {
      this.submissions.push({ id, thread, body });
    }

    if (this.failAfterAccept)
    {
      this.failAfterAccept = false;
      throw new Error('Controlled lost response');
    }

    return { messageId: id, threadId: thread };
  }

  async reply(thread: string, body: string, id: string, replyTo?: string): Promise<RelaySubmission>
  {
    this.submissions.push({ id, thread, body, replyTo });
    return { messageId: id, threadId: thread };
  }

  async inbox(): Promise<RelayMessage[]>
  {
    return [...this.messages];
  }
}

class ControlledMessaging implements MessagingBackend
{
  readonly deliveries: { conversation: string; body: string; id: string }[] = [];
  failAfterSend = false;

  async send(conversation: string, body: string): Promise<string>
  {
    const id = 'line-' + (this.deliveries.length + 1);
    this.deliveries.push({ conversation, body, id });

    if (this.failAfterSend)
    {
      this.failAfterSend = false;
      throw new Error('Controlled uncertain native delivery');
    }

    return id;
  }
}

class Scenario
{
  static readonly binding: BridgeBinding = {
    accountID: 'company-line', sessionID: 'bridge-session', employeeID: 'employee',
    recipientAddress: 'example/may/main', recipientSessionID: 'assistant-session',
  };

  readonly dir = mkdtempSync(join(tmpdir(), 'nuwa-bridge-'));
  readonly relay = new ControlledRelay();
  readonly messaging = new ControlledMessaging();
  store = this.open();
  bridge = this.createBridge();

  private open(): DeliveryStore
  {
    return new DeliveryStore(join(this.dir, 'delivery.sqlite3'), Scenario.binding);
  }

  private createBridge(): Bridge
  {
    return new Bridge(Scenario.binding, this.store, this.relay, this.messaging);
  }

  restart(): void
  {
    this.store.close();
    this.store = this.open();
    this.bridge = this.createBridge();
  }

  request(id: string, body: string, quote?: string): boolean
  {
    const message: NativeMessage = {
      messageID: id, senderID: 'employee', conversationID: 'employee', body, replyToID: quote,
    };
    return this.bridge.receive(message);
  }

  answer(threadId: string, id = 'relay-answer', senderSessionID = 'assistant-session'): void
  {
    this.relay.messages.unshift({
      id, threadId, kind: 'reply', senderSessionID, recipientSessionID: 'bridge-session',
      body: 'Report ready', artifactLinks: [],
    });
  }

  close(): void
  {
    this.store.close();
    rmSync(this.dir, { recursive: true, force: true });
  }
}

test('employee receives delayed report and quotes it after restarting, while new work stays separate', async t =>
{
  const s = new Scenario();
  t.after(() => s.close());

  assert.equal(s.request('request-1', 'Prepare report'), true);
  await s.bridge.cycle();
  const thread = s.relay.submissions[0]!.thread;
  s.restart();

  s.answer(thread);
  await s.bridge.cycle();
  await s.bridge.cycle();

  assert.deepEqual(s.messaging.deliveries, [{ conversation: 'employee', body: 'Report ready', id: 'line-1' }]);

  s.request('request-2', 'Include invoices', 'line-1');
  s.request('request-3', 'Check website');
  await s.bridge.cycle();

  assert.equal(s.relay.submissions[1]!.thread, thread);
  assert.equal(s.relay.submissions[1]!.replyTo, 'relay-answer');
  assert.notEqual(s.relay.submissions[2]!.thread, thread);
});

test('lost Relay response and repeated native event preserve one submission across restart', async t =>
{
  const s = new Scenario();
  t.after(() => s.close());

  s.request('request-1', 'Prepare report');
  s.relay.failAfterAccept = true;

  await assert.rejects(s.bridge.cycle(), /lost response/);
  const id = s.relay.submissions[0]!.id;
  s.restart();

  s.request('request-1', 'Prepare report');
  await s.bridge.cycle();
  assert.equal(s.relay.submissions.length, 1);
  assert.equal(s.relay.submissions[0]!.id, id);

  s.answer(s.relay.submissions[0]!.thread);
  await s.bridge.cycle();
  assert.equal(s.messaging.deliveries.length, 1);
});

test('uncertain native send is preserved for reconciliation rather than sent twice', async t =>
{
  const s = new Scenario();
  t.after(() => s.close());

  s.request('request-1', 'Prepare report');
  await s.bridge.cycle();
  s.answer(s.relay.submissions[0]!.thread);
  s.messaging.failAfterSend = true;

  await assert.rejects(s.bridge.cycle(), /uncertain native delivery/);

  s.restart();
  await s.bridge.cycle();
  assert.equal(s.messaging.deliveries.length, 1);
  assert.equal(s.store.unresolved, 1);
});

test('unauthorized messages, unknown quotes, and unrelated Relay replies are isolated', async t =>
{
  const s = new Scenario();
  t.after(() => s.close());

  assert.equal(s.bridge.receive({ messageID: 'bad', senderID: 'stranger',
    conversationID: 'stranger', body: 'Export payroll' }), false);
  assert.equal(s.bridge.receive({ messageID: 'self', senderID: 'company-line',
    conversationID: 'employee', body: 'Loop' }), false);
  s.request('unknown', 'Continue', 'unknown-native-id');
  s.request('request-1', 'Prepare report');
  await s.bridge.cycle();

  assert.equal(s.relay.submissions.length, 1);
  s.answer(s.relay.submissions[0]!.thread, 'wrong-sender', 'stranger');
  s.answer('unrelated', 'unrelated-reply');
  await s.bridge.cycle();

  assert.equal(s.messaging.deliveries.length, 0);
});

test('bounded inbox with no known checkpoint fails visibly', async t =>
{
  const s = new Scenario();
  t.after(() => s.close());

  for (let i = 0; i < 100; i++)
  {
    s.answer('unrelated', 'message-' + i);
  }

  await assert.rejects(s.bridge.cycle(), /saturated/);
  assert.equal(s.store.checkpoint, undefined);
  assert.equal(s.messaging.deliveries.length, 0);
});

test('ordinary follow-up continues the same conversation without quoting', async t =>
{
  const s = new Scenario();
  t.after(() => s.close());

  s.request('first', 'What model are you?');
  await s.bridge.cycle();
  const thread = s.relay.submissions[0]!.thread;
  s.answer(thread);
  await s.bridge.cycle();
  s.restart();

  s.request('follow-up', 'Which version?');
  await s.bridge.cycle();
  assert.equal(s.relay.submissions[1]!.thread, thread);
});
