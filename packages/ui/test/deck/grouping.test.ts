import { describe, expect, it } from 'vitest';
import { curveLabel } from '../../src/routes/deck/columns';
import {
  DEFAULT_GROUPING,
  GROUPINGS,
  type GroupingFacts,
  groupHeadLabel,
  groupMembers,
  groupingLabel,
  offeredGroupings,
  parseGrouping,
} from '../../src/routes/deck/grouping';

interface Member {
  readonly name: string;
  readonly count: number;
  readonly manaValue: number;
  readonly colorIdentity: string;
  readonly typeLine: string;
  readonly rarity: string | null;
}

function member(over: Partial<Member> & { name: string }): Member {
  return {
    count: 1,
    manaValue: 1,
    colorIdentity: 'R',
    typeLine: 'Creature — Goblin',
    rarity: 'common',
    ...over,
  };
}

const facts = (m: Member): GroupingFacts => m;
const weigh = (m: Member): number => m.count;

describe('the grouping axes', () => {
  it('offers four, defaulting to the one both captures default to', () => {
    expect(GROUPINGS).toEqual(['manaValue', 'color', 'cardType', 'rarity']);
    expect(DEFAULT_GROUPING).toBe('manaValue');
    expect(GROUPINGS.map(groupingLabel)).toEqual(['Mana value', 'Color', 'Card type', 'Rarity']);
  });

  it('reads a stored value and refuses one that names no axis', () => {
    expect(parseGrouping('color')).toBe('color');
    expect(parseGrouping('power')).toBeNull();
    expect(parseGrouping(undefined)).toBeNull();
    expect(parseGrouping(null)).toBeNull();
  });

  it('withholds rarity from a pane whose members cannot answer it', () => {
    const known = [member({ name: 'Bolt' }), member({ name: 'Shock' })];
    expect(offeredGroupings(known.map(facts))).toEqual([...GROUPINGS]);

    const artifact = [member({ name: 'Bolt' }), member({ name: 'Shock', rarity: null })];
    expect(offeredGroupings(artifact.map(facts))).toEqual(['manaValue', 'color', 'cardType']);
  });

  it('offers every axis over an empty pane, so the menu does not move', () => {
    expect(offeredGroupings([])).toEqual([...GROUPINGS]);
  });
});

describe('grouping members', () => {
  it('counts cards rather than members, so the heads sum to the pane header', () => {
    const members = [
      member({ name: 'Bolt', count: 4, manaValue: 1 }),
      member({ name: 'Shock', count: 3, manaValue: 1 }),
      member({ name: 'Anthem', count: 2, manaValue: 2 }),
    ];
    const groups = groupMembers(members, facts, weigh, 'manaValue');
    expect(groups.map((group) => group.cards)).toEqual([7, 2]);
    expect(groups.reduce((sum, group) => sum + group.cards, 0)).toBe(9);
  });

  it('sorts by mana value ascending and leaves the gaps out', () => {
    const members = [
      member({ name: 'Titan', manaValue: 6 }),
      member({ name: 'Bolt', manaValue: 1 }),
      member({ name: 'Mountain', manaValue: 0, typeLine: 'Basic Land — Mountain' }),
    ];
    const groups = groupMembers(members, facts, weigh, 'manaValue');
    expect(groups.map((group) => group.manaValue)).toEqual([0, 1, 6]);
    expect(groups.map((group) => group.label)).toEqual(['Mana value 0', 'Mana value 1', 'Mana value 6']);
  });

  it('sorts inside a column by name, whatever order the members arrived in', () => {
    const members = [
      member({ name: 'Shock', manaValue: 1 }),
      member({ name: 'Bolt', manaValue: 1 }),
      member({ name: 'Assault', manaValue: 1 }),
    ];
    const [group] = groupMembers(members, facts, weigh, 'manaValue');
    expect(group?.members.map((m) => m.name)).toEqual(['Assault', 'Bolt', 'Shock']);
  });

  it('groups by color in WUBRG order, then multicolor, then colorless', () => {
    const members = [
      member({ name: 'Sol Ring', colorIdentity: '' }),
      member({ name: 'Charm', colorIdentity: 'RW' }),
      member({ name: 'Bolt', colorIdentity: 'R' }),
      member({ name: 'Angel', colorIdentity: 'W' }),
      member({ name: 'Counterspell', colorIdentity: 'U' }),
    ];
    const groups = groupMembers(members, facts, weigh, 'color');
    expect(groups.map((group) => group.label)).toEqual(['White', 'Blue', 'Red', 'Multicolor', 'Colorless']);
    expect(groups.every((group) => group.manaValue === null)).toBe(true);
  });

  it('reads a color identity written in any order or case', () => {
    const members = [member({ name: 'A', colorIdentity: 'wr' }), member({ name: 'B', colorIdentity: 'RW' })];
    const groups = groupMembers(members, facts, weigh, 'color');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('Multicolor');
  });

  it('counts a land that is also a creature as a land, as the header does', () => {
    const members = [
      member({ name: 'Dryad Arbor', typeLine: 'Land Creature — Forest Dryad' }),
      member({ name: 'Goblin', typeLine: 'Creature — Goblin' }),
    ];
    const groups = groupMembers(members, facts, weigh, 'cardType');
    expect(groups.map((group) => group.label)).toEqual(['Land', 'Creature']);
  });

  it('puts an artifact creature under creature, and an unprinted type under Other', () => {
    const members = [
      member({ name: 'Golem', typeLine: 'Artifact Creature — Golem' }),
      member({ name: 'Ring', typeLine: 'Artifact' }),
      member({ name: 'Siege', typeLine: 'Battle — Siege' }),
    ];
    const groups = groupMembers(members, facts, weigh, 'cardType');
    expect(groups.map((group) => group.label)).toEqual(['Creature', 'Artifact', 'Other']);
  });

  it('does not read a type out of the tail of a subtype', () => {
    const members = [member({ name: 'Scout', typeLine: 'Creature — Human Scout' })];
    const groups = groupMembers(members, facts, weigh, 'cardType');
    expect(groups[0]?.label).toBe('Creature');
  });

  it('orders rarity from common up, and names an unrecorded one', () => {
    const members = [
      member({ name: 'M', rarity: 'mythic' }),
      member({ name: 'C', rarity: 'common' }),
      member({ name: 'R', rarity: 'rare' }),
      member({ name: 'U', rarity: 'uncommon' }),
      member({ name: 'X', rarity: null }),
    ];
    const groups = groupMembers(members, facts, weigh, 'rarity');
    expect(groups.map((group) => group.label)).toEqual([
      'Common',
      'Uncommon',
      'Rare',
      'Mythic',
      'Unknown rarity',
    ]);
  });

  it('partitions the same members whichever axis is chosen', () => {
    const members = [
      member({ name: 'Bolt', count: 4, manaValue: 1, colorIdentity: 'R' }),
      member({ name: 'Angel', count: 2, manaValue: 5, colorIdentity: 'W', typeLine: 'Creature — Angel' }),
      member({
        name: 'Mountain',
        count: 9,
        manaValue: 0,
        colorIdentity: '',
        typeLine: 'Basic Land — Mountain',
      }),
    ];
    const totals = GROUPINGS.map((grouping) =>
      groupMembers(members, facts, weigh, grouping).reduce((sum, group) => sum + group.cards, 0),
    );
    expect(totals).toEqual([15, 15, 15, 15]);
  });

  it('speaks a head as its name and its count', () => {
    const [one] = groupMembers([member({ name: 'Bolt', count: 1 })], facts, weigh, 'manaValue');
    const [many] = groupMembers([member({ name: 'Bolt', count: 4 })], facts, weigh, 'manaValue');
    expect(one && groupHeadLabel(one)).toBe('Mana value 1, 1 card');
    expect(many && groupHeadLabel(many)).toBe('Mana value 1, 4 cards');
  });

  it('keys a group stably, so a selection survives a regroup', () => {
    const members = [member({ name: 'Bolt', manaValue: 1, colorIdentity: 'R' })];
    expect(groupMembers(members, facts, weigh, 'manaValue')[0]?.key).toBe('mv:1');
    expect(groupMembers(members, facts, weigh, 'color')[0]?.key).toBe('color:R');
    expect(groupMembers(members, facts, weigh, 'cardType')[0]?.key).toBe('type:Creature');
    expect(groupMembers(members, facts, weigh, 'rarity')[0]?.key).toBe('rarity:common');
  });
});

describe('the spoken head', () => {
  it('says under mana value exactly what the curve strip says', () => {
    // Two sentences for one column would drift: `curveLabel` names the rungs of
    // the curve strip above the pane, `groupHeadLabel` names the column under
    // it, and a reader hearing them a word apart has to work out whether they
    // are about the same eight cards.
    const [group] = groupMembers(
      [member({ name: 'Bolt', count: 8, manaValue: 3 })],
      facts,
      weigh,
      'manaValue',
    );
    expect(group && groupHeadLabel(group)).toBe(curveLabel(3, 8));
  });
});
