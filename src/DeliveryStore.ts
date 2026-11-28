import { BridgeError } from './BridgeError.js';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import type { BridgeBinding, NativeMessage, RelayMessage, RelaySubmission } from './Contracts.js';
import { AssistantBinding } from './AssistantBinding.js';

export enum DeliveryState
{
  Pending = 1,
  Complete = 2,
  Uncertain = 3,
  Blocked = 4,
  Ignored = 5,
}

export type InboundRecord = NativeMessage & { submissionID: string; receivedAudience?: string };
export type ConversationRoute = { conversationID: string; threadID: string; replyMessageID: string | null };

export interface SubmissionPlan
{
  threadID: string | null;
  replyMessageID: string | null;
  body: string;
  artifactLinks: string[];
  audience?: string;
}

export class DeliveryStore
{
  private readonly database: DatabaseSync;
  private readonly assistant: AssistantBinding;

  constructor(path: string, binding: BridgeBinding)
  {
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS bridge_binding (
        id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS inbound (
        message_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender_id TEXT NOT NULL,
        body TEXT NOT NULL, reply_to_id TEXT, submission_id TEXT NOT NULL UNIQUE, state INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS native_links (
        native_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
        thread_id TEXT NOT NULL, reply_message_id TEXT
      );
      CREATE TABLE IF NOT EXISTS thread_routes (
        thread_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS group_thread_audiences (
        thread_id TEXT PRIMARY KEY, audience TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outbound (
        relay_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, state INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS inbound_artifacts (
        message_id TEXT PRIMARY KEY, links TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS inbound_group_audiences (
        message_id TEXT PRIMARY KEY, audience TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS submission_plans (
        message_id TEXT PRIMARY KEY, plan TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS inbox_checkpoint (
        id INTEGER PRIMARY KEY CHECK(id = 1), message_id TEXT NOT NULL
      );
    `);

    try
    {
      this.assistant = new AssistantBinding(this.database, binding);
      this.transaction(() => this.assistant.initialize(this.pendingCount, this.unresolved));
    }
    catch (error)
    {
      this.database.close();
      throw error;
    }
  }

  prepareAssistantSwitch(next: BridgeBinding): void
  {
    this.transaction(() => this.assistant.prepare(next, this.pendingCount, this.unresolved));
  }

  private transaction(action: () => void): void
  {
    this.database.exec('BEGIN IMMEDIATE');

    try
    {
      action();
      this.database.exec('COMMIT');
    }
    catch (error)
    {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  accept(message: NativeMessage, receivedAudience?: string): boolean
  {
    return this.recordInbound(message, DeliveryState.Pending, receivedAudience);
  }

  private recordInbound(message: NativeMessage, state: DeliveryState, receivedAudience?: string): boolean
  {
    let accepted = false;

    this.transaction(() =>
    {
      const result = this.database.prepare(`
        INSERT OR IGNORE INTO inbound
        (message_id, conversation_id, sender_id, body, reply_to_id, submission_id, state)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(message.messageID, message.conversationID, message.senderID, message.body,
        message.replyToID ?? null, randomUUID(), state);

      accepted = Number(result.changes) === 1;

      if (accepted && receivedAudience !== undefined)
      {
        this.database.prepare('INSERT INTO inbound_group_audiences VALUES (?, ?)')
          .run(message.messageID, receivedAudience);
      }

      if (accepted && message.artifactLinks?.length)
      {
        this.database.prepare('INSERT INTO inbound_artifacts VALUES (?, ?)')
          .run(message.messageID, JSON.stringify(message.artifactLinks));
      }
    });

    return accepted;
  }

  pending(): InboundRecord[]
  {
    return this.database.prepare(`
      SELECT i.message_id AS messageID, i.conversation_id AS conversationID, i.sender_id AS senderID,
             i.body, i.reply_to_id AS replyToID, i.submission_id AS submissionID, a.links,
             g.audience AS receivedAudience
      FROM inbound i LEFT JOIN inbound_artifacts a ON a.message_id = i.message_id
      LEFT JOIN inbound_group_audiences g ON g.message_id = i.message_id
      WHERE i.state = ? ORDER BY i.rowid
    `).all(DeliveryState.Pending).map(row => ({
      messageID: String(row.messageID), conversationID: String(row.conversationID),
      senderID: String(row.senderID), body: String(row.body), submissionID: String(row.submissionID),
      ...(row.receivedAudience === null ? {} : { receivedAudience: String(row.receivedAudience) }),
      artifactLinks: row.links === null ? [] : JSON.parse(String(row.links)) as string[],
      ...(row.replyToID === null ? {} : { replyToID: String(row.replyToID) }),
    }));
  }

  currentThread(conversationID: string): ConversationRoute | undefined
  {
    return this.database.prepare(`
      SELECT l.conversation_id AS conversationID, l.thread_id AS threadID, NULL AS replyMessageID
      FROM inbound i JOIN native_links l ON l.native_id = i.message_id
      JOIN thread_assistants a ON a.thread_id = l.thread_id
      WHERE i.conversation_id = ? AND i.state = ? AND a.generation = ? ORDER BY i.rowid DESC LIMIT 1
    `).get(conversationID, DeliveryState.Complete, this.assistant.generation) as ConversationRoute | undefined;
  }

  submissionPlan(messageID: string): SubmissionPlan | undefined
  {
    const row = this.database.prepare('SELECT plan FROM submission_plans WHERE message_id = ?').get(messageID);

    return typeof row?.plan === 'string' ? JSON.parse(row.plan) as SubmissionPlan : undefined;
  }

  savePlan(messageID: string, plan: SubmissionPlan): void
  {
    this.database.prepare('INSERT INTO submission_plans VALUES (?, ?)').run(messageID, JSON.stringify(plan));
  }

  findQuote(messageID: string, conversationID: string): ConversationRoute | undefined
  {
    return this.database.prepare(`
      SELECT l.conversation_id AS conversationID, l.thread_id AS threadID, l.reply_message_id AS replyMessageID
      FROM native_links l JOIN thread_assistants a ON a.thread_id = l.thread_id
      WHERE l.native_id = ? AND l.conversation_id = ? AND a.generation = ?
    `).get(messageID, conversationID, this.assistant.generation) as ConversationRoute | undefined;
  }

  block(messageID: string): void
  {
    this.database.prepare('UPDATE inbound SET state = ? WHERE message_id = ?')
      .run(DeliveryState.Blocked, messageID);
  }

  ignore(message: NativeMessage): void
  {
    this.recordDiscarded(message, DeliveryState.Ignored);
  }

  reject(message: NativeMessage): void
  {
    this.recordDiscarded(message, DeliveryState.Blocked);
  }

  private recordDiscarded(message: NativeMessage, state: DeliveryState): void
  {
    this.recordInbound({ ...message, body: '', replyToID: undefined, artifactLinks: [] }, state);
  }

  recordSubmission(message: InboundRecord, result: RelaySubmission, audience?: string): void
  {
    this.transaction(() =>
    {
      this.database.prepare('INSERT OR IGNORE INTO thread_routes VALUES (?, ?)')
        .run(result.threadId, message.conversationID);
      this.assistant.recordThread(result.threadId);

      const route = this.findThread(result.threadId);

      if (route !== message.conversationID)
      {
        throw new BridgeError('Relay thread belongs to a different native conversation.');
      }

      if (audience !== undefined)
      {
        this.database.prepare('INSERT OR IGNORE INTO group_thread_audiences VALUES (?, ?)')
          .run(result.threadId, audience);

        if (this.threadAudience(result.threadId) !== audience)
        {
          throw new BridgeError('Relay thread belongs to a different group audience.');
        }
      }

      this.database.prepare('INSERT INTO native_links VALUES (?, ?, ?, NULL)')
        .run(message.messageID, message.conversationID, result.threadId);
      this.database.prepare('UPDATE inbound SET state = ? WHERE message_id = ?')
        .run(DeliveryState.Complete, message.messageID);
    });
  }

  findThread(threadID: string): string | undefined
  {
    const route = this.threadRoute(threadID);
    return route?.active ? route.conversationID : undefined;
  }

  threadRoute(threadID: string): { conversationID: string; recipientSessionID: string; active: boolean } | undefined
  {
    const row = this.database.prepare(`
      SELECT r.conversation_id AS conversationID, a.recipient_session_id AS recipientSessionID,
             a.generation = ? AS active
      FROM thread_routes r JOIN thread_assistants a ON a.thread_id = r.thread_id WHERE r.thread_id = ?
    `).get(this.assistant.generation, threadID);

    return row ? { conversationID: String(row.conversationID), recipientSessionID: String(row.recipientSessionID),
      active: Number(row.active) === 1 } : undefined;
  }

  threadAudience(threadID: string): string | undefined
  {
    const row = this.database.prepare('SELECT audience FROM group_thread_audiences WHERE thread_id = ?').get(threadID);

    return typeof row?.audience === 'string' ? row.audience : undefined;
  }

  hasOutbound(messageID: string): boolean
  {
    return this.database.prepare('SELECT 1 FROM outbound WHERE relay_id = ?').get(messageID) !== undefined;
  }

  blockOutbound(message: RelayMessage): void
  {
    this.database.prepare('INSERT OR IGNORE INTO outbound VALUES (?, ?, ?)')
      .run(message.id, message.threadId, DeliveryState.Blocked);
  }

  claim(message: RelayMessage): boolean
  {
    const result = this.database.prepare('INSERT OR IGNORE INTO outbound VALUES (?, ?, ?)')
      .run(message.id, message.threadId, DeliveryState.Uncertain);
    return Number(result.changes) === 1;
  }

  recordDelivery(message: RelayMessage, conversationID: string, nativeID: string): void
  {
    this.transaction(() =>
    {
      this.database.prepare('INSERT INTO native_links VALUES (?, ?, ?, ?)')
        .run(nativeID, conversationID, message.threadId, message.id);
      this.database.prepare('UPDATE outbound SET state = ? WHERE relay_id = ?')
        .run(DeliveryState.Complete, message.id);
    });
  }

  get checkpoint(): string | undefined
  {
    const row = this.database.prepare('SELECT message_id FROM inbox_checkpoint WHERE id = 1').get();
    return typeof row?.message_id === 'string' ? row.message_id : undefined;
  }

  saveCheckpoint(messageID: string): void
  {
    this.database.prepare('INSERT OR REPLACE INTO inbox_checkpoint VALUES (1, ?)').run(messageID);
  }

  get unresolved(): number
  {
    const row = this.database.prepare('SELECT COUNT(*) AS total FROM outbound WHERE state = ?')
      .get(DeliveryState.Uncertain);
    return Number(row?.total);
  }

  get blocked(): number
  {
    const row = this.database.prepare('SELECT COUNT(*) AS total FROM inbound WHERE state = ?')
      .get(DeliveryState.Blocked);
    return Number(row?.total);
  }

  get blockedOutbound(): number
  {
    const row = this.database.prepare('SELECT COUNT(*) AS total FROM outbound WHERE state = ?')
      .get(DeliveryState.Blocked);
    return Number(row?.total);
  }

  get pendingCount(): number
  {
    const row = this.database.prepare('SELECT COUNT(*) AS total FROM inbound WHERE state = ?')
      .get(DeliveryState.Pending);
    return Number(row?.total);
  }

  close(): void
  {
    this.database.close();
  }
}
