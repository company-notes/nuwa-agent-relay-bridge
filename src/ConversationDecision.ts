export interface ConversationTurn
{
  speaker: string;
  text: string;
}

export interface DecisionInput
{
  assistantName: string;
  history: ConversationTurn[];
  latest: ConversationTurn;
}

export interface ConversationDecision
{
  probabilityOfAddress(input: DecisionInput): Promise<number>;
}
