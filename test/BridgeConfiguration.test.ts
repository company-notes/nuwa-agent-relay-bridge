import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { GroupMode, GroupPolicy } from '../src/GroupPolicy.js';
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
  assert.deepEqual(previous.groups, GroupPolicy.disabled);

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

  const groups = { mode: GroupMode.Allowlist, approved_groups: [{ id: 'company', member_ids: ['line', 'approved'] }] };
  config.write({ ...config.read(), groups });

  assert.deepEqual(config.read().groups, groups);
  assert.equal(config.read().access.mode, AccessMode.Open);

  const reopened = new DeliveryStore(databasePath, config.binding(config.read()));
  reopened.close();
});

test('interrupted assistant selection reconciles the durable switch intent with the saved configuration', t =>
{
  const directory = mkdtempSync(join(tmpdir(), 'bridge-switch-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const path = join(directory, 'delivery.sqlite3');
  const config = new BridgeConfiguration(new PrivateJSON(join(directory, 'config.json')));
  const initial = {
    session_id: 'bridge', canonical: 'example/line/main', account_id: 'line',
    recipient_session_id: 'chief', recipient_address: 'example/chief/main',
    access: { mode: AccessMode.Friends, allowed_user_ids: [] }, groups: GroupPolicy.disabled,
  };
  const next = { ...initial, recipient_session_id: 'ava', recipient_address: 'example/ava/main' };

  config.write(initial);

  let store = new DeliveryStore(path, config.binding(initial));
  store.prepareAssistantSwitch(config.binding(next));
  store.close();

  // Interruption before the config rename retains the current assistant.
  store = new DeliveryStore(path, config.binding(config.read()));
  store.close();

  assert.throws(() => new DeliveryStore(path, config.binding(next)), /identity differs/);

  store = new DeliveryStore(path, config.binding(initial));
  store.prepareAssistantSwitch(config.binding(next));
  config.write(next);
  store.close();

  // Interruption after the rename completes the recorded switch on startup.
  store = new DeliveryStore(path, config.binding(config.read()));
  store.close();
  assert.deepEqual(config.read(), next);
  assert.throws(() => new DeliveryStore(path, config.binding(initial)), /identity differs/);

  const database = new DatabaseSync(path);
  const row = database.prepare('SELECT value FROM bridge_binding WHERE id = 1').get();
  const stored = JSON.parse(String(row?.value)) as { version: number; identity: string[] };
  database.close();

  assert.equal(stored.version, 2);
  assert.deepEqual(stored.identity, ['bridge', 'line', 'ava', 'example/ava/main']);
});
