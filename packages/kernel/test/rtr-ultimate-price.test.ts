/** Native current-color target legality for RTR Ultimate Price. */
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  objectFilter,
  reduce,
  resolveTop,
  scenario,
  targetChoicesFor,
  validateAction,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature, lands, SWAMP } from './cards';
import { recolor, withContinuous } from './continuous-helpers';
import { handOidOf, oidOf } from './helpers';

const ULTIMATE_PRICE = parseCard({
  kind: 'instant',
  id: 'rtr-82-ultimate-price-kernel',
  name: 'Ultimate Price',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 82 },
  manaCost: { generic: 1, B: 1 },
  colors: ['B'],
  effects: [
    {
      kind: 'destroyPermanent',
      target: { kind: 'targetCreature', filter: { monocolored: true } },
    },
  ],
} as unknown as CardInput);

const GREEN = creature('Price Green Creature', 2, 2, { cost: { G: 1 } });
const MULTICOLORED = creature('Price Multicolored Creature', 2, 2, { cost: { W: 1, U: 1 } });
const COLORLESS = creature('Price Colorless Creature', 2, 2, { cost: { generic: 2 } });

function target(oid: string) {
  return { kind: 'permanent' as const, oid };
}

function board() {
  return scenario({
    battlefield: [
      ...lands(SWAMP, 2).map((card) => ({ card, controller: 0 as const })),
      { card: GREEN, controller: 1 as const },
      { card: MULTICOLORED, controller: 1 as const },
      { card: COLORLESS, controller: 1 as const },
    ],
    hands: [[ULTIMATE_PRICE], []],
  });
}

describe('Ultimate Price native execution', () => {
  it('offers exactly-one-color creatures and rejects zero- or two-color declarations', () => {
    const opened = board();
    const green = oidOf(opened.state, GREEN.name);
    const multicolored = oidOf(opened.state, MULTICOLORED.name);
    const colorless = oidOf(opened.state, COLORLESS.name);
    const spell = handOidOf(opened.state, 0, ULTIMATE_PRICE.name);
    const choices = targetChoicesFor(opened.state, ULTIMATE_PRICE, 0, spell)[0];

    expect(choices).toEqual([target(green)]);
    expect(
      validateAction(opened.state, {
        type: 'castSpell',
        player: 0,
        oid: spell,
        targets: [target(multicolored)],
      }),
    ).toBe('illegal target for effect 0');
    expect(
      validateAction(opened.state, {
        type: 'castSpell',
        player: 0,
        oid: spell,
        targets: [target(colorless)],
      }),
    ).toBe('illegal target for effect 0');
  });

  it('fizzles when its sole target gains a second current color before resolution', () => {
    const opened = board();
    const green = oidOf(opened.state, GREEN.name);
    const cast = reduce(opened.state, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(opened.state, 0, ULTIMATE_PRICE.name),
      targets: [target(green)],
    });
    const changed = withContinuous(cast.state, [
      recolor(objectFilter({ oids: [green] }), ['G', 'U'], [], { source: green }),
    ]);
    const resolved = resolveTop(beginTrace(changed));

    expect(resolved.state.objects[green]?.zone).toBe('battlefield');
    expect(eventsOfType(resolved.events, 'spellFizzled')).toHaveLength(1);
  });
});
