import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { AccessMode } from '../src/AccessPolicy.js';
import { BridgeConfiguration } from '../src/BridgeConfiguration.js';
import { DeliveryStore } from '../src/DeliveryStore.js';
import { PrivateJSON } from '../src/PrivateJSON.js';

test('an existing pilot upgrade preserves identity and approval until an administrator changes access', t =>
{
  const directory = mkdtempSync(join(tmpdir(), 'bridge-upgrade-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const file = new PrivateJSON(join(directory, 'config.json'));
  file.write({ session_id: 'bridge', canonical: 'example/line/main', account_id: 'line',
    employee_id: 'approved', recipient_session_id: 'chief', recipient_address: 'example/chief/main' });
  const config = new BridgeConfiguration(file);
  const previous = config.read();

  assert.deepEqual(previous.access, { mode: AccessMode.Allowlist, allowed_user_ids: ['approved'] });

  const databasePath = join(directory, 'delivery.sqlite3');
  const database = new DatabaseSync(databasePath);
  database.exec('CREATE TABLE bridge_binding (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  database.prepare('INSERT INTO bridge_binding VALUES (1, ?)').run(
    JSON.stringify(['bridge', 'line', 'approved', 'chief', 'example/chief/main']));
  database.close();

  const store = new DeliveryStore(databasePath, config.binding(previous));
  store.close();

  config.write({ ...previous, access: { mode: AccessMode.Open, allowed_user_ids: [] } });

  assert.equal(config.read().canonical, 'example/line/main');
  assert.equal(config.read().access.mode, AccessMode.Open);

  const reopened = new DeliveryStore(databasePath, config.binding(config.read()));
  reopened.close();
});
