/** Closed retained-name entry and activation-rule bundle for RTR Pithing Needle. */
import { describe, expect, it } from 'vitest';
import { AbilitySchema, ModelAbilitySchema, parseCard, renderOracleText, type CardInput } from '../src/index';

const NEEDLE_RULE = {
  kind: 'staticActivationRule',
  rule: 'chosenNameNonManaAbilitiesCantActivate',
} as const;

function needleInput(overrides: Partial<CardInput> = {}): CardInput {
  return {
    kind: 'artifact',
    id: 'rtr-231-pithing-needle',
    name: 'Pithing Needle',
    rarity: 'rare',
    set: { code: 'RTR', collectorNumber: 231 },
    manaCost: { generic: 1 },
    colors: [],
    entryReplacement: { kind: 'chooseCardName' },
    abilities: [NEEDLE_RULE],
    ...overrides,
  } as CardInput;
}

describe('Pithing Needle DSL', () => {
  it('renders both exact current Oracle paragraphs in source order', () => {
    expect(renderOracleText(parseCard(needleInput()))).toBe(
      "As this artifact enters, choose a card name.\nActivated abilities of sources with the chosen name can't be activated unless they're mana abilities.",
    );
  });

  it('keeps one atomic activation-rule kind outside the model vocabulary', () => {
    expect(AbilitySchema.parse(NEEDLE_RULE)).toEqual(NEEDLE_RULE);
    expect(ModelAbilitySchema.safeParse(NEEDLE_RULE).success).toBe(false);
  });

  it('refuses the entry choice and live rule when either half or placement is widened', () => {
    expect(() => parseCard({ ...needleInput(), entryReplacement: undefined })).toThrow(
      /chooseCardName|staticActivationRule/u,
    );
    expect(() => parseCard({ ...needleInput(), abilities: [] })).toThrow(
      /chooseCardName|staticActivationRule/u,
    );
    expect(() => parseCard({ ...needleInput(), kind: 'creature', power: 1, toughness: 1 })).toThrow(
      /chooseCardName|entryReplacement/u,
    );
  });
});
