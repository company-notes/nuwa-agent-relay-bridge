import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { Bridge } from '../src/Bridge.js';
import { GroupMode, GroupPolicy, type GroupSettings } from '../src/GroupPolicy.js';
import { ConversationAddress } from '../src/ConversationAddress.js';
import { AccessMode, AccessPolicy, type AccessSettings } from '../src/AccessPolicy.js';
import type { BridgeBinding, MessagingBackend, NativeMessage, RelayClient, RelayMessage, RelaySubmission } from '../src/Contracts.js';
import { DeliveryStore } from '../src/DeliveryStore.js';
import { GroupActivationPolicy, type ConversationSettings } from '../src/GroupActivationPolicy.js';
import type { ConversationDecision, DecisionInput } from '../src/ConversationDecision.js';

class ControlledRelay implements RelayClient
{
  readonly submissions: { id: string; thread: string; body: string; replyTo?: string; artifactLinks?: string[]; to?: string }[] = [];
  readonly messages: RelayMessage[] = [];
  failAfterAccept = false;

  async send(to: string, body: string, id: string, artifactLinks?: string[]): Promise<RelaySubmission>
  {
    const prior = this.submissions.find(item => item.id === id);
    const thread = prior?.thread ?? 'thread-' + id;

    if (!prior)
    {
      this.submissions.push({ id, thread, body, artifactLinks, to });
    }

    if (this.failAfterAccept)
    {
      this.failAfterAccept = false;
      throw new Error('Controlled lost response');
    }

    return { messageId: id, threadId: thread };
  }

  async reply(thread: string, body: string, id: string, replyTo?: string, artifactLinks?: string[]): Promise<RelaySubmission>
  {
    const prior = this.submissions.find(item => item.id === id);

    if (!prior)
    {
      this.submissions.push({ id, thread, body, replyTo, artifactLinks });
    }
    else
    {
      assert.deepEqual(prior, { id, thread, body, replyTo, artifactLinks });
    }

    if (this.failAfterAccept)
    {
      this.failAfterAccept = false;
      throw new Error('Controlled lost response');
    }

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
  readonly friends = new Set(['employee']);
  friendChecks = 0;
  readonly groups = new Map<string, string[]>();

  async groupMembers(groupID: string): Promise<string[] | undefined>
  {
    return this.groups.get(groupID);
  }

  async isFriend(senderID: string): Promise<boolean>
  {
    this.friendChecks++;
    return this.friends.has(senderID);
  }

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
    accountID: 'company-line', sessionID: 'bridge-session',
    recipientAddress: 'example/may/main', recipientSessionID: 'assistant-session',
  };

  private binding = Scenario.binding;
  readonly dir = mkdtempSync(join(tmpdir(), 'nuwa-bridge-'));
  readonly relay = new ControlledRelay();
  readonly messaging = new ControlledMessaging();
  readonly settings: AccessSettings;
  store: DeliveryStore;
  bridge: Bridge;

  constructor(settings: AccessSettings = { mode: AccessMode.Allowlist, allowed_user_ids: ['employee'] },
    private readonly groupSettings: GroupSettings = GroupPolicy.disabled,
    private conversationSettings?: ConversationSettings, private readonly decision?: ConversationDecision,
    private readonly clock?: () => number)
  {
    this.settings = settings;
    this.store = this.open();
    this.bridge = this.createBridge();
  }

  private open(): DeliveryStore
  {
    return new DeliveryStore(join(this.dir, 'delivery.sqlite3'), this.binding);
  }

  private createBridge(): Bridge
  {
    return new Bridge(this.binding, this.store, this.relay, this.messaging, new AccessPolicy(this.settings, this.messaging),
      new GroupPolicy(this.groupSettings, this.messaging, Scenario.binding.accountID),
      new GroupActivationPolicy(this.store.conversationHistory, this.groupSettings, this.conversationSettings, this.decision, this.clock));
  }

  revokeConversationApproval(): void
  {
    this.conversationSettings = undefined;
    this.restart();
  }

  restart(): void
  {
    this.store.close();
    this.store = this.open();
    this.bridge = this.createBridge();
  }

  restartFromPreviousSchema(): void
  {
    this.store.close();

    const database = new DatabaseSync(join(this.dir, 'delivery.sqlite3'));
    database.exec('DROP TABLE assistant_state; DROP TABLE thread_assistants; DROP TABLE inbound_group_audiences;');
    database.prepare('UPDATE bridge_binding SET value = ? WHERE id = 1').run(JSON.stringify([
      this.binding.sessionID, this.binding.accountID, this.binding.recipientSessionID, this.binding.recipientAddress,
    ]));
    database.close();

    this.store = this.open();
    this.bridge = this.createBridge();
  }

  switchAssistant(recipientSessionID: string, recipientAddress: string): void
  {
    const next = { ...this.binding, recipientSessionID, recipientAddress };
    this.store.prepareAssistantSwitch(next);
    this.binding = next;
    this.restart();
  }

  request(id: string, body: string, quote?: string, senderID = 'employee', artifactLinks?: string[]): Promise<boolean>
  {
    const message: NativeMessage = {
      messageID: id, senderID, conversationID: senderID, body, replyToID: quote, artifactLinks,
    };
    return this.bridge.receive(message);
  }

  groupRequest(id: string, groupID: string, senderID: string, body: string, mention = false, quote?: string): Promise<boolean>
  {
    return this.bridge.receive({
      messageID: id, conversationID: ConversationAddress.group(groupID), senderID,
      body, mentionsAccount: mention, replyToID: quote,
    });
  }

  answer(threadId: string, id = 'relay-answer', senderSessionID = 'assistant-session', body = 'Report ready'): void
  {
    this.relay.messages.unshift({
      id, threadId, kind: 'reply', senderSessionID, recipientSessionID: 'bridge-session',
      body, artifactLinks: [],
    });
  }

  dialogueCount(): number
  {
    const database = new DatabaseSync(join(this.dir, 'delivery.sqlite3'), { readOnly: true });

    try
    {
      return Number(database.prepare('SELECT COUNT(*) AS total FROM group_dialogue').get()!.total);
    }
    finally
    {
      database.close();
    }
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

  assert.equal(await s.request('request-1', 'Prepare report'), true);
  await s.bridge.cycle();
  const thread = s.relay.submissions[0]!.thread;
  s.restart();

  s.answer(thread);
  await s.bridge.cycle();
  await s.bridge.cycle();

  assert.deepEqual(s.messaging.deliveries, [{ conversation: 'employee', body: 'Report ready', id: 'line-1' }]);

  await s.request('request-2', 'Include invoices', 'line-1');
  await s.request('request-3', '/new Check website');
  await s.bridge.cycle();

  assert.equal(s.relay.submissions[1]!.thread, thread);
  assert.equal(s.relay.submissions[1]!.replyTo, 'relay-answer');
  assert.notEqual(s.relay.submissions[2]!.thread, thread);
});

test('lost Relay response and repeated native event preserve one submission across restart', async t =>
{
  const s = new Scenario();
  t.after(() => s.close());

  await s.request('request-1', 'Prepare report');
  s.relay.failAfterAccept = true;

  await assert.rejects(s.bridge.cycle(), /lost response/);
  const id = s.relay.submissions[0]!.id;
  s.restart();

  await s.request('request-1', 'Prepare report');
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

  await s.request('request-1', 'Prepare report');
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

  assert.equal(await s.bridge.receive({ messageID: 'bad', senderID: 'stranger',
    conversationID: 'stranger', body: 'Export payroll' }), false);
  assert.equal(await s.bridge.receive({ messageID: 'self', senderID: 'company-line',
    conversationID: 'employee', body: 'Loop' }), false);
  await s.request('unknown', 'Continue', 'unknown-native-id');
  await s.request('request-1', 'Prepare report');
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

  await s.request('first', 'What model are you?');
  await s.bridge.cycle();
  const thread = s.relay.submissions[0]!.thread;
  s.answer(thread);
  await s.bridge.cycle();
  s.restart();

  await s.request('follow-up', 'Which version?');
  await s.bridge.cycle();
  assert.equal(s.relay.submissions[1]!.thread, thread);
});

test('two first-time LINE senders chat normally and delayed answers return to the right people', async t =>
{
  const s = new Scenario({ mode: AccessMode.Open, allowed_user_ids: [] });
  t.after(() => s.close());

  await s.request('a1', 'First question', undefined, 'alice');
  await s.request('b1', 'Other question', undefined, 'bob');
  await s.bridge.cycle();

  const alice = s.relay.submissions[0]!.thread;
  const bob = s.relay.submissions[1]!.thread;
  assert.notEqual(alice, bob);
  s.restart();

  s.answer(bob, 'answer-b');
  s.answer(alice, 'answer-a');
  await s.bridge.cycle();

  assert.deepEqual(s.messaging.deliveries.map(item => item.conversation), ['bob', 'alice']);

  await s.request('a2', 'Follow up', undefined, 'alice');
  await s.request('b2', 'Cross-chat quote', 'line-2', 'bob');
  await s.bridge.cycle();

  assert.equal(s.relay.submissions[2]!.thread, alice);
  assert.equal(s.relay.submissions.length, 3);
  assert.equal(s.store.blocked, 1);
});

test('friend access follows the company contact directory and revoked contacts receive no delayed reply', async t =>
{
  const s = new Scenario({ mode: AccessMode.Friends, allowed_user_ids: [] });
  t.after(() => s.close());

  await s.request('stranger', 'Not a friend', undefined, 'stranger');
  await s.request('friend', 'Hello');
  await s.bridge.cycle();

  assert.equal(s.relay.submissions.length, 1);

  s.messaging.friends.delete('employee');
  s.answer(s.relay.submissions[0]!.thread);
  await s.bridge.cycle();

  assert.equal(s.messaging.deliveries.length, 0);
  assert.equal(s.store.blockedOutbound, 1);

  s.messaging.friends.add('employee');
  const checks = s.messaging.friendChecks;
  await s.bridge.cycle();

  assert.equal(s.messaging.friendChecks, checks);
  assert.equal(s.messaging.deliveries.length, 0);
});

test('sticker link remains attached to the exact conversation and retries reuse the planned submission', async t =>
{
  const s = new Scenario();
  t.after(() => s.close());

  await s.request('first', 'Hello');
  await s.bridge.cycle();
  const thread = s.relay.submissions[0]!.thread;
  const links = ['https://stickershop.line-scdn.net/stickershop/v1/sticker/1/android/sticker.png'];

  await s.request('sticker', '[LINE sticker]', undefined, 'employee', links);
  s.relay.failAfterAccept = true;
  await assert.rejects(s.bridge.cycle(), /lost response/);
  s.restart();
  await s.bridge.cycle();

  assert.equal(s.relay.submissions.length, 2);
  assert.equal(s.relay.submissions[1]!.thread, thread);
  assert.deepEqual(s.relay.submissions[1]!.artifactLinks, links);
});

test('company group members mention the assistant and quote its reply without mixing private chats or other groups', async t =>
{
  const members = ['company-line', 'employee', 'coworker'];
  const s = new Scenario(undefined, {
    mode: GroupMode.Allowlist,
    approved_groups: [{ id: 'company', member_ids: members }, { id: 'project', member_ids: members }],
  });
  t.after(() => s.close());

  s.messaging.groups.set('company', members);
  s.messaging.groups.set('project', members);
  s.messaging.groups.set('external', members);

  await s.groupRequest('ordinary', 'company', 'employee', 'Casual conversation');
  assert.equal(await s.groupRequest('external', 'external', 'employee', '@AI secret?', true), false);
  assert.equal(await s.groupRequest('loop', 'company', 'company-line', '@AI own reply', true), false);

  assert.equal(await s.groupRequest('mention', 'company', 'coworker', '@AI report', true), true);
  await s.request('private', 'Private question');
  await s.groupRequest('project-1', 'project', 'employee', '@AI project status', true);
  await s.bridge.cycle();

  const company = s.relay.submissions[0]!.thread;
  const privateThread = s.relay.submissions[1]!.thread;
  const project = s.relay.submissions[2]!.thread;

  assert.equal(new Set([company, privateThread, project]).size, 3);
  assert.match(s.relay.submissions[0]!.body, /LINE group message; sender ID: coworker/);
  s.restart();

  s.answer(company, 'group-answer');
  s.answer(privateThread, 'private-answer');
  s.answer(project, 'project-answer');
  await s.bridge.cycle();

  assert.deepEqual(s.messaging.deliveries.map(item => item.conversation),
    ['group:company', 'employee', 'group:project']);

  assert.equal(await s.groupRequest('foreign-quote', 'project', 'employee', 'Cross-group quote', false, 'line-1'), false);
  assert.equal(await s.groupRequest('own-quote', 'company', 'employee', 'Which version?', false, 'line-1'), true);
  await s.groupRequest('mention-again', 'project', 'employee', '@AI update', true);
  await s.bridge.cycle();

  assert.equal(s.relay.submissions[3]!.thread, company);
  assert.equal(s.relay.submissions[3]!.replyTo, 'group-answer');
  assert.equal(s.relay.submissions[4]!.thread, project);
});

test('group access remains disabled until configured and changed membership blocks delayed replies', async t =>
{
  const members = ['company-line', 'employee'];
  const disabled = new Scenario();
  t.after(() => disabled.close());
  disabled.messaging.groups.set('company', members);

  assert.equal(await disabled.groupRequest('ignored', 'company', 'employee', '@AI hello', true), false);

  const s = new Scenario(undefined, {
    mode: GroupMode.Allowlist, approved_groups: [{ id: 'company', member_ids: members }],
  });
  t.after(() => s.close());

  s.messaging.groups.set('company', members);
  await s.groupRequest('outsider', 'company', 'outsider', '@AI hello', true);
  await s.groupRequest('approved', 'company', 'employee', '@AI report', true);
  await s.bridge.cycle();

  assert.equal(s.relay.submissions.length, 1);
  assert.equal(s.store.blocked, 1);

  s.messaging.groups.set('company', [...members, 'new-member']);
  s.answer(s.relay.submissions[0]!.thread);
  await s.groupRequest('changed', 'company', 'employee', '@AI another report', true);
  await s.bridge.cycle();

  assert.equal(s.relay.submissions.length, 1);
  assert.equal(s.store.blocked, 2);
  assert.equal(s.messaging.deliveries.length, 0);
  assert.equal(s.store.blockedOutbound, 1);
});

test('explicitly open groups still require verified current membership', async t =>
{
  const s = new Scenario(undefined, { mode: GroupMode.Open, approved_groups: [] });
  t.after(() => s.close());

  s.messaging.groups.set('joined', ['company-line', 'employee']);
  s.messaging.groups.set('left', ['employee']);

  await s.groupRequest('left', 'left', 'employee', '@AI hello', true);
  await s.groupRequest('joined', 'joined', 'employee', '@AI hello', true);
  await s.bridge.cycle();

  assert.equal(s.relay.submissions.length, 1);
  s.messaging.groups.delete('joined');
  s.answer(s.relay.submissions[0]!.thread);
  await s.bridge.cycle();

  assert.equal(s.messaging.deliveries.length, 0);
});

test('a changed group audience starts a separate conversation and cannot receive old replies after approval', async t =>
{
  const s = new Scenario(undefined, { mode: GroupMode.Open, approved_groups: [] });
  t.after(() => s.close());

  s.messaging.groups.set('company', ['company-line', 'employee']);
  await s.groupRequest('old', 'company', 'employee', '@AI prepare report', true);
  await s.bridge.cycle();

  const oldThread = s.relay.submissions[0]!.thread;

  s.messaging.groups.set('company', ['company-line', 'employee', 'new-member']);
  await s.groupRequest('new', 'company', 'new-member', '@AI hello', true);
  s.answer(oldThread, 'old-answer');
  await s.bridge.cycle();

  const newThread = s.relay.submissions[1]!.thread;
  assert.notEqual(oldThread, newThread);
  assert.equal(s.store.blockedOutbound, 1);
  assert.equal(s.messaging.deliveries.length, 0);

  s.answer(newThread, 'new-answer');
  await s.bridge.cycle();

  assert.equal(s.messaging.deliveries.length, 1);
  assert.equal(s.messaging.deliveries[0]!.conversation, 'group:company');
});

test('an authorized two-member group chats normally and a larger group only forwards addressed messages', async t =>
{
  const s = new Scenario(undefined, { mode: GroupMode.Open, approved_groups: [] });
  t.after(() => s.close());

  s.messaging.groups.set('company', ['company-line', 'employee']);
  await s.groupRequest('first', 'company', 'employee', 'Hello');
  await s.bridge.cycle();

  assert.equal(s.relay.submissions.length, 1);
  const firstThread = s.relay.submissions[0]!.thread;
  s.answer(firstThread);
  await s.bridge.cycle();

  await s.groupRequest('follow-up', 'company', 'employee', 'What about tomorrow?');
  await s.bridge.cycle();

  assert.equal(s.relay.submissions[1]!.thread, firstThread);

  s.messaging.groups.set('company', ['company-line', 'employee', 'coworker']);
  await s.groupRequest('chatter', 'company', 'employee', 'Lunch?');
  await s.groupRequest('addressed', 'company', 'coworker', '@All report', true);
  await s.bridge.cycle();

  assert.equal(s.relay.submissions.length, 3);
  assert.notEqual(s.relay.submissions[2]!.thread, firstThread);

  s.messaging.groups.set('company', ['company-line', 'employee']);
  await s.groupRequest('small-again', 'company', 'employee', 'Continue');
  await s.bridge.cycle();

  assert.equal(s.relay.submissions.length, 4);
  assert.notEqual(s.relay.submissions[3]!.thread, s.relay.submissions[2]!.thread);
});

test('switching the assistant preserves the account, starts new conversations and protects former routes', async t =>
{
  const s = new Scenario();
  t.after(() => s.close());

  await s.request('chief-request', 'Prepare report');
  await s.bridge.cycle();
  const chiefThread = s.relay.submissions[0]!.thread;
  s.answer(chiefThread, 'chief-answer');
  await s.bridge.cycle();

  s.switchAssistant('ava-session', 'example/ava/main');
  await s.request('old-quote', 'Continue old work', 'line-1');
  await s.request('ava-request', 'Hello Ava');
  await s.bridge.cycle();

  assert.equal(s.relay.submissions.length, 2);
  const ava = s.relay.submissions[1]!;
  assert.equal(ava.to, 'example/ava/main');
  assert.notEqual(ava.thread, chiefThread);

  s.answer(chiefThread, 'former-assistant-late');
  s.answer(ava.thread, 'wrong-ava-sender');
  s.answer(ava.thread, 'ava-answer', 'ava-session');
  await s.bridge.cycle();

  assert.equal(s.messaging.deliveries.length, 2);
  assert.equal(s.messaging.deliveries[1]!.conversation, 'employee');

  await s.request('ava-follow-up', 'Tomorrow?', 'line-2');
  await s.bridge.cycle();

  assert.equal(s.relay.submissions[2]!.thread, ava.thread);

  s.switchAssistant('assistant-session', 'example/may/main');
  await s.request('switch-back', 'New request');
  await s.bridge.cycle();

  assert.equal(s.relay.submissions[3]!.to, 'example/may/main');
  assert.notEqual(s.relay.submissions[3]!.thread, chiefThread);
  assert.notEqual(s.relay.submissions[3]!.thread, ava.thread);
});

test('pending submissions prevent an assistant switch until original work is reconciled', async t =>
{
  const s = new Scenario();
  t.after(() => s.close());

  await s.request('pending', 'Prepare report');
  assert.throws(() => s.switchAssistant('ava-session', 'example/ava/main'), /pending/i);
  await s.bridge.cycle();

  assert.equal(s.relay.submissions[0]!.to, 'example/may/main');

  s.switchAssistant('ava-session', 'example/ava/main');
  await s.request('new', 'Hello Ava');
  await s.bridge.cycle();

  assert.equal(s.relay.submissions[1]!.to, 'example/ava/main');
});

test('unaddressed large-group chatter stays local even when the audience shrinks before submission', async t =>
{
  const s = new Scenario(undefined, { mode: GroupMode.Open, approved_groups: [] });
  t.after(() => s.close());

  s.messaging.groups.set('company', ['company-line', 'employee', 'coworker']);
  await s.groupRequest('ambient', 'company', 'employee', 'Lunch?');

  s.messaging.groups.set('company', ['company-line', 'employee']);
  await s.bridge.cycle();

  assert.equal(s.relay.submissions.length, 0);

  await s.groupRequest('ambient', 'company', 'employee', 'Lunch?');
  await s.groupRequest('small-chat', 'company', 'employee', 'Hello assistant');
  await s.bridge.cycle();

  assert.equal(s.relay.submissions.length, 1);
  assert.match(s.relay.submissions[0]!.body, /Hello assistant/);
});

test('a group message accepted for one audience is withheld after membership changes before submission', async t =>
{
  const s = new Scenario(undefined, { mode: GroupMode.Open, approved_groups: [] });
  t.after(() => s.close());

  s.messaging.groups.set('company', ['company-line', 'employee']);
  await s.groupRequest('addressed', 'company', 'employee', '@AI prepare report', true);

  s.messaging.groups.set('company', ['company-line', 'employee', 'new-member']);
  await s.bridge.cycle();

  assert.equal(s.relay.submissions.length, 0);
  assert.equal(s.store.blocked, 1);
});

test('an installed bridge upgrades with existing private and group threads and cuts over without losing their history', async t =>
{
  const s = new Scenario(undefined, { mode: GroupMode.Open, approved_groups: [] });
  t.after(() => s.close());

  s.messaging.groups.set('company', ['company-line', 'employee']);

  await s.request('before-private', 'Private report');
  await s.groupRequest('before-group', 'company', 'employee', '@AI group report', true);
  await s.bridge.cycle();

  const privateThread = s.relay.submissions[0]!.thread;
  const groupThread = s.relay.submissions[1]!.thread;
  s.answer(privateThread, 'private-before');
  s.answer(groupThread, 'group-before');
  await s.bridge.cycle();

  s.restartFromPreviousSchema();
  await s.request('after-private', 'Private follow-up', 'line-1');
  await s.groupRequest('after-group', 'company', 'employee', 'Group follow-up', false, 'line-2');
  await s.bridge.cycle();

  assert.equal(s.relay.submissions[2]!.thread, privateThread);
  assert.equal(s.relay.submissions[3]!.thread, groupThread);

  s.switchAssistant('ava-session', 'example/ava/main');
  await s.request('new-private', 'Private hello');
  await s.groupRequest('new-group', 'company', 'employee', 'Group hello');
  await s.bridge.cycle();

  assert.equal(s.relay.submissions[4]!.to, 'example/ava/main');
  assert.equal(s.relay.submissions[5]!.to, 'example/ava/main');
  assert.equal(new Set([privateThread, groupThread, s.relay.submissions[4]!.thread,
    s.relay.submissions[5]!.thread]).size, 4);

  s.answer(groupThread, 'former-group-reply');
  await s.bridge.cycle();

  assert.equal(s.messaging.deliveries.length, 2);
  assert.equal(s.store.blockedOutbound, 1);
});

test('uncertain native delivery prevents switching to a different assistant', async t =>
{
  const s = new Scenario();
  t.after(() => s.close());

  await s.request('request', 'Prepare report');
  await s.bridge.cycle();
  s.answer(s.relay.submissions[0]!.thread);
  s.messaging.failAfterSend = true;

  await assert.rejects(s.bridge.cycle(), /uncertain native delivery/);
  assert.throws(() => s.switchAssistant('ava-session', 'example/ava/main'), /uncertain native deliveries/);

  await s.request('follow-up', 'Still waiting');
  await s.bridge.cycle();

  assert.equal(s.relay.submissions[1]!.thread, s.relay.submissions[0]!.thread);
  assert.equal(s.store.unresolved, 1);
});

class ControlledDecision implements ConversationDecision
{
  readonly inputs: DecisionInput[] = [];
  probability = 0.95;
  fail = false;

  async probabilityOfAddress(input: DecisionInput): Promise<number>
  {
    this.inputs.push(input);

    if (this.fail)
    {
      throw new Error('Controlled model failure');
    }

    return this.probability;
  }
}

class NaturalConversationScenario extends Scenario
{
  static readonly members = ['company-line', 'employee', 'coworker'];
  readonly model: ControlledDecision;

  constructor(model = new ControlledDecision(), clock?: () => number)
  {
    super(undefined, { mode: GroupMode.Open, approved_groups: [] }, {
      assistant_name: '小媧', approved_groups: [{ id: 'company', member_ids: NaturalConversationScenario.members }],
    }, model, clock);
    this.model = model;
    this.messaging.groups.set('company', [...NaturalConversationScenario.members]);
    this.messaging.groups.set('project', [...NaturalConversationScenario.members]);
  }

  async introduce(): Promise<string>
  {
    await this.groupRequest('intro', 'company', 'employee', '@小媧 介紹自己', true);
    await this.bridge.cycle();

    const thread = this.relay.submissions[0]!.thread;
    this.answer(thread, 'intro-answer', 'assistant-session', '大家好，我是小媧，負責公司聯絡。');
    await this.bridge.cycle();
    return thread;
  }
}

test('a natural greeting follows the assistant introduction in the original group and Relay Thread', async t =>
{
  const s = new NaturalConversationScenario();
  t.after(() => s.close());

  const thread = await s.introduce();
  assert.equal(s.model.inputs.length, 0);

  await s.groupRequest('greeting', 'company', 'coworker', '妳好啊，改天一起吃飯');
  await s.bridge.cycle();

  assert.equal(s.model.inputs.length, 1);
  assert.equal(s.model.inputs[0]!.history.at(-1)?.text, '大家好，我是小媧，負責公司聯絡。');
  assert.equal(s.relay.submissions.length, 2);
  assert.equal(s.relay.submissions[1]!.thread, thread);
  assert.match(s.relay.submissions[1]!.body, /妳好啊，改天一起吃飯/);
  assert.match(s.relay.submissions[1]!.body, /大家好，我是小媧/);

  s.answer(thread, 'greeting-answer');
  await s.bridge.cycle();

  assert.equal(s.messaging.deliveries.length, 2);
  assert.equal(s.messaging.deliveries[1]!.conversation, 'group:company');
});

test('ordinary chatter, low-confidence decisions, duplicate messages and other groups do not activate the assistant', async t =>
{
  const s = new NaturalConversationScenario();
  t.after(() => s.close());

  await s.introduce();

  s.model.probability = 0.3;
  await s.groupRequest('lunch', 'company', 'coworker', 'Bear，你今天午餐吃什麼？');
  await s.groupRequest('lunch', 'company', 'coworker', 'Bear，你今天午餐吃什麼？');
  await s.groupRequest('other', 'project', 'employee', '小媧，妳好');
  await s.bridge.cycle();

  assert.equal(s.model.inputs.length, 1);
  assert.equal(s.relay.submissions.length, 1);

  s.model.probability = 0.95;
  await s.groupRequest('direct-name', 'company', 'employee', '小媧，幫我查訂單');
  await s.bridge.cycle();

  assert.equal(s.relay.submissions.length, 2);
  assert.equal(s.model.inputs[1]!.history.filter(turn => turn.text.includes('午餐')).length, 1);
});

test('an expired or changed audience loses natural conversation context and requires renewed approval', async t =>
{
  let now = 1000;
  const s = new NaturalConversationScenario(undefined, () => now);
  t.after(() => s.close());

  await s.introduce();

  now += 7 * 24 * 60 * 60 * 1000 + 1;
  await s.groupRequest('expired', 'company', 'employee', '妳好啊，改天一起吃飯');
  assert.equal(s.model.inputs.length, 0);

  await s.groupRequest('call', 'company', 'employee', '@小媧 你好', true);
  await s.bridge.cycle();
  s.answer(s.relay.submissions[0]!.thread, 'new-intro', 'assistant-session', '我是小媧');
  await s.bridge.cycle();

  s.messaging.groups.set('company', [...NaturalConversationScenario.members, 'new-member']);
  await s.groupRequest('new-roster', 'company', 'employee', '小媧，妳好');
  await s.bridge.cycle();
  assert.equal(s.model.inputs.length, 0);

  s.messaging.groups.set('company', [...NaturalConversationScenario.members]);
  await s.groupRequest('returned', 'company', 'employee', '妳好啊');
  await s.bridge.cycle();
  assert.equal(s.model.inputs.length, 0);
});

test('a model outage keeps native mentions and private chats working without forwarding uncertain chatter', async t =>
{
  const s = new NaturalConversationScenario();
  t.after(() => s.close());

  await s.introduce();

  s.model.fail = true;
  await s.groupRequest('failure', 'company', 'coworker', '妳好啊');
  await s.groupRequest('explicit', 'company', 'employee', '@All 報告', true);
  await s.request('private', 'Private question');
  await s.bridge.cycle();

  assert.equal(s.model.inputs.length, 1);
  assert.equal(s.relay.submissions.length, 3);
  assert.match(s.relay.submissions[1]!.body, /@All 報告/);
  assert.equal(s.relay.submissions[2]!.body, 'Private question');
});

test('revoked natural-conversation approval blocks a persisted contextual request before Relay submission', async t =>
{
  const s = new NaturalConversationScenario();
  t.after(() => s.close());

  await s.introduce();

  await s.groupRequest('pending-greeting', 'company', 'coworker', '妳好啊，改天一起吃飯');
  assert.equal(s.store.pendingCount, 1);

  s.revokeConversationApproval();
  assert.equal(s.dialogueCount(), 0);
  await s.bridge.cycle();

  assert.equal(s.relay.submissions.length, 1);
  assert.equal(s.store.blocked, 1);

  await s.groupRequest('explicit-after-revocation', 'company', 'employee', '@小媧 查訂單', true);
  await s.bridge.cycle();

  assert.equal(s.relay.submissions.length, 2);
});

test('a native mention of a different member is not overridden by semantic classification', async t =>
{
  const s = new NaturalConversationScenario();
  t.after(() => s.close());

  await s.introduce();

  await s.bridge.receive({ messageID: 'other-mention', conversationID: 'group:company',
    senderID: 'coworker', body: '@Bear 小媧昨天整理的報告你看了嗎？', mentionsOther: true });
  await s.bridge.cycle();

  assert.equal(s.model.inputs.length, 0);
  assert.equal(s.relay.submissions.length, 1);
});

test('a lost Relay response preserves the accepted dialogue snapshot without repeating inference after restart', async t =>
{
  const s = new NaturalConversationScenario();
  t.after(() => s.close());

  const thread = await s.introduce();

  await s.groupRequest('natural-retry', 'company', 'coworker', '改天一起吃飯');
  s.relay.failAfterAccept = true;
  await assert.rejects(s.bridge.cycle(), /lost response/);

  const submitted = s.relay.submissions[1]!;
  s.restart();
  await s.groupRequest('natural-retry', 'company', 'coworker', '改天一起吃飯');
  await s.bridge.cycle();

  assert.equal(s.model.inputs.length, 1);
  assert.equal(s.relay.submissions.length, 2);
  assert.deepEqual(s.relay.submissions[1], submitted);
  assert.equal(submitted.thread, thread);
});

test('short-term dialogue is bounded, uses local speaker labels, and does not include another group', async t =>
{
  const s = new NaturalConversationScenario();
  t.after(() => s.close());

  await s.introduce();

  s.model.probability = 0.1;

  for (let i = 0; i < 32; i++)
  {
    await s.groupRequest('ambient-' + i, 'company', 'coworker', '文字' + i + 'x'.repeat(700));
  }

  await s.groupRequest('other-group', 'project', 'employee', 'OTHER GROUP PRIVATE MARKER', true);
  await s.groupRequest('named', 'company', 'employee', '小媧，幫我看一下');
  const input = s.model.inputs.at(-1)!;

  assert.equal(input.history.length, 30);
  assert.ok(input.history.every(turn => turn.text.length <= 512));
  assert.ok(input.history.every(turn => !turn.speaker.includes('coworker')));
  assert.ok(!JSON.stringify(input).includes('OTHER GROUP PRIVATE MARKER'));
  await s.bridge.cycle();
});

test('model cooldown suppresses repeated failures and resumes natural classification', async t =>
{
  let now = 1000;
  const s = new NaturalConversationScenario(undefined, () => now);
  t.after(() => s.close());

  await s.introduce();

  s.model.fail = true;
  await s.groupRequest('first-failure', 'company', 'coworker', '妳好啊');
  await s.groupRequest('during-cooldown', 'company', 'coworker', '小媧，妳好');
  assert.equal(s.model.inputs.length, 1);

  now += 30_001;
  s.model.fail = false;
  await s.groupRequest('recovered', 'company', 'coworker', '小媧，妳好');
  await s.bridge.cycle();

  assert.equal(s.model.inputs.length, 2);
  assert.equal(s.relay.submissions.length, 2);
});

test('an employee continues the assistant conversation hours later and again the next day after restart', async t =>
{
  let now = Date.parse('2026-11-28T01:00:00Z');
  const s = new NaturalConversationScenario(undefined, () => now);
  t.after(() => s.close());

  const thread = await s.introduce();

  now += 3 * 60 * 60 * 1000;
  s.restart();

  await s.groupRequest('dinner', 'company', 'employee', '妳尾牙想不想吃飯, 要吃什麼');
  await s.bridge.cycle();

  assert.equal(s.model.inputs.length, 1);
  assert.match(s.model.inputs[0]!.history.at(-1)!.text, /大家好/);
  assert.equal(s.model.inputs[0]!.latest.time - s.model.inputs[0]!.history.at(-1)!.time, 3 * 60 * 60 * 1000);
  assert.equal(s.relay.submissions[1]!.thread, thread);

  s.answer(thread, 'dinner-answer', 'assistant-session', '謝謝邀請，大家可以一起討論。');
  await s.bridge.cycle();

  now += 24 * 60 * 60 * 1000;
  s.restart();

  await s.groupRequest('next-day', 'company', 'employee', '那我們吃火鍋好嗎？');
  await s.bridge.cycle();

  assert.equal(s.model.inputs.length, 2);
  assert.match(s.model.inputs[1]!.history.at(-1)!.text, /謝謝邀請/);
  assert.equal(s.relay.submissions[2]!.thread, thread);
});

test('intervening human conversation is available for addressee decisions without a four-turn cutoff', async t =>
{
  const s = new NaturalConversationScenario();
  t.after(() => s.close());

  const thread = await s.introduce();

  s.model.probability = 0.1;

  for (let i = 0; i < 6; i++)
  {
    await s.groupRequest('chatter-' + i, 'company', 'coworker', '同事閒聊 ' + i);
  }

  s.model.probability = 0.95;
  await s.groupRequest('continue-topic', 'company', 'employee', '妳尾牙想不想吃飯, 要吃什麼');
  await s.bridge.cycle();

  assert.equal(s.model.inputs.length, 7);
  assert.ok(s.model.inputs.at(-1)!.history.some(turn => turn.text.includes('大家好')));
  assert.equal(s.relay.submissions.length, 2);
  assert.equal(s.relay.submissions[1]!.thread, thread);
});

test('the former assistant dialogue cannot return after switching away and back', async t =>
{
  const s = new NaturalConversationScenario();
  t.after(() => s.close());

  await s.introduce();

  s.switchAssistant('ava-session', 'example/ava/main');
  assert.equal(s.dialogueCount(), 0);
  await s.groupRequest('after-switch', 'company', 'employee', '妳尾牙想吃什麼？');
  await s.bridge.cycle();

  s.switchAssistant('assistant-session', 'example/may/main');
  await s.groupRequest('after-switch-back', 'company', 'employee', '妳好啊');
  await s.bridge.cycle();

  assert.equal(s.model.inputs.length, 0);
  assert.equal(s.relay.submissions.length, 1);
});

test('expired group dialogue is removed on startup even without new incoming messages', async t =>
{
  let now = Date.parse('2026-11-28T01:00:00Z');
  const s = new NaturalConversationScenario(undefined, () => now);
  t.after(() => s.close());

  await s.introduce();

  assert.equal(s.dialogueCount(), 2);

  now += 7 * 24 * 60 * 60 * 1000 + 1;
  s.restart();

  assert.equal(s.dialogueCount(), 0);

  await s.groupRequest('after-expiry', 'company', 'employee', '妳好啊');
  await s.bridge.cycle();

  assert.equal(s.model.inputs.length, 0);
  assert.equal(s.relay.submissions.length, 1);
});

test('a company group continues natural conversation and delayed replies after members leave and join', async t =>
{
  const s = new NaturalConversationScenario();
  t.after(() => s.close());

  const thread = await s.introduce();

  s.messaging.groups.set('company', ['company-line', 'employee']);
  assert.equal(await s.groupRequest('after-leave', 'company', 'employee', '尾牙想吃什麼？'), true);
  await s.bridge.cycle();

  s.messaging.groups.set('company', ['company-line', 'employee', 'new-member']);
  s.restart();
  s.answer(thread, 'delayed-answer', 'assistant-session', '可以一起吃火鍋。');
  await s.bridge.cycle();

  assert.equal(await s.groupRequest('after-join', 'company', 'new-member', '那要去哪裡吃呢？'), true);
  await s.bridge.cycle();

  assert.equal(s.relay.submissions.length, 3);
  assert.ok(s.relay.submissions.every(item => item.thread === thread));
  assert.equal(s.messaging.deliveries.length, 2);
  assert.equal(s.model.inputs.length, 1);
  assert.match(JSON.stringify(s.model.inputs[0]!.history), /尾牙想吃什麼/);
  assert.match(JSON.stringify(s.model.inputs[0]!.history), /一起吃火鍋/);
});
