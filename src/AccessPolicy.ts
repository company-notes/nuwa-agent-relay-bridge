import { BridgeError } from './BridgeError.js';
import type { MessagingBackend } from './Contracts.js';

export enum AccessMode
{
  Open = 1,
  Friends = 2,
  Allowlist = 3,
}

export interface AccessSettings
{
  mode: AccessMode;
  allowed_user_ids: string[];
}

export class AccessPolicy
{
  private readonly allowed: Set<string>;

  constructor(readonly settings: AccessSettings, private readonly backend: MessagingBackend)
  {
    AccessPolicy.validate(settings);
    this.allowed = new Set(settings.allowed_user_ids);
  }

  static validate(settings: AccessSettings): void
  {
    if (!settings || ![AccessMode.Open, AccessMode.Friends, AccessMode.Allowlist].includes(settings.mode) ||
        !Array.isArray(settings.allowed_user_ids) || settings.allowed_user_ids.some(id => typeof id !== 'string' || !id.trim()))
    {
      throw new BridgeError('Invalid access policy.');
    }
  }

  accepts(senderID: string): boolean
  {
    return Boolean(senderID) && (this.settings.mode !== AccessMode.Allowlist || this.allowed.has(senderID));
  }

  async permits(senderID: string): Promise<boolean>
  {
    if (!this.accepts(senderID))
    {
      return false;
    }

    return this.settings.mode !== AccessMode.Friends || await this.backend.isFriend(senderID);
  }
}
