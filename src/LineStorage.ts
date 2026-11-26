import { BaseStorage, type Storage } from '@evex-dev/linejs/storage';

import { PrivateJSON } from './PrivateJSON.js';

export class LineStorage extends BaseStorage
{
  constructor(private readonly file: PrivateJSON)
  {
    super();
  }

  private read(): Record<string, Storage['Value']>
  {
    return this.file.exists ? this.file.read() : {};
  }

  async get(key: string): Promise<Storage['Value'] | undefined>
  {
    const data = this.read();
    return Object.hasOwn(data, key) ? data[key] : undefined;
  }

  async set(key: string, value: Storage['Value']): Promise<void>
  {
    this.file.write({ ...this.read(), [key]: value });
  }

  async delete(key: string): Promise<void>
  {
    const data = this.read();
    delete data[key];
    this.file.write(data);
  }

  async clear(): Promise<void>
  {
    this.file.write({});
  }

  async migrate(storage: BaseStorage): Promise<void>
  {
    for (const [key, value] of Object.entries(this.read()))
    {
      await storage.set(key, value);
    }
  }
}
