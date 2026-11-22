/** Closed retained-color entry and cast-trigger bundle for RTR Tablet of the Guilds. */
import { describe, expect, it } from 'vitest';
import {
  ModelAbilitySchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  type CardInput,
} from '../src/index';

const TABLET_TRIGGER = {
  kind: 'triggered',
  condition: 'youCastSpell',
  spellSharesChosenColors: true,
  printedSourceReference: 'thisArtifact',
  effects: [
    {
      kind: 'gainLife',
      amount: { kind: 'triggeringSpellChosenColorCount' },
      target: { kind: 'noTarget' },
    },
  ],
} as const;

function tabletInput(overrides: Partial<CardInput> = {}): CardInput {
  return {
    kind: 'artifact',
    id: 'rtr-235-tablet-of-the-guilds',
    name: 'Tablet of the Guilds',
    rarity: 'uncommon',
    set: { code: 'RTR', collectorNumber: 235 },
    manaCost: { generic: 2 },
    colors: [],
    entryReplacement: { kind: 'chooseTwoColors' },
    abilities: [TABLET_TRIGGER],
    ...overrides,
  } as CardInput;
}

describe('Tablet of the Guilds DSL', () => {
  it('renders the exact current Oracle paragraphs', () => {
    expect(renderOracleText(parseCard(tabletInput()))).toBe(
      "As this artifact enters, choose two colors.\nWhenever you cast a spell, if it's at least one of the chosen colors, you gain 1 life for each of the chosen colors it is.",
    );
  });

  it('keeps the coupled retained-color capability outside generator schemas', () => {
    parseCard(tabletInput());
    expect(ModelAbilitySchema.safeParse(TABLET_TRIGGER).success).toBe(false);
    expect(ModelEffectSchema.safeParse(TABLET_TRIGGER.effects[0]).success).toBe(false);
  });

  it('refuses widened placement, trigger, and effect shapes', () => {
    expect(() => parseCard({ ...tabletInput(), kind: 'creature', power: 1, toughness: 1 })).toThrow(
      /chooseTwoColors|entryReplacement/u,
    );
    expect(() =>
      parseCard({
        ...tabletInput(),
        abilities: [{ ...TABLET_TRIGGER, condition: 'beginningOfYourUpkeep' }],
      }),
    ).toThrow(/spellSharesChosenColors|youCastSpell/u);
    expect(() =>
      parseCard({
        ...tabletInput(),
        abilities: [
          {
            ...TABLET_TRIGGER,
            effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
          },
        ],
      }),
    ).toThrow(/triggeringSpellChosenColorCount|spellSharesChosenColors/u);
    expect(() =>
      parseCard({ ...tabletInput(), entryReplacement: undefined, abilities: [TABLET_TRIGGER] }),
    ).toThrow(/chooseTwoColors|spellSharesChosenColors/u);
  });
});
