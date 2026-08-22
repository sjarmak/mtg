/**
 * A mana ability as Forge writes it, and the two things about that spelling
 * that are not guessable.
 *
 * Forge has one API for producing mana and it is used from both halves of the
 * card: an activated mana ability is `A:AB$ Mana` and a ritual is `A:SP$ Mana`,
 * the same row with a different prefix. That is the corpus's arrangement, not a
 * simplification of ours — Llanowar Elves is `A:AB$ Mana | Cost$ T | Produced$
 * G` and Dark Ritual is `A:SP$ Mana | Produced$ B | Amount$ 3`, so the quantity
 * rides on `Amount$` in both and is omitted when it is one, exactly as Sol
 * Ring's `Produced$ C | Amount$ 2` omits nothing else.
 *
 * The second unguessable is the color choice. Forge does not write `Produced$ W
 * or U`; it writes `Produced$ Combo W U`, a single token followed by the colors
 * it chooses among, and reserves `Produced$ Any` for the five-color case. We
 * emit the `Combo` form for every multi-color list rather than special-casing a
 * list that happens to name all five, because `Any` and a five-way `Combo` are
 * the same permission and the shorter one is an optimization no parity run
 * would notice.
 *
 * Everything here is read off `res/cardsfolder` rather than off a booted Forge,
 * which is the standing limit on the whole package (`mtg-17a`).
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';
import { FORGE_EFFECTS } from '../src/effect-script';
import { FORGE_MANA_PRODUCED } from '../src/vocabulary-map';
import { mustTranspile, slugId } from './helpers';

/** A creature whose only ability taps for the given mana. */
function accelerant(name: string, produces: readonly string[], amount: number): Card {
  return parseCard({
    kind: 'creature',
    id: slugId(name),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    colors: ['G'],
    power: 1,
    toughness: 1,
    manaCost: { generic: 0, W: 0, U: 0, B: 0, R: 0, G: 1 },
    keywords: [],
    effects: [],
    abilities: [
      {
        kind: 'activated',
        cost: { mana: {}, tapSelf: true },
        effects: [{ kind: 'addMana', produces: [...produces], amount }],
      },
    ],
  } as CardInput);
}

/** The one line of a script that starts with the given prefix. */
function lineStartingWith(card: Card, prefix: string): string {
  const line = mustTranspile(card)
    .split('\n')
    .find((text) => text.startsWith(prefix));
  if (line === undefined) throw new Error(`no ${prefix} line`);
  return line;
}

describe('a permanent that taps for mana', () => {
  it('writes the activated row Llanowar Elves writes', () => {
    expect(lineStartingWith(accelerant('Thicket Mystic', ['G'], 1), 'A:')).toBe(
      'A:AB$ Mana | Cost$ T | Produced$ G | SpellDescription$ {T}: Add {G}.',
    );
  });

  it('omits the quantity at one and states it above one', () => {
    expect(lineStartingWith(accelerant('Sun Ring', ['C'], 2), 'A:')).toBe(
      'A:AB$ Mana | Cost$ T | Produced$ C | Amount$ 2 | SpellDescription$ {T}: Add {C}{C}.',
    );
  });

  it('spells a color choice as a Combo rather than as a sentence', () => {
    expect(lineStartingWith(accelerant('Prism Warden', ['W', 'U'], 1), 'A:')).toBe(
      'A:AB$ Mana | Cost$ T | Produced$ Combo W U | SpellDescription$ {T}: Add {W} or {U}.',
    );
  });

  it('carries any mana in the cost onto the same Cost$ field as the tap', () => {
    const keeper = parseCard({
      kind: 'artifact',
      id: slugId('Coffer Keeper'),
      name: 'Coffer Keeper',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 2 },
      colors: [],
      manaCost: { generic: 3, W: 0, U: 0, B: 0, R: 0, G: 0 },
      keywords: [],
      effects: [],
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 2 }, tapSelf: true },
          effects: [{ kind: 'addMana', produces: ['B'], amount: 2 }],
        },
      ],
    } as CardInput);
    expect(lineStartingWith(keeper, 'A:')).toBe(
      'A:AB$ Mana | Cost$ 2 T | Produced$ B | Amount$ 2 | SpellDescription$ {2}, {T}: Add {B}{B}.',
    );
  });
});

describe('a ritual', () => {
  it('writes the same row under the spell prefix', () => {
    const rite = parseCard({
      kind: 'sorcery',
      id: slugId('Shadow Rite'),
      name: 'Shadow Rite',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 3 },
      colors: ['B'],
      manaCost: { generic: 0, W: 0, U: 0, B: 1, R: 0, G: 0 },
      effects: [{ kind: 'addMana', produces: ['B'], amount: 3 }],
    } as CardInput);
    expect(lineStartingWith(rite, 'A:')).toBe(
      'A:SP$ Mana | Produced$ B | Amount$ 3 | SpellDescription$ Add {B}{B}{B}.',
    );
  });
});

describe('the mapping itself', () => {
  it('targets nothing and asks nothing of the deck', () => {
    expect(FORGE_EFFECTS.addMana.api).toBe('Mana');
    // A mana ability chooses no targets (CR 605.1a), and it makes no token and
    // wants no `DeckHas$` hint, so the two fields that would otherwise add a
    // `[Tokens]` entry or a deck hint stay empty rather than carrying a value
    // nothing reads.
    expect(FORGE_EFFECTS.addMana.targets).toEqual([]);
    expect(FORGE_EFFECTS.addMana.deckHas).toBeNull();
  });

  it('spells each color as the single letter the corpus uses', () => {
    expect(FORGE_MANA_PRODUCED).toStrictEqual({ W: 'W', U: 'U', B: 'B', R: 'R', G: 'G', C: 'C' });
  });

  it('refuses a quantity counted off the board rather than guessing at one', () => {
    // `landsWithSubtype` has no `Valid` spelling in board-count.ts, the same
    // way `cardsInGraveyard` and `chosenX` have none, so the card is rejected
    // whole instead of exporting a Cabal Coffers that adds one mana. The
    // rejection is the contract: a Forge script that disagrees with the kernel
    // is worse than a card the parity oracle never sees.
    const coffers = parseCard({
      kind: 'artifact',
      id: slugId('Sunken Coffers'),
      name: 'Sunken Coffers',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 4 },
      colors: [],
      manaCost: { generic: 3, W: 0, U: 0, B: 0, R: 0, G: 0 },
      keywords: [],
      effects: [],
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 2 }, tapSelf: true },
          effects: [
            {
              kind: 'addMana',
              produces: ['B'],
              amount: { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' },
            },
          ],
        },
      ],
    } as CardInput);
    const result = transpileCard(coffers);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a rejection');
    expect(result.rejections.map((rejection) => rejection.code)).toEqual(['UNMAPPED_COMPUTED_AMOUNT']);
  });
});
