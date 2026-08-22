import { describe, expect, it } from 'vitest';
import {
  BASIC_LANDS,
  parseCard,
  renderOracleText,
  renderTypeLine,
  safeParseCard,
  validateCard,
} from '@mtg/dsl';

const SET = { code: 'M13', collectorNumber: 221 } as const;

function checkland(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'land',
    id: 'm13-dragonskull-summit',
    name: 'Dragonskull Summit',
    rarity: 'rare',
    set: SET,
    producesMana: ['B', 'R'],
    entryReplacement: {
      kind: 'entersTappedUnlessControlsLandSubtype',
      landTypes: ['Swamp', 'Mountain'],
    },
    ...overrides,
  };
}

describe('nonbasic land representation', () => {
  it('keeps Basic separate from having a basic land type', () => {
    const dualTyped = parseCard(
      checkland({
        id: 'tst-marsh-isle',
        name: 'Marsh Isle',
        subtypes: ['Swamp', 'Island'],
        entryReplacement: undefined,
        producesMana: ['U', 'B'],
      }),
    );

    expect(dualTyped.supertypes).not.toContain('basic');
    expect(renderTypeLine(dualTyped)).toBe('Land — Swamp Island');
    expect('basicLandType' in dualTyped).toBe(false);

    const island = BASIC_LANDS.find((card) => card.name === 'Island');
    expect(island?.supertypes).toContain('basic');
    expect(island === undefined ? '' : renderTypeLine(island)).toBe('Basic Land — Island');
  });

  it('renders both checkland paragraphs from typed semantics', () => {
    const card = parseCard(checkland());
    expect(renderOracleText(card)).toBe(
      'Dragonskull Summit enters tapped unless you control a Swamp or a Mountain.\n{T}: Add {B} or {R}.',
    );
  });

  it('keeps colorless mana distinct from a generic cost', () => {
    const tower = parseCard({
      kind: 'land',
      id: 'm13-reliquary-tower-probe',
      name: 'Reliquary Tower Probe',
      rarity: 'uncommon',
      set: { code: 'M13', collectorNumber: 227 },
      producesMana: ['C'],
    });
    expect(renderOracleText(tower)).toBe('{T}: Add {C}.');
    expect(tower.kind === 'land' ? tower.producesMana : []).toEqual(['C']);
  });

  it('bounds and deduplicates printed mana choices and checkland conditions', () => {
    expect(safeParseCard(checkland({ producesMana: ['B', 'R', 'B'] })).ok).toBe(false);
    expect(
      safeParseCard(
        checkland({
          entryReplacement: {
            kind: 'entersTappedUnlessControlsLandSubtype',
            landTypes: ['Swamp', 'Mountain', 'Island'],
          },
        }),
      ).ok,
    ).toBe(false);
    expect(
      validateCard(
        checkland({
          entryReplacement: {
            kind: 'entersTappedUnlessControlsLandSubtype',
            landTypes: ['Swamp', 'Swamp'],
          },
        }),
      ).some((finding) => finding.code === 'LAND_ENTRY_CONDITION_INVALID'),
    ).toBe(true);
  });

  it('requires Basic lands to name exactly their own basic land type and mana', () => {
    expect(
      validateCard(checkland({ supertypes: ['basic'] })).some(
        (finding) => finding.code === 'LAND_BASIC_TYPE_MISMATCH',
      ),
    ).toBe(true);
    expect(
      validateCard({
        ...checkland(),
        supertypes: ['basic'],
        basicLandType: 'Swamp',
        subtypes: [],
        producesMana: ['B', 'R'],
      }).some((finding) => finding.code === 'LAND_MANA_MISMATCH'),
    ).toBe(true);
    expect(
      validateCard({
        ...checkland(),
        supertypes: ['basic'],
        basicLandType: 'Island',
        subtypes: ['Swamp'],
        producesMana: ['U'],
      }).some((finding) => finding.code === 'LAND_BASIC_TYPE_MISMATCH'),
    ).toBe(true);
  });
});
