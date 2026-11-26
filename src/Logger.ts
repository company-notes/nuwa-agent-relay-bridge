import { BridgeError } from './BridgeError.js';

export class Logger
{
  constructor(private readonly moduleName: string) {}

  failure(event: string, error: unknown): void
  {
    const errorType = error instanceof Error ? error.name : 'UnknownError';
    const detail = error instanceof BridgeError ? error.message : undefined;

    console.error(JSON.stringify({ module: this.moduleName, event, errorType, ...(detail ? { detail } : {}) }));
  }
}
