import { AccessMode, AccessPolicy, type AccessSettings } from './AccessPolicy.js';
import { GroupPolicy, type GroupSettings } from './GroupPolicy.js';
import { BridgeError } from './BridgeError.js';
import type { BridgeBinding } from './Contracts.js';
import { PrivateJSON } from './PrivateJSON.js';

export interface BridgeConfig
{
  session_id: string;
  canonical: string;
  account_id: string;
  recipient_session_id: string;
  recipient_address: string;
  access: AccessSettings;
  groups?: GroupSettings;
}

export class BridgeConfiguration
{
  constructor(private readonly file: PrivateJSON) {}

  get exists(): boolean
  {
    return this.file.exists;
  }

  read(): BridgeConfig
  {
    const saved = this.file.read<BridgeConfig & { employee_id?: string }>();

    // A deployed single-user pilot retains its approved sender until an
    // administrator explicitly selects the new access policy.
    const access = saved.access ?? {
      mode: AccessMode.Allowlist,
      allowed_user_ids: saved.employee_id ? [saved.employee_id] : [],
    };
    const config: BridgeConfig = {
      session_id: saved.session_id, canonical: saved.canonical, account_id: saved.account_id,
      recipient_session_id: saved.recipient_session_id, recipient_address: saved.recipient_address,
      access, groups: saved.groups ?? GroupPolicy.disabled,
    };

    this.binding(config);
    AccessPolicy.validate(config.access);
    GroupPolicy.validate(config.groups ?? GroupPolicy.disabled);

    return config;
  }

  write(config: BridgeConfig): void
  {
    this.binding(config);
    AccessPolicy.validate(config.access);
    GroupPolicy.validate(config.groups ?? GroupPolicy.disabled);
    this.file.write(config);
  }

  binding(config: BridgeConfig): BridgeBinding
  {
    const values = [config.session_id, config.canonical, config.account_id,
      config.recipient_session_id, config.recipient_address];

    if (values.some(value => typeof value !== 'string' || !value))
    {
      throw new BridgeError('Incomplete bridge configuration.');
    }

    return {
      sessionID: config.session_id, accountID: config.account_id,
      recipientSessionID: config.recipient_session_id, recipientAddress: config.recipient_address,
    };
  }
}
