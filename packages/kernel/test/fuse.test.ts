/**
 * Fuse, the first named mechanic of the flagship set, played end to end.
 *
 * the set design document states it as one sentence: "A part token
 * is an artifact whose only ability is `Fuse {cost}: Sacrifice this. Put a
 * <part> counter on target creature.`" That sentence crosses four
 * packages, and until tonight none of them could hold it: the DSL had no
 * activated ability (slice C), no cost could spend the permanent that carried
 * it (`mtg-bc2.132.11`), and no counter kind named a part or declared what
 * carrying one meant (`mtg-bc2.132.8`).
 *
 * Each of those has its own tests. This one asserts the sentence itself, which
 * is the thing the set actually needs, and it is deliberately written the way
 * the design document writes it rather than the way any one package would.
 */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import {
  getObject,
  hasKeyword,
  legalActions,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  toughnessOf,
} from '@mtg/kernel';
import { creature, FOREST } from './cards';

const TROPHY_HORN = parseCard({
  id: 'xmp-trophy-horn',
  name: 'Trophy Horn',
  kind: 'artifact',
  rarity: 'uncommon',
  set: { code: 'XMP', collectorNumber: 1 },
  manaCost: { generic: 2 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 }, sacrificeSelf: true },
      effects: [{ kind: 'putCounters', counter: 'horn', count: 1, target: { kind: 'targetCreature' } }],
    },
  ],
});

const SPROUT = creature('Bramble Sprout', 2, 2, { cost: { generic: 1 } });

function board() {
  const started = scenario({
    battlefield: [
      { card: TROPHY_HORN, controller: 0 },
      { card: SPROUT, controller: 0 },
      ...Array.from({ length: 3 }, () => ({ card: FOREST, controller: 0 as const })),
    ],
  });
  const state = started.state;
  const named = (name: string): string => {
    const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === name);
    if (found === undefined) throw new Error(`no battlefield object named ${name}`);
    return found;
  };
  return { state, hornOid: named('Trophy Horn'), sproutOid: named('Bramble Sprout') };
}

describe('Fuse', () => {
  it('spends the horn and leaves its counter on the creature', () => {
    const { state, hornOid, sproutOid } = board();

    expect(powerOf(state, sproutOid)).toBe(2);
    expect(toughnessOf(state, sproutOid)).toBe(2);
    expect(hasKeyword(state, sproutOid, 'firstStrike')).toBe(false);

    const activation = legalActions(state).find(
      (action) => action.type === 'activateAbility' && action.oid === hornOid,
    );
    if (activation === undefined) throw new Error('the Fuse activation was not offered');

    // The cost is paid on activation (CR 601.2h), so the horn is already in the
    // graveyard while its own ability is still on the stack.
    const activated = reduce(state, activation);
    expect(getObject(activated.state, hornOid).zone).toBe('graveyard');

    const settled = reduceAll(activated.state, [
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]).state;

    // Both halves of the declaration land, and they land in different layers:
    // the stat bonus in 7d, the keyword in 6.
    expect(getObject(settled, sproutOid).counters.horn).toBe(1);
    expect(powerOf(settled, sproutOid)).toBe(3);
    expect(toughnessOf(settled, sproutOid)).toBe(3);
    expect(hasKeyword(settled, sproutOid, 'firstStrike')).toBe(true);
  });
});
