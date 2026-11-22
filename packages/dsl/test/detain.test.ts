/** RTR Detain's hand-authored effect, target vocabulary, and exact reminder text. */
import { describe, expect, it } from 'vitest';
import {
  ALL_EFFECT_KINDS,
  legalTargetsFor,
  ModelEffectSchema,
  ModelAbilitySchema,
  ModelTargetSpecSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  UNPRICED_EFFECT_KINDS,
} from '@mtg/dsl';

describe('Detain authoring', () => {
  it('prints the singular creature wording and reminder exactly', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'rtr-inaction-injunction',
      name: 'Inaction Injunction',
      rarity: 'common',
      set: { code: 'RTR', collectorNumber: 41 },
      colors: ['U'],
      manaCost: { generic: 1, U: 1 },
      effects: [
        { kind: 'detainPermanent', target: { kind: 'targetCreatureOpponentControls' } },
        { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
      ],
      printedEffectParagraphBreaks: [1],
    });

    expect(renderOracleText(card)).toBe(
      [
        "Detain target creature an opponent controls. (Until your next turn, that creature can't attack or block and its activated abilities can't be activated.)",
        'Draw a card.',
      ].join('\n'),
    );
  });

  it('refuses paragraph breaks outside the spell effect list', () => {
    const result = safeParseCard({
      kind: 'sorcery',
      id: 'rtr-inaction-injunction',
      name: 'Inaction Injunction',
      rarity: 'common',
      set: { code: 'RTR', collectorNumber: 41 },
      colors: ['U'],
      manaCost: { generic: 1, U: 1 },
      effects: [
        { kind: 'detainPermanent', target: { kind: 'targetCreatureOpponentControls' } },
        { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
      ],
      printedEffectParagraphBreaks: [2],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations).toContainEqual(
        expect.objectContaining({ code: 'EFFECT_PARAM_OUT_OF_RANGE' }),
      );
    }
  });

  it('prints a hand-authored self static with modern source wording', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'rtr-soulsworn-spirit',
      name: 'Soulsworn Spirit',
      rarity: 'uncommon',
      set: { code: 'RTR', collectorNumber: 51 },
      colors: ['U'],
      manaCost: { generic: 3, U: 1 },
      power: 2,
      toughness: 1,
      subtypes: ['Spirit'],
      abilities: [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          printedSubjectReference: 'thisCreature',
          modification: { kind: 'cantBeBlocked' },
        },
      ],
    });

    expect(renderOracleText(card)).toBe("This creature can't be blocked.");
    expect(ModelAbilitySchema.safeParse(card.abilities[0]).success).toBe(false);
  });

  it('prints up to two nonland permanents with plural reminder agreement', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'rtr-archon-of-the-triumvirate',
      name: 'Archon of the Triumvirate',
      rarity: 'rare',
      set: { code: 'RTR', collectorNumber: 142 },
      colors: ['W', 'U'],
      manaCost: { generic: 5, W: 1, U: 1 },
      power: 4,
      toughness: 5,
      subtypes: ['Archon'],
      keywords: ['flying'],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfAttacks',
          effects: [
            {
              kind: 'detainPermanent',
              target: { kind: 'targetNonlandPermanentOpponentControls', count: 2 },
            },
          ],
        },
      ],
    });

    expect(renderOracleText(card)).toContain(
      "detain up to two target nonland permanents your opponents control. (Until your next turn, those permanents can't attack or block and their activated abilities can't be activated.)",
    );
  });

  it('keeps both the effect and opponent-permanent target outside model output', () => {
    const effect = {
      kind: 'detainPermanent' as const,
      target: { kind: 'targetNonlandPermanentOpponentControls' as const },
    };
    expect(ALL_EFFECT_KINDS).toContain(effect.kind);
    expect(UNPRICED_EFFECT_KINDS).toContain(effect.kind);
    expect([...legalTargetsFor(effect.kind)]).toEqual([
      'targetCreatureOpponentControls',
      'targetNonlandPermanentOpponentControls',
    ]);
    expect(ModelEffectSchema.safeParse(effect).success).toBe(false);
    expect(ModelTargetSpecSchema.safeParse(effect.target).success).toBe(false);
  });
});
