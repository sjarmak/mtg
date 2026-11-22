/**
 * The refusal that used to arrive as a failed build.
 *
 * `mtg-1urk`. Every case here is knowable the moment a set is chosen — no
 * provider, no network, no key — so the value of the module under test is
 * entirely in *when* it says these things. The assertions are on the sentences
 * because the sentence is the whole product: it is what tells somebody which
 * set to leave out.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { PoolSet } from '../src/pool';
import { checkWorkbenchPool, poolsFor, statedCriteria } from '../src/workbench/pool-check';
import { WorkbenchCriteriaSchema } from '../src/workbench/variation';

type ManaCost = Readonly<Record<string, number>>;

function creature(setCode: string, id: string, name: string, cost: ManaCost): Card {
  return parseCard({
    kind: 'creature',
    id,
    name,
    rarity: 'common',
    set: { code: setCode, collectorNumber: 1 },
    manaCost: cost,
    colors: Object.keys(cost).filter((key) => key !== 'generic'),
    subtypes: ['Soldier'],
    power: 2,
    toughness: 2,
  } as CardInput);
}

const XMP: PoolSet = {
  code: 'XMP',
  name: 'the flagship set',
  cards: [creature('XMP', 'xmp-guard', 'Kingdom Guard', { generic: 1, W: 1 })],
};
const M11: PoolSet = {
  code: 'M11',
  name: 'Magic 2011 (reduced)',
  cards: [creature('M11', 'm11-guard', 'Kingdom Guard', { generic: 1, W: 1 })],
};
/** The same name over a card with a different cost: not a reprint. */
const M13: PoolSet = {
  code: 'M13',
  name: 'Magic 2013 (reduced)',
  cards: [creature('M13', 'm13-guard', 'Kingdom Guard', { generic: 4, W: 1 })],
};

function criteria(overrides: Record<string, unknown> = {}) {
  return WorkbenchCriteriaSchema.parse({
    prompt: 'a fast white deck',
    sets: ['XMP'],
    colors: ['W'],
    ...overrides,
  });
}

describe('checkWorkbenchPool', () => {
  it('takes a reprint as one card, which is every multi-reference-set selection', () => {
    // Measured over the four staged sets: 43 names are printed in more than one
    // of them, so refusing this refused all but a handful of selections.
    expect(checkWorkbenchPool([XMP, M11], criteria({ sets: ['XMP', 'M11'] }))).toBeNull();
  });

  it('names both sets when they print different cards under one name', () => {
    const refusal = checkWorkbenchPool([XMP, M13], criteria({ sets: ['XMP', 'M13'] }));

    expect(refusal).toContain('XMP and M13 both print Kingdom Guard');
    expect(refusal).toContain('select one of the two sets');
  });

  it('says a selection that leaves no card at all, which would build nothing', () => {
    const refusal = checkWorkbenchPool([XMP], criteria({ colors: ['U'] }));

    expect(refusal).toContain('no cards satisfy the stated criteria');
    expect(refusal).toContain('color identity within {U}');
  });

  it('judges only the sets the draft names, not every set the lab staged', () => {
    // XMP and M13 conflict; a draft naming neither pair is unaffected by that.
    expect(checkWorkbenchPool([XMP, M13], criteria({ sets: ['XMP'] }))).toBeNull();
  });
});

describe('poolsFor', () => {
  it('keeps the launcher order rather than the order the codes were named', () => {
    // The order decides which printing of a reprint a game is dealt, so the
    // check and the build have to read it the same way.
    expect(poolsFor([XMP, M11], ['M11', 'XMP']).map((pool) => pool.code)).toStrictEqual(['XMP', 'M11']);
  });
});

describe('statedCriteria', () => {
  it('carries no field a person did not state', () => {
    expect(statedCriteria(criteria())).toStrictEqual({
      prompt: 'a fast white deck',
      sets: ['XMP'],
      colors: ['W'],
      size: 60,
      maxCopies: 4,
      themes: [],
    });
  });

  it('carries the optional ones through when they were stated', () => {
    const opponentPopulation = {
      id: 'local-field',
      members: [{ id: 'pressure', share: 1, strategy: 'curve out with creatures' }],
    };
    const stated = statedCriteria(
      criteria({ landCount: 24, archetype: 'aggro', maxManaValue: 3, opponentPopulation }),
    );

    expect(stated).toMatchObject({
      landCount: 24,
      archetype: 'aggro',
      maxManaValue: 3,
      opponentPopulation,
    });
    expect(stated.opponentPopulation).not.toBe(opponentPopulation);
  });
});
