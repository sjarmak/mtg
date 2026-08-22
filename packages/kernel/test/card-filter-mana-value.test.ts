/**
 * `PrintedFilter.maxManaValue`: CR 202.3's bound, over a zone CR 613 does not
 * reach.
 *
 * `@mtg/dsl`'s file of the same name covers the schema and the printed clause.
 * This file covers the predicate, and the four claims are the four ways the
 * bound has to behave when a card actually asks:
 *
 *  1. It narrows the offered list: a graveyard holding a two-drop and a
 *     five-drop offers only the two-drop under "mana value 3 or less".
 *  2. It is inclusive. "3 or less" finds a three-drop, which is the difference
 *     between `<=` and `<` and is the whole meaning of the printed words.
 *  3. It composes with the type list rather than replacing it: a cheap sorcery
 *     is still refused by a creature-typed filter that also carries a bound.
 *  4. A land is zero (CR 202.3a), so a bound of zero finds one. This is the
 *     case a naive implementation reading `card.manaCost` would have crashed
 *     on or silently skipped, since a land card carries no cost field at all.
 */
import { describe, expect, it } from 'vitest';
import type { ReduceResult } from '@mtg/kernel';
import { pendingDecision, scenario } from '@mtg/kernel';
import { creature, lands, sorcery, SWAMP } from './cards';
import { apply, handOidOf } from './helpers';

function resolveSpell(start: ReduceResult, name: string): ReduceResult {
  let current = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, name),
    targets: [null],
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

function recall(name: string, filter: Record<string, unknown>) {
  return sorcery(
    name,
    [{ kind: 'chooseFromGraveyard', whose: 'you', filter, destination: 'hand' } as never],
    { B: 1 },
  );
}

/** The names a pending graveyard choice is offering, minus the take-nothing option. */
function offered(result: ReduceResult): readonly string[] {
  const decision = pendingDecision(result.state);
  if (decision?.kind !== 'graveyardChoice') throw new Error('a graveyard choice was not pending');
  return decision.cards.map((oid) => result.state.objects[oid]?.card.name ?? '?');
}

function withGraveyard(spell: ReturnType<typeof recall>, graveyard: readonly ReturnType<typeof creature>[]) {
  return scenario({
    battlefield: lands(SWAMP, 2).map((land) => ({ card: land, controller: 0 as const })),
    hands: [[spell], []],
    graveyards: [[...graveyard], []],
    libraries: [[creature('Deck', 1, 1)], [creature('Their Deck', 1, 1)]],
    seed: 'graveyard/mana-value-bound',
  });
}

const CHEAP = creature('Cheap One', 2, 2, { cost: { generic: 1, B: 1 } });
const MIDDLING = creature('Middling One', 3, 3, { cost: { generic: 2, B: 1 } });
const EXPENSIVE = creature('Expensive One', 6, 6, { cost: { generic: 4, B: 1 } });

describe('the bound narrows the graveyard', () => {
  it('offers the card under the bound and not the one over it', () => {
    const spell = recall('Test Bounded Recall', { cardTypes: ['creature'], maxManaValue: 3 });
    const asked = resolveSpell(withGraveyard(spell, [CHEAP, EXPENSIVE]), spell.name);
    expect(offered(asked)).toEqual(['Cheap One']);
  });

  it('is inclusive, which is what "or less" says', () => {
    const spell = recall('Test Bounded Recall Three', { cardTypes: ['creature'], maxManaValue: 3 });
    const asked = resolveSpell(withGraveyard(spell, [MIDDLING, EXPENSIVE]), spell.name);
    expect(offered(asked)).toEqual(['Middling One']);
  });

  it('is one condition among the filter, not a replacement for the type list', () => {
    const cheapSorcery = sorcery('Cheap Spell', [{ kind: 'shuffleLibrary' }], { U: 1 });
    const spell = recall('Test Bounded Recall Typed', { cardTypes: ['creature'], maxManaValue: 3 });
    const asked = resolveSpell(withGraveyard(spell, [CHEAP, cheapSorcery]), spell.name);
    expect(offered(asked)).toEqual(['Cheap One']);
  });
});

describe('a land is zero', () => {
  /**
   * CR 202.3a. A land card has no `manaCost` field at all, so this is the case
   * that decides whether the predicate reads a cost or asks a card what its
   * mana value is.
   */
  it('finds a land under a bound of zero and leaves every spell out', () => {
    const spell = recall('Test Bounded Recall Zero', { maxManaValue: 0 });
    const asked = resolveSpell(withGraveyard(spell, [SWAMP as never, CHEAP]), spell.name);
    expect(offered(asked)).toEqual(['Swamp']);
  });
});
