import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class PrivateJSON
{
  constructor(private readonly path: string) {}

  get exists(): boolean
  {
    return existsSync(this.path);
  }

  read<T>(): T
  {
    return JSON.parse(readFileSync(this.path, 'utf8')) as T;
  }

  write(value: unknown): void
  {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = this.path + '.' + randomUUID() + '.tmp';

    try
    {
      const fd = openSync(temporary, 'wx', 0o600);

      try
      {
        writeFileSync(fd, JSON.stringify(value, null, 2));
        fsyncSync(fd);
      }
      finally
      {
        closeSync(fd);
      }

      renameSync(temporary, this.path);
      const directory = openSync(dirname(this.path), 'r');

      try
      {
        fsyncSync(directory);
      }
      finally
      {
        closeSync(directory);
      }
    }
    finally
    {
      rmSync(temporary, { force: true });
    }
  }
}
