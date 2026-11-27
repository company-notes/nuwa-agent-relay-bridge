import { BridgeError } from './BridgeError.js';

export class Logger
{
  constructor(private readonly moduleName: string) {}

  info(event: string, identifiers: { native_message_id?: string; relay_message_id?: string; relay_thread_id?: string; reason?: string; member_count?: number }): void
  {
    console.log(JSON.stringify({ module: this.moduleName, event, ...identifiers }));
  }

  failure(event: string, error: unknown): void
  {
    const errorType = error instanceof Error ? error.name : 'UnknownError';
    const detail = error instanceof BridgeError ? error.message : undefined;

    console.error(JSON.stringify({ module: this.moduleName, event, errorType, ...(detail ? { detail } : {}) }));
  }
}
