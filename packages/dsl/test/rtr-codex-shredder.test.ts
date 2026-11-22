import { describe, expect, it } from 'vitest';
import {
  CardEffectSchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  validateCard,
  type CardInput,
} from '@mtg/dsl';

const MILL = {
  kind: 'millCards',
  count: 1,
  target: { kind: 'targetPlayer' },
  printedOneCardReminder: true,
} as const;

const CODEX_SHREDDER = {
  kind: 'artifact',
  id: 'rtr-228-codex-shredder',
  name: 'Codex Shredder',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 228 },
  manaCost: { generic: 1 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [MILL],
    },
    {
      kind: 'activated',
      printedSourceReference: 'thisArtifact',
      cost: { mana: { generic: 5 }, tapSelf: true, sacrificeSelf: true },
      effects: [{ kind: 'returnToHand', target: { kind: 'targetCardInYourGraveyard' } }],
    },
  ],
} as unknown as CardInput;

describe('RTR #228 Codex Shredder', () => {
  it('renders current Oracle with the one-card mill reminder and source-kind sacrifice', () => {
    expect(renderOracleText(parseCard(CODEX_SHREDDER))).toBe(
      [
        '{T}: Target player mills a card. (They put the top card of their library into their graveyard.)',
        '{5}, {T}, Sacrifice this artifact: Return target card from your graveyard to your hand.',
      ].join('\n'),
    );
  });

  it('keeps the source-attested reminder outside the generator vocabulary', () => {
    expect(CardEffectSchema.safeParse(MILL).success).toBe(true);
    expect(ModelEffectSchema.safeParse(MILL).success).toBe(false);
  });

  it('refuses the one-card reminder on any other mill count', () => {
    expect(
      validateCard({
        ...CODEX_SHREDDER,
        abilities: [
          {
            ...CODEX_SHREDDER.abilities![0]!,
            effects: [{ ...MILL, count: 2 }],
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MILL_PRESENTATION_INVALID',
          path: 'abilities[0].effects[0].printedOneCardReminder',
        }),
      ]),
    );
  });
});
