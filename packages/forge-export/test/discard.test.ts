/**
 * The two discard rows, which share an API and differ by one parameter.
 *
 * Forge has one `Discard` effect and a `Mode$` that says who picks. That is a
 * third line drawn in a third place: the DSL prints the reveal as part of
 * `chooseDiscard`'s own meaning, the kernel emits a separate `handRevealed`
 * before it asks, and Forge folds both into one word. None of the three is a
 * rider a set could print on its own, so the rows are asserted whole rather
 * than by the parameters they happen to share.
 *
 * `NumCards$` carries the *printed* count and never a clamped one. CR 701.8a's
 * "as many as possible" is the engine's job on both sides, and a number this
 * transpiler derived from a hand it cannot see would be a claim about a
 * position rather than about a card.
 *
 * Both `Mode$` values were reasoned from Forge's API vocabulary rather than
 * read out of `res/cardsfolder`, so they are the likeliest thing in this file
 * to be wrong; nothing here has been through a booted Forge, which is the
 * standing limit on the whole package (`mtg-17a`).
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, EffectInput } from '@mtg/dsl';
import { legalTargetsFor, parseCard } from '@mtg/dsl';
import { FORGE_EFFECTS } from '../src/effect-script';
import { mustTranspile, slugId } from './helpers';

/** A black sorcery carrying one hand effect. */
function spell(name: string, effect: EffectInput): Card {
  return parseCard({
    kind: 'sorcery',
    id: slugId(name),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 2, W: 0, U: 0, B: 1, R: 0, G: 0 },
    colors: ['B'],
    keywords: [],
    abilities: [],
    effects: [effect],
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

describe('the discard rows', () => {
  it('writes Mind Rot as a targeted discard the target chooses', () => {
    expect(
      lineStartingWith(
        spell('Mind Rot', { kind: 'discardCards', count: 2, target: { kind: 'targetPlayer' } }),
        'A:',
      ),
    ).toBe(
      'A:SP$ Discard | ValidTgts$ Player | NumCards$ 2 | Mode$ TgtChoose |' +
        ' SpellDescription$ Target player discards two cards.',
    );
  });

  it('writes Coercion as the same API with the reveal folded into the mode', () => {
    expect(
      lineStartingWith(
        spell('Coercion', { kind: 'chooseDiscard', count: 1, target: { kind: 'targetOpponent' } }),
        'A:',
      ),
    ).toBe(
      'A:SP$ Discard | ValidTgts$ Player.Opponent | NumCards$ 1 | Mode$ RevealYouChoose |' +
        ' SpellDescription$ Target opponent reveals their hand. You choose a card from it.' +
        ' That player discards that card.',
    );
  });

  it('offers each row exactly the targets the DSL admits it under', () => {
    // The conformance suite asserts this over every kind at once; it is
    // restated here because these two rows share an API and a copied `targets`
    // array is the way that agreement would break without either file changing
    // shape.
    for (const kind of ['discardCards', 'chooseDiscard'] as const) {
      expect(FORGE_EFFECTS[kind].api).toBe('Discard');
      expect([...FORGE_EFFECTS[kind].targets].sort()).toEqual([...legalTargetsFor(kind)].sort());
      // A discard makes no token and asks nothing of the deck, so neither field
      // that would add a `[Tokens]` entry or a `DeckHas$` hint carries a value.
      expect(FORGE_EFFECTS[kind].deckHas).toBeNull();
    }
  });
});
