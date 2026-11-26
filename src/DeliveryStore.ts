import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import type { BridgeBinding, NativeMessage, RelayMessage, RelaySubmission } from './Contracts.js';

export enum DeliveryState
{
  Pending = 1,
  Complete = 2,
  Uncertain = 3,
  Blocked = 4,
}

export type InboundRecord = NativeMessage & { submissionID: string };
type ConversationRoute = { conversationID: string; threadID: string; replyMessageID: string | null };

export class DeliveryStore
{
  private readonly database: DatabaseSync;

  constructor(path: string, binding: BridgeBinding)
  {
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
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
      CREATE TABLE IF NOT EXISTS outbound (
        relay_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, state INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS inbox_checkpoint (
        id INTEGER PRIMARY KEY CHECK(id = 1), message_id TEXT NOT NULL
      );
    `);

    const value = JSON.stringify([binding.sessionID, binding.accountID, binding.employeeID,
      binding.recipientSessionID, binding.recipientAddress]);
    this.database.prepare('INSERT OR IGNORE INTO bridge_binding VALUES (1, ?)').run(value);
    const row = this.database.prepare('SELECT value FROM bridge_binding WHERE id = 1').get();

    if (row?.value !== value)
    {
      this.database.close();
      throw new Error('Stored bridge identity or access binding differs from configuration.');
    }
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

  accept(message: NativeMessage): void
  {
    this.database.prepare(`
      INSERT OR IGNORE INTO inbound
      (message_id, conversation_id, sender_id, body, reply_to_id, submission_id, state)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(message.messageID, message.conversationID, message.senderID, message.body,
      message.replyToID ?? null, randomUUID(), DeliveryState.Pending);
  }

  pending(): InboundRecord[]
  {
    return this.database.prepare(`
      SELECT message_id AS messageID, conversation_id AS conversationID, sender_id AS senderID,
             body, reply_to_id AS replyToID, submission_id AS submissionID
      FROM inbound WHERE state = ? ORDER BY rowid
    `).all(DeliveryState.Pending).map(row => ({
      messageID: String(row.messageID), conversationID: String(row.conversationID),
      senderID: String(row.senderID), body: String(row.body), submissionID: String(row.submissionID),
      ...(row.replyToID === null ? {} : { replyToID: String(row.replyToID) }),
    }));
  }

  findQuote(messageID: string, conversationID: string): ConversationRoute | undefined
  {
    return this.database.prepare(`
      SELECT conversation_id AS conversationID, thread_id AS threadID, reply_message_id AS replyMessageID
      FROM native_links WHERE native_id = ? AND conversation_id = ?
    `).get(messageID, conversationID) as ConversationRoute | undefined;
  }

  block(messageID: string): void
  {
    this.database.prepare('UPDATE inbound SET state = ? WHERE message_id = ?')
      .run(DeliveryState.Blocked, messageID);
  }

  recordSubmission(message: InboundRecord, result: RelaySubmission): void
  {
    this.transaction(() =>
    {
      this.database.prepare('INSERT OR IGNORE INTO thread_routes VALUES (?, ?)')
        .run(result.threadId, message.conversationID);
      const route = this.findThread(result.threadId);

      if (route !== message.conversationID)
      {
        throw new Error('Relay thread belongs to a different native conversation.');
      }

      this.database.prepare('INSERT INTO native_links VALUES (?, ?, ?, NULL)')
        .run(message.messageID, message.conversationID, result.threadId);
      this.database.prepare('UPDATE inbound SET state = ? WHERE message_id = ?')
        .run(DeliveryState.Complete, message.messageID);
    });
  }

  findThread(threadID: string): string | undefined
  {
    const row = this.database.prepare('SELECT conversation_id FROM thread_routes WHERE thread_id = ?').get(threadID);
    return typeof row?.conversation_id === 'string' ? row.conversation_id : undefined;
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

  close(): void
  {
    this.database.close();
  }
}
