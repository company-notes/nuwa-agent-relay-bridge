import type { Interface } from 'node:readline/promises';

import { BridgeError } from './BridgeError.js';

export class Selection
{
  static async choose<T>(input: Interface, items: T[], prompt: string): Promise<T[]>
  {
    const selection = (await input.question(prompt)).trim();
    const numbers = selection ? selection.split(',').map(value => Number(value.trim())) : [];

    if (numbers.some(value => !Number.isInteger(value) || value < 1 || value > items.length))
    {
      throw new BridgeError('Invalid selection.');
    }

    return [...new Set(numbers)].map(value => items[value - 1]!);
  }
}
