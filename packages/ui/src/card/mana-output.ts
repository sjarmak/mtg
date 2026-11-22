import type { ManaColor } from '@mtg/dsl';

const MANA_OUTPUT_WORDS: Readonly<Record<ManaColor, string>> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  C: 'colorless',
};

/** Accessible prose for one or more structured mana outputs. */
export function manaOutputLabel(outputs: readonly ManaColor[]): string {
  const words = outputs.map((output) => MANA_OUTPUT_WORDS[output]);
  if (words.length < 2) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} or ${words.at(-1)!}`;
}
