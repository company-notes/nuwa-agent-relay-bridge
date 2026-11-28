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

  private static serialize(binding: BridgeBinding): string
  {
    return JSON.stringify({ version: 2, identity: AssistantBinding.identity(binding) });
  }

  private static decode(value: string): { identity: StoredIdentity; singleUser: boolean }
  {
    const saved: unknown = JSON.parse(value);
    const singleUser = Array.isArray(saved) && saved.length === 5;
    const identity: unknown = Array.isArray(saved)
      ? (singleUser ? [saved[0], saved[1], saved[3], saved[4]] : saved)
      : saved && typeof saved === 'object' && 'version' in saved && saved.version === 2 && 'identity' in saved
        ? saved.identity : undefined;

    if (!Array.isArray(identity) || identity.length !== 4 ||
        identity.some(item => typeof item !== 'string' || !item))
    {
      throw new BridgeError('Stored bridge identity differs from configuration.');
    }

    return { identity: identity as StoredIdentity, singleUser };
  }

  private get state(): { generation: number; nextBinding: string | null }
  {
    return this.database.prepare('SELECT generation, next_binding AS nextBinding FROM assistant_state WHERE id = 1').get() as
      { generation: number; nextBinding: string | null };
  }

  get generation(): number
  {
    return this.state.generation;
  }

  initialize(pendingCount: number, unresolved: number): void
  {
    const identity = AssistantBinding.identity(this.binding);
    const value = AssistantBinding.serialize(this.binding);

    this.database.prepare('INSERT OR IGNORE INTO bridge_binding VALUES (1, ?)').run(value);
    const row = this.database.prepare('SELECT value FROM bridge_binding WHERE id = 1').get();

    const saved = AssistantBinding.decode(String(row?.value));
    const previous = saved.identity;
    const sameIdentity = JSON.stringify(previous) === JSON.stringify(identity);

    if (previous[0] !== identity[0] || previous[1] !== identity[1] ||
        (saved.singleUser && (!sameIdentity || pendingCount)))
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

    if (sameIdentity)
    {
      this.database.prepare('UPDATE bridge_binding SET value = ? WHERE id = 1').run(value);
      this.database.prepare('UPDATE assistant_state SET next_binding = NULL WHERE id = 1').run();
      return;
    }

    if (this.state.nextBinding !== value || pendingCount || unresolved)
    {
      throw new BridgeError('Stored bridge identity differs from configuration.');
    }

    this.database.prepare('UPDATE bridge_binding SET value = ? WHERE id = 1').run(value);
    this.database.prepare('UPDATE assistant_state SET generation = generation + 1, next_binding = NULL WHERE id = 1').run();
  }

  prepare(next: BridgeBinding, pendingCount: number, unresolved: number): void
  {
    if (next.sessionID !== this.binding.sessionID || next.accountID !== this.binding.accountID ||
        next.recipientSessionID === next.sessionID || !next.recipientSessionID || !next.recipientAddress ||
        next.recipientAddress.split('/')[0] !== this.binding.recipientAddress.split('/')[0])
    {
      throw new BridgeError('Select a different assistant for the existing bridge identity.');
    }

    if (pendingCount || unresolved)
    {
      throw new BridgeError('Reconcile pending submissions and uncertain native deliveries before switching assistants.');
    }

    this.database.prepare('UPDATE assistant_state SET next_binding = ? WHERE id = 1')
      .run(AssistantBinding.serialize(next));
  }

  recordThread(threadID: string): void
  {
    this.database.prepare('INSERT OR IGNORE INTO thread_assistants VALUES (?, ?, ?)')
      .run(threadID, this.generation, this.binding.recipientSessionID);
  }
}
