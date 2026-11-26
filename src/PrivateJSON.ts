import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
      writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, this.path);
    }
    finally
    {
      rmSync(temporary, { force: true });
    }
  }
}
