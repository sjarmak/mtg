/** RTR Populate is executable hand-authored vocabulary, never model output. */
import { describe, expect, it } from 'vitest';
import { CardEffectSchema, ModelEffectSchema, parseCard, renderEffectList, renderOracleText } from '@mtg/dsl';

describe('typed Populate', () => {
  it('accepts the one atomic non-targeting effect and no payload variants', () => {
    expect(CardEffectSchema.parse({ kind: 'populate' })).toEqual({ kind: 'populate' });
    expect(CardEffectSchema.safeParse({ kind: 'populate', target: { kind: 'targetCreature' } }).success).toBe(
      false,
    );
  });

  it('keeps Populate outside the model-facing generator schema', () => {
    expect(ModelEffectSchema.safeParse({ kind: 'populate' }).success).toBe(false);
  });

  it('renders current Oracle wording in authored order', () => {
    const card = parseCard({
      kind: 'instant',
      id: 'rtr-rootborn-defenses-shape',
      name: 'Rootborn Defenses Shape',
      rarity: 'common',
      set: { code: 'RTR', collectorNumber: 19 },
      manaCost: { generic: 2, W: 1 },
      colors: ['W'],
      effects: [
        { kind: 'populate' },
        {
          kind: 'grantKeywordUntilEndOfTurn',
          keyword: 'indestructible',
          target: { kind: 'noTarget' },
          scope: 'permanentsYouControl',
          scopeFilter: { cardTypes: ['creature'] },
        },
      ],
    });

    expect(renderOracleText(card)).toBe(
      'Populate. Creatures you control gain indestructible until end of turn.',
    );
  });

  it('compounds the three printed setup actions with a following Populate', () => {
    expect(
      renderEffectList(
        [
          {
            kind: 'createToken',
            count: 1,
            token: {
              name: 'Bird',
              power: 1,
              toughness: 1,
              colors: ['W'],
              subtypes: ['Bird'],
              keywords: ['flying'],
            },
          },
          { kind: 'populate' },
        ],
        'Eyes in the Skies',
      ),
    ).toEqual(['Create a 1/1 white Bird creature token with flying, then populate.']);
    expect(
      renderEffectList(
        [{ kind: 'exileTarget', target: { kind: 'targetCreature' } }, { kind: 'populate' }],
        "Trostani's Judgment",
      ),
    ).toEqual(['Exile target creature, then populate.']);
    expect(
      renderEffectList(
        [{ kind: 'destroyPermanent', target: { kind: 'targetArtifactOrEnchantment' } }, { kind: 'populate' }],
        'Sundering Growth',
      ),
    ).toEqual(['Destroy target artifact or enchantment, then populate.']);
  });
});
