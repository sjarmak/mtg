import { describe, expect, it } from 'vitest';
import { buildPrintedBoosterProduct } from '../src/printed-card/booster-product';

const a = '00000000-0000-0000-0000-000000000001';
const b = '00000000-0000-0000-0000-000000000002';
const c = '00000000-0000-0000-0000-000000000003';
const booster = {
  sourceSetCodes: ['AKH', 'MP2'],
  boostersTotalWeight: 40,
  boosters: [
    { weight: 31, contents: { common: 1 } },
    { weight: 9, contents: { invocation: 1 } },
  ],
  sheets: {
    common: { cards: { [a]: 1, [b]: 2 }, totalWeight: 3, foil: false },
    invocation: { cards: { [c]: 1 }, totalWeight: 1, foil: true },
  },
};
const sources = [
  {
    code: 'AKH',
    uuidToPhysicalId: new Map([
      [a, 'akh:1'],
      [b, 'akh:1'],
    ]),
  },
  { code: 'MP2', uuidToPhysicalId: new Map([[c, 'mp2:1']]) },
];

describe('source-qualified printed booster products', () => {
  it('preserves weighted foil slots and combines aliases of one physical printing', () => {
    expect(buildPrintedBoosterProduct('akh-draft', 'AKH', booster, sources)).toEqual({
      id: 'akh-draft',
      setCode: 'AKH',
      sourceSetCodes: ['AKH', 'MP2'],
      collation: {
        boosters: booster.boosters,
        sheets: [
          { name: 'common', weights: { 'akh:1': 3 }, foil: false },
          { name: 'invocation', weights: { 'mp2:1': 1 }, foil: true },
        ],
      },
    });
  });
  it('rejects unresolved or undeclared auxiliary cards rather than dropping them', () => {
    expect(() => buildPrintedBoosterProduct('akh-draft', 'AKH', booster, sources.slice(0, 1))).toThrow(
      /missing source/,
    );
    expect(() =>
      buildPrintedBoosterProduct('akh-draft', 'AKH', { ...booster, sourceSetCodes: ['AKH'] }, sources),
    ).toThrow(/unresolved UUID/);
  });
  it('checks the publisher sheet and configuration totals before normalization', () => {
    expect(() =>
      buildPrintedBoosterProduct('akh-draft', 'AKH', { ...booster, boostersTotalWeight: 41 }, sources),
    ).toThrow(/booster total/);
    expect(() =>
      buildPrintedBoosterProduct(
        'akh-draft',
        'AKH',
        { ...booster, sheets: { common: { ...booster.sheets.common, totalWeight: 4 } } },
        sources,
      ),
    ).toThrow(/sheet total/);
  });
});
