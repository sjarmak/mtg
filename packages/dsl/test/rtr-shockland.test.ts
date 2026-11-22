/** Typed source text for the reusable shockland entry replacement. */
import { describe, expect, it } from 'vitest';
import { parseCard, renderOracleText, safeParseCard } from '@mtg/dsl';

function bloodCrypt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'land',
    id: 'rtr-blood-crypt',
    name: 'Blood Crypt',
    rarity: 'rare',
    set: { code: 'RTR', collectorNumber: 238 },
    subtypes: ['Swamp', 'Mountain'],
    producesMana: ['B', 'R'],
    printedEntryReference: 'thisLand',
    printedManaAbilityFirst: true,
    entryReplacement: { kind: 'payLifeOrEntersTapped', life: 2 },
    ...overrides,
  };
}

describe('shockland representation', () => {
  it('renders the bounded life choice from typed entry semantics', () => {
    const card = parseCard(bloodCrypt());

    expect(renderOracleText(card)).toBe(
      "{T}: Add {B} or {R}.\nAs this land enters, you may pay 2 life. If you don't, it enters tapped.",
    );
  });

  it('bounds the payment and keeps the replacement land-only', () => {
    expect(
      safeParseCard(bloodCrypt({ entryReplacement: { kind: 'payLifeOrEntersTapped', life: 0 } })).ok,
    ).toBe(false);
    expect(
      safeParseCard(bloodCrypt({ entryReplacement: { kind: 'payLifeOrEntersTapped', life: 21 } })).ok,
    ).toBe(false);
    expect(
      safeParseCard({
        ...bloodCrypt(),
        kind: 'artifact',
        manaCost: { generic: 2 },
        subtypes: [],
        producesMana: undefined,
      }).ok,
    ).toBe(false);
  });
});
