import type { ConversationTurn, DecisionInput } from './ConversationDecision.js';

interface WindowEntry
{
  senderID?: string;
  text: string;
  time: number;
}

export class ConversationWindow
{
  static readonly ttl = 600_000;
  static readonly maxTurns = 20;
  static readonly maxText = 500;
  private entries: WindowEntry[] = [];

  constructor(readonly audience: string) {}

  prune(now: number): boolean
  {
    this.entries = this.entries.filter(entry => now - entry.time < ConversationWindow.ttl);
    return this.entries.length > 0;
  }

  append(text: string, time: number, senderID?: string): void
  {
    const bounded = text.length <= ConversationWindow.maxText
      ? text : text.slice(0, ConversationWindow.maxText) + ' [truncated]';

    this.entries.push({ text: bounded, time, senderID });
    this.entries = this.entries.slice(-ConversationWindow.maxTurns);
  }

  snapshot(assistantName: string, senderID: string, text: string): DecisionInput
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
    const history: ConversationTurn[] = this.entries.map(entry => ({ speaker: label(entry.senderID), text: entry.text }));

    return { assistantName, history, latest: { speaker: label(senderID), text } };
  }

  get hasRecentAssistant(): boolean
  {
    return this.entries.slice(-4).some(entry => entry.senderID === undefined);
  }
}
