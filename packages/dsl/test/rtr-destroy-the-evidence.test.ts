/** Destroy the Evidence's atomic land-destruction and controller-library contract. */
import { describe, expect, it } from 'vitest';
import {
  CardEffectSchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  validateCard,
  type CardInput,
} from '@mtg/dsl';

const EFFECT = {
  kind: 'destroyPermanent' as const,
  controllerLibraryFollowup: 'revealUntilLandToGraveyard' as const,
  target: {
    kind: 'targetPermanent' as const,
    filter: { cardTypes: ['land' as const] },
  },
};

const DESTROY_THE_EVIDENCE = {
  kind: 'sorcery' as const,
  id: 'rtr-destroy-the-evidence',
  name: 'Destroy the Evidence',
  rarity: 'common' as const,
  set: { code: 'RTR', collectorNumber: 64 },
  manaCost: { generic: 4, B: 1 },
  colors: ['B'] as const,
  effects: [EFFECT],
};

describe('Destroy the Evidence authoring', () => {
  it('accepts the reviewed atomic bundle and renders current Oracle exactly', () => {
    expect(CardEffectSchema.safeParse(EFFECT).success).toBe(true);
    expect(renderOracleText(parseCard(DESTROY_THE_EVIDENCE as unknown as CardInput))).toBe(
      'Destroy target land. Its controller reveals cards from the top of their library until they reveal a land card, then puts those cards into their graveyard.',
    );
  });

  it('keeps the compound reveal-and-mill bundle outside generator output', () => {
    expect(ModelEffectSchema.safeParse(EFFECT).success).toBe(false);
  });

  it('refuses the rider on anything other than the exact one-land target profile', () => {
    expect(
      validateCard({
        ...DESTROY_THE_EVIDENCE,
        effects: [
          {
            kind: 'destroyPermanent',
            controllerLibraryFollowup: 'revealUntilLandToGraveyard',
            target: { kind: 'targetCreature' },
          },
        ],
      } as unknown as CardInput),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ILLEGAL_TARGET_FILTER', path: 'effects[0]' }),
      ]),
    );
  });
});
