import type { DatabaseSync } from 'node:sqlite';

import { ConversationWindow, type WindowEntry } from './ConversationWindow.js';

export class ConversationHistory
{
  private static readonly maxGroups = 64;

  constructor(private readonly database: DatabaseSync, private readonly generation: number)
  {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS group_dialogue (
        sequence INTEGER PRIMARY KEY, group_id TEXT NOT NULL,
        generation INTEGER NOT NULL, native_id TEXT NOT NULL, sender_id TEXT,
        text TEXT NOT NULL, observed_at INTEGER NOT NULL,
        UNIQUE (generation, group_id, native_id)
      );
      CREATE INDEX IF NOT EXISTS group_dialogue_scope ON group_dialogue(generation, group_id, sequence);
      CREATE INDEX IF NOT EXISTS group_dialogue_age ON group_dialogue(observed_at);
    `);
    const columns = this.database.prepare('PRAGMA table_info(group_dialogue)').all();

    if (columns.some(column => column.name === 'audience'))
    {
      this.database.exec('ALTER TABLE group_dialogue DROP COLUMN audience');
    }

    this.database.prepare('DELETE FROM group_dialogue WHERE generation <> ?').run(this.generation);
  }

  reconcile(enabled: ReadonlySet<string>): void
  {
    const groups = this.database.prepare('SELECT DISTINCT group_id AS groupID FROM group_dialogue').all();

    for (const group of groups)
    {
      const groupID = String(group.groupID);

      if (!enabled.has(groupID))
      {
        this.database.prepare('DELETE FROM group_dialogue WHERE group_id = ?').run(groupID);
      }
    }
  }

  prune(now: number): void
  {
    this.database.prepare('DELETE FROM group_dialogue WHERE observed_at <= ?').run(now - ConversationWindow.ttl);
  }

  window(groupID: string, nativeID: string): ConversationWindow
  {
    const entries = this.database.prepare(`
      SELECT sender_id AS senderID, text, observed_at AS time FROM group_dialogue
      WHERE generation = ? AND group_id = ? AND native_id <> ?
      ORDER BY sequence DESC LIMIT ?
    `).all(this.generation, groupID, nativeID, ConversationWindow.maxTurns).reverse().map(row => ({
      text: String(row.text), time: Number(row.time),
      ...(row.senderID === null ? {} : { senderID: String(row.senderID) }),
    } satisfies WindowEntry));

    return new ConversationWindow(entries);
  }

  append(groupID: string, nativeID: string, text: string, time: number, senderID?: string): void
  {
    this.database.prepare(`
      INSERT OR IGNORE INTO group_dialogue
        (group_id, generation, native_id, sender_id, text, observed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(groupID, this.generation, nativeID, senderID ?? null, ConversationWindow.boundedText(text), time);

    this.database.prepare(`
      DELETE FROM group_dialogue WHERE group_id = ? AND sequence NOT IN
        (SELECT sequence FROM group_dialogue WHERE group_id = ? ORDER BY sequence DESC LIMIT ?)
    `).run(groupID, groupID, ConversationWindow.maxTurns);

    this.database.prepare(`
      DELETE FROM group_dialogue WHERE group_id NOT IN
        (SELECT group_id FROM group_dialogue GROUP BY group_id ORDER BY MAX(sequence) DESC LIMIT ?)
    `).run(ConversationHistory.maxGroups);
  }
}
