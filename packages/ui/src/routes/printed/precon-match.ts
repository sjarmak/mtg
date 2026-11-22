/**
 * A table seated from two shipped precons.
 *
 * The decks are data from disk, so there is nothing to restore and nothing to
 * build: each deck goes to the engine seam as the names and counts the format
 * states, its commanders in the command zone, under the rules the format
 * states. Match preparation is not play admission: the backend still
 * qualifies the format on its own, the way `printed-match.ts` says.
 */
import { matchRulesRefusals } from '@mtg/engine';
import type { DeckRef, DeckSlot, MatchRules, SeatId, SessionSpec } from '@mtg/engine';
import type { PrintedConstructedDeck, PrintedConstructedFormat } from '@mtg/printed-card';

function slots(cards: PrintedConstructedDeck['cards']): DeckSlot[] {
  return cards.map(({ name, count }) => ({ name, count }));
}

/** The deck as the engine seam reads it: names, counts, and the general apart. */
export function preconDeckRef(deck: PrintedConstructedDeck): DeckRef {
  return {
    name: deck.name,
    cards: slots(deck.cards),
    ...(deck.commanders.length === 0 ? {} : { commanders: slots(deck.commanders) }),
  };
}

/**
 * The format's rules in the engine contract's words.
 *
 * Read by every table these decks are seated at: the bot match below, the
 * Commander page's own mount, and the landing that opens a Forge table over
 * the network (`../../dev/LabApp.ts`). A precon deck is a hundred singleton
 * cards and a general, and a table dealt without these is a twenty-life game
 * with no command zone, so the three cannot each state them.
 */
export function preconMatchRules(format: PrintedConstructedFormat): MatchRules {
  return { variant: format.rules.variant, startingLife: format.rules.startingLife };
}

export function preparePreconMatch(
  format: PrintedConstructedFormat,
  decks: { readonly human: PrintedConstructedDeck; readonly opponent: PrintedConstructedDeck },
  options: { readonly seed: string; readonly humanSeat: SeatId },
): SessionSpec {
  if (options.seed.trim().length === 0) throw new Error('A precon match seed must not be empty.');
  if (options.humanSeat !== 0 && options.humanSeat !== 1) throw new Error('Invalid human match seat.');
  for (const deck of [decks.human, decks.opponent]) {
    if (!format.decks.some((entry) => entry.id === deck.id)) {
      throw new Error(`Deck ${deck.id} is not one of ${format.name}'s decks.`);
    }
  }
  const localSeat = { name: 'You', controller: 'local' as const, deck: preconDeckRef(decks.human) };
  const engineSeat = {
    name: 'Forge bot',
    controller: 'engine' as const,
    deck: preconDeckRef(decks.opponent),
  };
  const table: SessionSpec = {
    content: { kind: 'printed', format: format.id },
    seats: options.humanSeat === 0 ? [localSeat, engineSeat] : [engineSeat, localSeat],
    rules: preconMatchRules(format),
    seed: options.seed,
    maximumTurns: null,
  };
  const refusals = matchRulesRefusals(table);
  if (refusals.length > 0) throw new Error(refusals.join('; '));
  return table;
}
