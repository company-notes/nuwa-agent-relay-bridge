export interface NativeMessage
{
  messageID: string;
  conversationID: string;
  senderID: string;
  body: string;
  replyToID?: string;
  mentionsAccount?: boolean;
  artifactLinks?: string[];
}

export interface BridgeBinding
{
  sessionID: string;
  accountID: string;
  recipientSessionID: string;
  recipientAddress: string;
}

export interface RelayMessage
{
  id: string;
  threadId: string;
  kind: string;
  senderSessionID: string;
  recipientSessionID: string;
  body: string;
  artifactLinks: string[];
}

export interface RelaySubmission
{
  messageId: string;
  threadId: string;
}

export interface RelayClient
{
  send(to: string, body: string, submissionID: string, artifactLinks?: string[]): Promise<RelaySubmission>;
  reply(threadID: string, body: string, submissionID: string, messageID?: string, artifactLinks?: string[]): Promise<RelaySubmission>;
  inbox(): Promise<RelayMessage[]>;
}

export interface MessagingBackend
{
  send(conversationID: string, body: string): Promise<string>;
  isFriend(senderID: string): Promise<boolean>;
  groupMembers(groupID: string): Promise<string[] | undefined>;
}
