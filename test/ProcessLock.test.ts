import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ProcessLock } from '../src/ProcessLock.js';

test('after a sudden process termination the next bridge can start with its existing lock file', async t =>
{
  const directory = mkdtempSync(join(tmpdir(), 'bridge-lock-'));
  const path = join(directory, 'bridge.lock');
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  writeFileSync(path, '');

  const moduleURL = new URL('../src/ProcessLock.js', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    'import { ProcessLock } from ' + JSON.stringify(moduleURL) +
    '; const lock = ProcessLock.acquire(process.argv[1]); console.log("ready"); setInterval(() => {}, 1000);', path],
    { stdio: ['ignore', 'pipe', 'inherit'] });
  const exit = once(child, 'exit');

  try
  {
    const ready = await Promise.race([once(child.stdout!, 'data').then(([data]) => String(data)),
      exit.then(() => 'child exited')]);
    assert.match(ready, /ready/);
    assert.throws(() => ProcessLock.acquire(path), /Another bridge process/);
  }
  finally
  {
    child.kill('SIGKILL');
    await exit;
  }

  const recovered = ProcessLock.acquire(path);
  recovered.close();

  const restarted = ProcessLock.acquire(path);
  restarted.close();
});
