import type { PrintedConstructedDeck, PrintedFormatRules } from '@mtg/printed-card';

export function momirFormatCopy(rules: PrintedFormatRules, deck: PrintedConstructedDeck): readonly string[] {
  if (rules.variant !== 'momir') return [];
  const deckSize = deck.cards.reduce((sum, slot) => sum + slot.count, 0);
  return [
    `Momir Basic decks carry no spells: all ${String(deckSize)} cards are basic lands, and a game starts at ${String(rules.startingLife)} life instead of 20.`,
    'Each player has an avatar. Once a turn, at sorcery speed, pay X mana and discard a card to create a token copy of a random creature with mana value X.',
  ];
}
