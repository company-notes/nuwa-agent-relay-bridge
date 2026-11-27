export class ConversationAddress
{
  private static readonly groupPrefix = 'group:';

  static group(id: string): string
  {
    return this.groupPrefix + id;
  }

  static groupID(address: string): string | undefined
  {
    return address.startsWith(this.groupPrefix) ? address.slice(this.groupPrefix.length) : undefined;
  }

  static nativeID(address: string): string
  {
    return this.groupID(address) ?? address;
  }
}
