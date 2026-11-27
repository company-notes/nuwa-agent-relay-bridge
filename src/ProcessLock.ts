import { spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';

import { BridgeError } from './BridgeError.js';

export class ProcessLock
{
  private constructor(private readonly fd: number) {}

  static acquire(path: string): ProcessLock
  {
    const fd = openSync(path, 'a', 0o600);

    try
    {
      // flock locks the inherited open file description. The parent retains
      // that description until close or process exit, including SIGKILL.
      const result = spawnSync('flock', ['-n', '-E', '73', '3'], {
        stdio: ['ignore', 'ignore', 'ignore', fd],
      });

      if (result.error)
      {
        throw new BridgeError('Linux flock is required for crash-safe process locking (util-linux).');
      }

      if (result.status === 73)
      {
        throw new BridgeError('Another bridge process is running for this data directory.');
      }

      if (result.status !== 0)
      {
        throw new BridgeError('Unable to acquire the bridge process lock.');
      }

      return new ProcessLock(fd);
    }
    catch (error)
    {
      closeSync(fd);
      throw error;
    }
  }

  close(): void
  {
    closeSync(this.fd);
  }
}
