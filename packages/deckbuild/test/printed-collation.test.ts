import { describe, expect, it } from 'vitest';
import { openCollatedPool, SealedPoolError, withoutBasicLandIds } from '../src/index';
import type { PackCollation } from '../src/index';

const printings = [
  { id: 'AKH:1', name: 'Shared name', source: 'AKH' },
  { id: 'HOU:1', name: 'Shared name', source: 'HOU' },
  { id: 'MP2:1', name: 'Invocation', source: 'MP2' },
  { id: 'HOU:2', name: 'Plains', source: 'HOU' },
];
const collation: PackCollation = {
  sheets: [
    { name: 'common', weights: { 'HOU:1': 1 }, foil: false },
    { name: 'basic', weights: { 'HOU:2': 1 }, foil: false },
    { name: 'foil', weights: { 'HOU:1': 10, 'HOU:2': 1, 'MP2:1': 1 }, foil: true },
  ],
  boosters: [{ contents: { common: 1, basic: 1, foil: 1 }, weight: 1 }],
};

describe('representation-neutral printed collation', () => {
  it('retains source-qualified payloads and per-slot foil provenance without a DSL conversion', () => {
    const opened = openCollatedPool(printings, collation, { seed: 'printed', boosters: 100 });
    expect(opened.cards.some((card) => card.source === 'MP2')).toBe(true);
    expect(opened.cards.some((card) => card.source === 'AKH')).toBe(false);
    expect(opened.boosters.some((cards) => cards[0]?.id === cards[2]?.id)).toBe(true);
    expect(opened.provenance).toEqual({
      kind: 'sheets',
      slots: Array.from({ length: 100 }, () => [
        { sheet: 'common', foil: false },
        { sheet: 'basic', foil: false },
        { sheet: 'foil', foil: true },
      ]),
    });
    expect(openCollatedPool(printings, collation, { seed: 'printed', boosters: 100 })).toEqual(opened);
  });

  it('uses the existing explicit no-basics transform for printed identities', () => {
    const [dealt, removal] = withoutBasicLandIds(collation, new Set(['HOU:2']));
    expect(removal).toEqual({
      droppedSheets: ['basic'],
      thinnedSheets: ['foil'],
      unfillableBoosters: 0,
      printedPackSizes: [3],
      dealtPackSizes: [2],
    });
    const opened = openCollatedPool(printings, dealt, { seed: 'printed', boosters: 100 });
    expect(opened.cards.some((card) => card.name === 'Plains')).toBe(false);
    expect(opened.cards.some((card) => card.source === 'MP2')).toBe(true);
    expect(collation.boosters[0]?.contents['basic']).toBe(1);
  });

  it('refuses duplicate printing IDs instead of silently replacing one source payload', () => {
    expect(() =>
      openCollatedPool([...printings, { id: 'HOU:1', name: 'Different printing', source: 'AKH' }], collation),
    ).toThrow(/duplicate card id/);
  });

  it('refuses unresolved foreign-source sheet entries instead of renormalizing them away', () => {
    expect(() =>
      openCollatedPool(
        printings.filter((card) => card.source !== 'MP2'),
        collation,
      ),
    ).toThrow(/MP2:1/);
  });

  it('rejects non-finite combined booster weights', () => {
    expect(() =>
      openCollatedPool(printings, {
        ...collation,
        boosters: [
          { contents: { common: 1 }, weight: Number.MAX_SAFE_INTEGER },
          { contents: { common: 1 }, weight: Number.MAX_SAFE_INTEGER },
        ],
      }),
    ).toThrow(SealedPoolError);
  });
});
