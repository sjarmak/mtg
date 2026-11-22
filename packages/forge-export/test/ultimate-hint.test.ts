/**
 * Which loyalty ability carries `Ultimate$ True`.
 *
 * The parameter is an AI preference hint and not a rules parameter: it tells
 * Forge's AI which ability is worth holding loyalty for, and a walker that
 * carries none plays by the same rules. So the rule behind it is read off the
 * corpus rather than derived. Read off `forge-gui/res/cardsfolder` at
 * 2.0.15-SNAPSHOT: 348 planeswalker scripts, 345 with a `Planeswalker$ True`
 * activation, 281 of those marking one. The marked ability is the last printed
 * one in 279 of the 281, and not one of the 281 marks a cost that adds loyalty.
 *
 * `mtg-bc2.153` replaced the predecessor rule -- the most negative fixed cost,
 * exact on 268 of the 281 -- with those two facts. The three cases below are
 * the ones the two rules disagree about, each named for the shipped script it
 * is drawn from. Like the rest of this mapping they are unverified against a
 * booted Forge (`mtg-17a`).
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';

function walker(abilities: CardInput['abilities']): Card {
  return parseCard({
    kind: 'planeswalker',
    id: 'tst-walker',
    name: 'Test Walker',
    rarity: 'mythic',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 2, R: 2 },
    colors: ['R'],
    supertypes: ['legendary'],
    subtypes: ['Chandra'],
    startingLoyalty: 4,
    abilities,
  });
}

function activations(card: Card): readonly string[] {
  const result = transpileCardScript(card);
  if (!result.ok) throw new Error(`expected a script, got ${JSON.stringify(result.rejections)}`);
  return result.value.lines.filter((line) => line.startsWith('A:'));
}

type AbilityInput = NonNullable<CardInput['abilities']>[number];

const DAMAGE_ONE: AbilityInput = {
  kind: 'activated',
  loyaltyCost: 1,
  cost: { mana: {} },
  effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetPlayerOrPlaneswalker' } }],
};

describe('the ability Forge is told to hold loyalty for', () => {
  it('is an announced -X when that is what the card prints last', () => {
    // `chandra_flamecaller.txt`: `+1`, `+0`, `-X`, and the `-X` is marked. The
    // predecessor rule read the most negative *fixed* cost, so a walker whose
    // only minus is announced got `Math.min(0)` and therefore no hint at all --
    // eleven shipped walkers, `Chandra, Flamecaller` and `Jeska, Thrice Reborn`
    // among them, exported without the one line the AI reads.
    const lines = activations(
      walker([
        DAMAGE_ONE,
        {
          kind: 'activated',
          loyaltyCost: 0,
          cost: { mana: {} },
          effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
        },
        {
          kind: 'activated',
          loyaltyCost: { kind: 'removeChosenX' },
          cost: { mana: {} },
          effects: [{ kind: 'dealDamage', amount: { kind: 'chosenX' }, target: { kind: 'targetCreature' } }],
        },
      ]),
    );
    expect(lines[0]).not.toContain('Ultimate$ True');
    expect(lines[1]).not.toContain('Ultimate$ True');
    expect(lines[2]).toContain('Cost$ SubCounter<X/LOYALTY>');
    expect(lines[2]).toContain('Ultimate$ True');
  });

  it('is a zero-cost last ability, not the larger minus printed above it', () => {
    // `gideon_jura.txt` prints `+2`, `-2`, `0` and marks the `0`;
    // `ajani_strength_of_the_pride.txt`, `gideon_of_the_trials.txt`,
    // `kytheon_hero_of_akros_gideon_battle_forged.txt` and
    // `jace_mirror_mage.txt` do the same. A cost of zero is not a cost that
    // gains loyalty, so it can carry the hint; the predecessor rule handed it
    // to the `-2` instead.
    const lines = activations(
      walker([
        DAMAGE_ONE,
        {
          kind: 'activated',
          loyaltyCost: -2,
          cost: { mana: {} },
          effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } }],
        },
        {
          kind: 'activated',
          loyaltyCost: 0,
          cost: { mana: {} },
          effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
        },
      ]),
    );
    expect(lines[1]).not.toContain('Ultimate$ True');
    expect(lines[2]).toContain('Cost$ AddCounter<0/LOYALTY>');
    expect(lines[2]).toContain('Ultimate$ True');
  });

  it('is nothing at all when the last printed ability gains loyalty', () => {
    // `grand_master_of_flowers.txt` (`+1`, `+1`) is the one shipped script whose
    // last loyalty ability adds counters, and it is unmarked. None of the 281
    // marked scripts marks a cost that gains. There is nothing to hold loyalty
    // for on a walker that only ever gains it.
    const lines = activations(
      walker([
        DAMAGE_ONE,
        {
          kind: 'activated',
          loyaltyCost: 1,
          cost: { mana: {} },
          effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
        },
      ]),
    );
    expect(lines).toHaveLength(2);
    expect(lines.some((line) => line.includes('Ultimate$ True'))).toBe(false);
  });

  it('is the last minus on the ordinary descending walker, as it always was', () => {
    // The common shape, where the predecessor rule and this one agree: the last
    // ability is also the most negative. Every walker fixture in this package
    // is this shape, which is why none of them moved.
    const lines = activations(
      walker([
        DAMAGE_ONE,
        {
          kind: 'activated',
          loyaltyCost: -2,
          cost: { mana: {} },
          effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } }],
        },
        {
          kind: 'activated',
          loyaltyCost: -6,
          cost: { mana: {} },
          effects: [{ kind: 'dealDamage', amount: 6, target: { kind: 'targetPlayerOrPlaneswalker' } }],
        },
      ]),
    );
    expect(lines[1]).not.toContain('Ultimate$ True');
    expect(lines[2]).toContain('Cost$ SubCounter<6/LOYALTY>');
    expect(lines[2]).toContain('Ultimate$ True');
  });
});
