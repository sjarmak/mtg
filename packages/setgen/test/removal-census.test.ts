/**
 * The removal census, over hand-built pools.
 *
 * The rule `pool-census.test.ts` states and `shape-census.test.ts` follows holds
 * here too: nothing pins a count taken from a shipped set, because such an
 * assertion is red on the next card anybody authors and is a tripwire on
 * authoring rather than a gate on the instrument. The shipped pools are what the
 * tool is *run* on; what is asserted is the properties that hold at any size,
 * and every one of them is a way this census could quietly report a number that
 * means something other than what it says.
 *
 *  1. **Destroy and exile stay apart.** Folding them together is the one error
 *     that would make the instrument useless for the question it was built for,
 *     because an exiled creature does not die and every death payoff in a set
 *     turns on that.
 *  2. **Both narrowing fields disqualify.** A slot narrows through `restriction`
 *     and through `filter`, and a census reading one of them would count a card
 *     that cannot always be aimed where you want it as if it could.
 *  3. **A toll clause disqualifies.** The premium count is about what a spell
 *     costs its caster; a spell the opponent can pay through is not that spell.
 *  4. **A sweeper is not premium.** It is stronger, not weaker, but it is a
 *     different card and it is counted on its own row.
 *  5. **A pool is an argument**, and a document that is not a pool is refused
 *     rather than reported as empty.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import {
  damageBandOf,
  formatRemovalCensus,
  isUnconditionalPremium,
  main,
  poolCards,
  removalCensus,
  shareOfCreaturesAtOrBelow,
  subjectOf,
  toughnessDistribution,
} from '../tools/removal-census';

/**
 * Every probe below is the same black two-drop but for the clause under test,
 * written out rather than spread from a base: `CardInput` is a discriminated
 * union and a spread widens the discriminant, so a shared base would have to be
 * cast back to the type it is meant to be checked against.
 */
const KILL: CardInput = {
  rarity: 'common',
  manaCost: { generic: 1, B: 1 },
  colors: ['B'],
  kind: 'sorcery',
  id: 'cen-plain-kill',
  name: 'Plain Kill',
  set: { code: 'CEN', collectorNumber: 1 },
  effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
};

const DELETE: CardInput = {
  rarity: 'common',
  manaCost: { generic: 1, B: 1 },
  colors: ['B'],
  kind: 'sorcery',
  id: 'cen-plain-delete',
  name: 'Plain Delete',
  set: { code: 'CEN', collectorNumber: 2 },
  effects: [{ kind: 'exileTarget', target: { kind: 'targetCreature' } }],
};

const NARROW_BY_RESTRICTION: CardInput = {
  rarity: 'common',
  manaCost: { generic: 1, B: 1 },
  colors: ['B'],
  kind: 'sorcery',
  id: 'cen-small-kill',
  name: 'Small Kill',
  set: { code: 'CEN', collectorNumber: 3 },
  effects: [
    {
      kind: 'destroyPermanent',
      target: { kind: 'targetCreature', restriction: { kind: 'maxPower', power: 2 } },
    },
  ],
};

const NARROW_BY_FILTER: CardInput = {
  rarity: 'common',
  manaCost: { generic: 1, B: 1 },
  colors: ['B'],
  kind: 'sorcery',
  id: 'cen-colored-kill',
  name: 'Colored Kill',
  set: { code: 'CEN', collectorNumber: 4 },
  effects: [
    { kind: 'destroyPermanent', target: { kind: 'targetCreature', filter: { excludeColors: ['B'] } } },
  ],
};

const TOLLED: CardInput = {
  rarity: 'common',
  manaCost: { generic: 1, B: 1 },
  colors: ['B'],
  kind: 'instant',
  id: 'cen-paid-kill',
  name: 'Paid Kill',
  set: { code: 'CEN', collectorNumber: 5 },
  effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
  unless: { payer: 'targetController', cost: { generic: 2 } },
};

const SWEEP: CardInput = {
  rarity: 'common',
  manaCost: { generic: 1, B: 1 },
  colors: ['B'],
  kind: 'sorcery',
  id: 'cen-every-kill',
  name: 'Every Kill',
  set: { code: 'CEN', collectorNumber: 6 },
  effects: [
    {
      kind: 'destroyPermanent',
      target: { kind: 'noTarget' },
      scope: 'creaturesThatPlayerControls',
      scopeFilter: { cardTypes: ['creature'] },
    },
  ],
};

/**
 * The mtg-9mxv pool: three creatures at three toughnesses, a one-shot burn
 * spell, a repeatable combat pinger, and an X-damage spell whose amount is
 * computed rather than printed. This is the hand-written pool the damage-band
 * extension is asserted against, never the private flagship fixture.
 */
const WISP: CardInput = {
  rarity: 'common',
  manaCost: { generic: 1 },
  colors: [],
  kind: 'creature',
  id: 'cen-wisp',
  name: 'Frail Wisp',
  set: { code: 'CEN', collectorNumber: 10 },
  power: 1,
  toughness: 1,
};

const GUARD: CardInput = {
  rarity: 'common',
  manaCost: { generic: 3 },
  colors: [],
  kind: 'creature',
  id: 'cen-guard',
  name: 'Stone Guard',
  set: { code: 'CEN', collectorNumber: 11 },
  power: 2,
  toughness: 4,
};

const ONE_SHOT_BURN: CardInput = {
  rarity: 'common',
  manaCost: { generic: 1, R: 1 },
  colors: ['R'],
  kind: 'instant',
  id: 'cen-burn',
  name: 'Plain Burn',
  set: { code: 'CEN', collectorNumber: 12 },
  effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } }],
};

const PINGER: CardInput = {
  rarity: 'common',
  manaCost: { generic: 1, R: 1 },
  colors: ['R'],
  kind: 'creature',
  id: 'cen-pinger',
  name: 'Ember Skirmisher',
  set: { code: 'CEN', collectorNumber: 13 },
  power: 1,
  toughness: 2,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfAttacks',
      effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetCreature' } }],
    },
  ],
};

const DYNAMIC_BURN: CardInput = {
  rarity: 'rare',
  manaCost: { generic: 0, R: 1, hasX: true },
  colors: ['R'],
  kind: 'instant',
  id: 'cen-x-burn',
  name: 'Chosen Inferno',
  set: { code: 'CEN', collectorNumber: 14 },
  effects: [{ kind: 'dealDamage', amount: { kind: 'chosenX' }, target: { kind: 'targetCreature' } }],
};

function setFile(cards: readonly CardInput[]): unknown {
  return {
    formatVersion: 1,
    set: { code: 'CEN', name: 'Census', theme: 'census', seed: 'census', profile: 'test v1' },
    cards,
  };
}

function premiumNames(cards: readonly CardInput[]): readonly string[] {
  return removalCensus('probe', setFile(cards))
    .rows.filter(isUnconditionalPremium)
    .map((row) => row.card);
}

describe('a removal census', () => {
  it('keeps destroy and exile in separate buckets', () => {
    const census = removalCensus('probe', setFile([KILL, DELETE]));
    const bucketOf = (name: string): string | undefined =>
      census.rows.find((row) => row.card === name)?.bucket;

    expect(bucketOf('Plain Kill')).toBe('destroy');
    expect(bucketOf('Plain Delete')).toBe('exile');
  });

  /**
   * The one that already went wrong: the derived-destroy helper in the flagship
   * precon suite read `restriction` and not `filter`, so a card narrowed through
   * the other field went on looking unconditional to it.
   */
  it('reads a narrowing through either field as a condition', () => {
    const census = removalCensus('probe', setFile([NARROW_BY_RESTRICTION, NARROW_BY_FILTER]));

    for (const row of census.rows) expect(row.conditions.length).toBeGreaterThan(0);
    expect(premiumNames([NARROW_BY_RESTRICTION, NARROW_BY_FILTER])).toEqual([]);
  });

  it('counts a spell with no condition and no toll, and only that spell', () => {
    expect(premiumNames([KILL, DELETE, NARROW_BY_RESTRICTION, NARROW_BY_FILTER, TOLLED, SWEEP])).toEqual([
      'Plain Kill',
      'Plain Delete',
    ]);
  });

  it('records a toll clause as a condition on the removal it is printed on', () => {
    const row = removalCensus('probe', setFile([TOLLED])).rows[0];

    expect(row?.conditions).toContain('toll:unless');
  });

  it('marks a sweeper as a sweep rather than as a single-target answer', () => {
    const row = removalCensus('probe', setFile([SWEEP])).rows[0];

    expect(row?.sweep).toBe(true);
    expect(isUnconditionalPremium(row!)).toBe(false);
  });

  it('counts the interactive half beside the removal', () => {
    const census = removalCensus('probe', setFile([TOLLED, KILL]));

    expect(census.interaction.tolls).toEqual(['Paid Kill']);
    expect(census.interaction.instants).toBe(1);
  });

  /**
   * The document comes off disk, so it is external data and is validated at the
   * boundary. A census that read an arbitrary object would report zeros for a
   * file that is not a set at all, which is the reading that looks like a
   * finding.
   */
  it('refuses a document that is not a set file rather than reporting it as empty', () => {
    expect(() => removalCensus('not-a-set', { cards: [] })).toThrow();
  });

  it('refuses a reduced reference document that is missing its reduction block', () => {
    expect(() =>
      removalCensus('half-a-reduction', {
        formatVersion: 1,
        kind: 'position-reduced-reference-set-document',
        set: { code: 'M11', name: 'Magic 2011 (reduced)', reduced: true },
        cards: [KILL],
      }),
    ).toThrow();
  });
});

describe('the formatted census', () => {
  it('says so plainly when a pool prints no unconditional premium removal', () => {
    const table = formatRemovalCensus([removalCensus('narrow', setFile([NARROW_BY_FILTER]))]);

    expect(table).toContain('none at any rarity');
  });

  it('shares the premium count against the rarity pool rather than the whole set', () => {
    const table = formatRemovalCensus([removalCensus('one-of-two', setFile([KILL, NARROW_BY_FILTER]))]);
    const commons = table.split('\n').find((line) => line.startsWith('common')) ?? '';

    expect(commons).toContain('50.0%');
  });
});

/**
 * mtg-9mxv: the census counted damage rows and not reach. Two 1-damage
 * pingers and two 5-damage burn spells were the same row count and two
 * different facts about the format; these assertions are the fix.
 */
describe('the damage band (reach, not just rows)', () => {
  it('reads a creature pool by toughness, not by row', () => {
    const distribution = toughnessDistribution(poolCards(setFile([WISP, GUARD, PINGER])));

    expect(distribution.get(1)).toBe(1);
    expect(distribution.get(2)).toBe(1);
    expect(distribution.get(4)).toBe(1);
  });

  it('shares the amount against the pool that actually prints the creatures', () => {
    const distribution = toughnessDistribution(poolCards(setFile([WISP, GUARD, PINGER])));

    // toughness 1 and 2 are both at or below amount 2; toughness 4 is not.
    expect(shareOfCreaturesAtOrBelow(distribution, 3, 2)).toBeCloseTo(2 / 3);
    expect(shareOfCreaturesAtOrBelow(distribution, 3, 1)).toBeCloseTo(1 / 3);
    expect(shareOfCreaturesAtOrBelow(distribution, 3, 5)).toBe(1);
  });

  it('refuses a share of zero creatures and a share of a computed amount', () => {
    const distribution = toughnessDistribution(poolCards(setFile([WISP])));

    expect(shareOfCreaturesAtOrBelow(new Map(), 0, 3)).toBeUndefined();
    expect(shareOfCreaturesAtOrBelow(distribution, 1, 'dynamic')).toBeUndefined();
  });

  it('bands a literal amount and keeps a computed amount in its own band', () => {
    expect(damageBandOf(1)).toBe('1');
    expect(damageBandOf(4)).toBe('4');
    expect(damageBandOf(5)).toBe('5+');
    expect(damageBandOf(9)).toBe('5+');
    expect(damageBandOf('dynamic')).toBe('dynamic');
  });

  it('records the amount and the repeatability on a damage row, and only on that bucket', () => {
    const census = removalCensus('probe', setFile([WISP, GUARD, ONE_SHOT_BURN, PINGER, DYNAMIC_BURN]));
    const rowFor = (name: string) => census.rows.find((row) => row.card === name);

    expect(rowFor('Plain Burn')).toMatchObject({ bucket: 'damage', amount: 2, repeatable: false });
    expect(rowFor('Ember Skirmisher')).toMatchObject({ bucket: 'damage', amount: 1, repeatable: true });
    expect(rowFor('Chosen Inferno')).toMatchObject({
      bucket: 'damage',
      amount: 'dynamic',
      repeatable: false,
    });
    expect(rowFor('Plain Kill')).toBeUndefined();
  });

  it('carries the pool it was read off, for a reach calculation against its own curve', () => {
    const census = removalCensus('probe', setFile([WISP, GUARD, ONE_SHOT_BURN]));

    expect(census.creatures).toBe(2);
    expect(census.toughness.get(1)).toBe(1);
    expect(census.toughness.get(4)).toBe(1);
  });

  it('prints the reach a damage band actually has against the pool it was measured on', () => {
    const table = formatRemovalCensus([
      removalCensus('narrow-format', setFile([WISP, GUARD, ONE_SHOT_BURN])),
    ]);

    // Plain Burn deals 2, and only Frail Wisp (toughness 1) is at or below it: 1 of 2 creatures.
    expect(table).toContain('amount 2');
    expect(table).toMatch(/amount 2\s+1 \(kills<=50\.0%\)/);
  });

  it('separates a repeatable source from a one-shot spell in the band totals', () => {
    const table = formatRemovalCensus([
      removalCensus('mixed-sources', setFile([WISP, GUARD, ONE_SHOT_BURN, PINGER])),
    ]);

    expect(table).toMatch(/repeatable \(activated\/trigger\)\s+1/);
    expect(table).toMatch(/one-shot \(spell\)\s+1/);
  });

  it('keeps a dynamic amount out of the toughness bands and counts it on its own line', () => {
    const table = formatRemovalCensus([removalCensus('with-x-spell', setFile([WISP, GUARD, DYNAMIC_BURN]))]);

    expect(table).toMatch(/amount dynamic\s+1/);
  });
});

describe('the command line', () => {
  it('refuses to census a pool nobody named', () => {
    expect(() => main([])).toThrow(/usage: removal-census/);
  });

  /**
   * A reduced reference set is written as `<code>/set.json`, so two of them
   * would head two columns with the same word.
   */
  it('heads a column with the directory when the file name says nothing', () => {
    expect(subjectOf('out/reference/m11/set.json')).toBe('m11');
    expect(subjectOf('fixtures/sets/tideglass-reach.set.json')).toBe('tideglass-reach');
  });
});
