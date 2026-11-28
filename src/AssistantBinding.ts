import type { DatabaseSync } from 'node:sqlite';

import { BridgeError } from './BridgeError.js';
import type { BridgeBinding } from './Contracts.js';

type StoredIdentity = [string, string, string, string];

export class AssistantBinding
{
  constructor(private readonly database: DatabaseSync, private readonly binding: BridgeBinding)
  {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS assistant_state (
        id INTEGER PRIMARY KEY CHECK(id = 1), generation INTEGER NOT NULL, next_binding TEXT
      );
      CREATE TABLE IF NOT EXISTS thread_assistants (
        thread_id TEXT PRIMARY KEY, generation INTEGER NOT NULL, recipient_session_id TEXT NOT NULL
      );
    `);
  }

  private static identity(binding: BridgeBinding): StoredIdentity
  {
    return [binding.sessionID, binding.accountID, binding.recipientSessionID, binding.recipientAddress];
  }

  private get state(): { generation: number; next_binding: string | null }
  {
    return this.database.prepare('SELECT generation, next_binding FROM assistant_state WHERE id = 1').get() as
      { generation: number; next_binding: string | null };
  }

  get generation(): number
  {
    return this.state.generation;
  }

  initialize(pendingCount: number, unresolved: number): void
  {
    const identity = AssistantBinding.identity(this.binding);
    const value = JSON.stringify(identity);
    this.database.prepare('INSERT OR IGNORE INTO bridge_binding VALUES (1, ?)').run(value);
    const row = this.database.prepare('SELECT value FROM bridge_binding WHERE id = 1').get();
    const saved: unknown = JSON.parse(String(row?.value));

    if (!Array.isArray(saved) || (saved.length !== 4 && saved.length !== 5))
    {
      throw new BridgeError('Stored bridge identity differs from configuration.');
    }

    const previous = saved.length === 5 ? [saved[0], saved[1], saved[3], saved[4]] : saved;
    const previousValue = JSON.stringify(previous);

    if (previous[0] !== identity[0] || previous[1] !== identity[1] ||
        (saved.length === 5 && (previousValue !== value || pendingCount)))
    {
      throw new BridgeError('Stored bridge identity differs from configuration or has pending pilot work.');
    }

    const initialized = this.database.prepare('INSERT OR IGNORE INTO assistant_state VALUES (1, 1, NULL)').run();

    if (Number(initialized.changes) === 1)
    {
      this.database.prepare(`
        INSERT INTO thread_assistants
        SELECT thread_id, 1, ? FROM thread_routes
      `).run(String(previous[2]));
    }

    if (previousValue === value)
    {
      this.database.prepare('UPDATE bridge_binding SET value = ? WHERE id = 1').run(value);
      this.database.prepare('UPDATE assistant_state SET next_binding = NULL WHERE id = 1').run();
      return;
    }

    if (this.state.next_binding !== value || pendingCount || unresolved)
    {
      throw new BridgeError('Stored bridge identity differs from configuration.');
    }

    this.database.prepare('UPDATE bridge_binding SET value = ? WHERE id = 1').run(value);
    this.database.prepare('UPDATE assistant_state SET generation = generation + 1, next_binding = NULL WHERE id = 1').run();
  }

  prepare(next: BridgeBinding, pendingCount: number, unresolved: number): void
  {
    if (next.sessionID !== this.binding.sessionID || next.accountID !== this.binding.accountID ||
        next.recipientSessionID === next.sessionID || !next.recipientSessionID || !next.recipientAddress)
    {
      throw new BridgeError('Select a different assistant for the existing bridge identity.');
    }

    if (pendingCount || unresolved)
    {
      throw new BridgeError('Reconcile pending submissions and uncertain native deliveries before switching assistants.');
    }

    this.database.prepare('UPDATE assistant_state SET next_binding = ? WHERE id = 1')
      .run(JSON.stringify(AssistantBinding.identity(next)));
  }

  recordThread(threadID: string): void
  {
    this.database.prepare('INSERT OR IGNORE INTO thread_assistants VALUES (?, ?, ?)')
      .run(threadID, this.generation, this.binding.recipientSessionID);
  }
}
