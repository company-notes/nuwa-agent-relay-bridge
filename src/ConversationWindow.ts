import type { ConversationTurn, DecisionInput } from './ConversationDecision.js';

export interface WindowEntry
{
  senderID?: string;
  text: string;
  time: number;
}

export class ConversationWindow
{
  static readonly ttl = 7 * 24 * 60 * 60 * 1000;
  static readonly maxTurns = 30;
  static readonly maxText = 500;

  constructor(private readonly entries: WindowEntry[]) {}

  static boundedText(text: string): string
  {
    return text.length <= ConversationWindow.maxText
      ? text : text.slice(0, ConversationWindow.maxText) + ' [truncated]';
  }

  snapshot(assistantName: string, senderID: string, text: string, time: number): DecisionInput
  {
    const speakers = new Map<string, string>();
    const label = (id?: string): string =>
    {
      if (id === undefined)
      {
        return 'ASSISTANT (' + assistantName + ')';
      }

      if (!speakers.has(id))
      {
        speakers.set(id, 'Human ' + (speakers.size + 1));
      }

      return speakers.get(id)!;
    };

    const history: ConversationTurn[] = this.entries.map(entry => ({
      speaker: label(entry.senderID), text: entry.text, time: entry.time,
    }));

    return { assistantName, history, latest: { speaker: label(senderID), text, time } };
  }

  get hasAssistant(): boolean
  {
    return this.entries.some(entry => entry.senderID === undefined);
  }
}
