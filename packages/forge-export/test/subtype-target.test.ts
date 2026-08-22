/**
 * A subtype on the target slot as Forge writes it.
 *
 * `mtg-nhyv.56`. The question this file answers is which side of Forge's
 * grammar a subtype lands on, and it is the same question `filtered-target.
 * test.ts` answers for a card type — with the same two answers, because the
 * corpus reading behind them is one reading. A card type is the base on the
 * battlefield (Demolish is `ValidTgts$ Artifact,Land`) and a qualifier on the
 * stack (`Card.Creature`); a subtype is the base when nothing but `Permanent`
 * stands there and a qualifier when a real base does. `forgeSearchType` already
 * writes both shapes for a search filter, so neither is invented here — and a
 * mapping this package invents is the one thing it must never do, because a
 * parity oracle that guesses a selector reports a mismatch as agreement.
 *
 * Everything here is read off `res/cardsfolder` rather than off a booted Forge,
 * which is the standing limit on the whole package (`mtg-17a`).
 */
import { describe, expect, it } from 'vitest';
import type { Card, EffectInput } from '@mtg/dsl';
import { forgeFilteredTargets } from '@mtg/forge-export';
import { mustTranspile, spell } from './helpers';

function abilityLine(card: Card): string {
  const line = mustTranspile(card)
    .split('\n')
    .find((text) => text.startsWith('A:'));
  if (line === undefined) throw new Error('no A: line');
  return line;
}

/** The `ValidTgts$` value out of the one `A:` line this spell has. */
function validTgts(name: string, effect: EffectInput): string {
  const found = /ValidTgts\$ ([^|]*)/.exec(abilityLine(spell(name, [effect])));
  if (found === null) throw new Error(`no ValidTgts in ${name}`);
  return (found[1] ?? '').trim();
}

describe('a subtype through the transpiler', () => {
  it('takes the base from Permanent, the way a card type does', () => {
    expect(
      validTgts('Rootway Signal', {
        kind: 'untapPermanent',
        target: { kind: 'targetPermanent', filter: { subtypes: ['Forest'] } },
      }),
    ).toBe('Forest');
  });

  it('qualifies a base that says something, rather than replacing it', () => {
    expect(
      validTgts('Tide Signal', {
        kind: 'tapPermanent',
        target: { kind: 'targetCreature', filter: { subtypes: ['Merfolk'] } },
      }),
    ).toBe('Creature.Merfolk');
  });
});

describe('the selector builder itself', () => {
  it('unions two subtypes by repeating the base, not by listing two qualifiers', () => {
    expect(forgeFilteredTargets('Creature', { subtypes: ['Merfolk', 'Elf'] }, 'base')).toEqual([
      'Creature.Merfolk',
      'Creature.Elf',
    ]);
  });

  it('swaps the widest base and crosses the swap with the other dimensions', () => {
    expect(forgeFilteredTargets('Permanent', { subtypes: ['Forest', 'Island'] }, 'base')).toEqual([
      'Forest',
      'Island',
    ]);
    expect(forgeFilteredTargets('Permanent', { subtypes: ['Merfolk'], combat: 'attacking' }, 'base')).toEqual(
      ['Merfolk.attacking'],
    );
  });

  /**
   * `Creature.YouCtrl` is why the swap is confined to the exact token
   * `Permanent`: that base carries a constraint of its own, and a base swap
   * would drop the half that says whose creature.
   */
  it('keeps a qualified base whole and appends with a plus', () => {
    expect(forgeFilteredTargets('Creature.YouCtrl', { subtypes: ['Merfolk'] }, 'base')).toEqual([
      'Creature.YouCtrl+Merfolk',
    ]);
  });

  it('leaves the subtype beside a card type as a qualifier on that type', () => {
    expect(
      forgeFilteredTargets('Permanent', { cardTypes: ['creature'], subtypes: ['Merfolk'] }, 'base'),
    ).toEqual(['Creature.Merfolk']);
    expect(forgeFilteredTargets('Card', { subtypes: ['Merfolk'] }, 'qualifier')).toEqual(['Card.Merfolk']);
  });
});
