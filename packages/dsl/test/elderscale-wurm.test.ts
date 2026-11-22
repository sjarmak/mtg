/** Elderscale Wurm's intervening-if trigger and controller life-floor replacement. */
import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, parseCard, renderOracleText } from '@mtg/dsl';

const ENTRY_ABILITY = {
  kind: 'triggered' as const,
  condition: 'selfEnters' as const,
  interveningIf: { kind: 'controllerLifeBelow' as const, fewerThan: 7 },
  effects: [{ kind: 'setLife' as const, amount: 7 }],
};

const FLOOR_ABILITY = {
  kind: 'static' as const,
  scope: 'self' as const,
  subtype: null,
  modification: { kind: 'damageCannotReduceControllerLifeBelow' as const, minimum: 7 },
};

const ELDERSCALE_WURM = {
  kind: 'creature' as const,
  id: 'm13-elderscale-wurm',
  name: 'Elderscale Wurm',
  rarity: 'mythic' as const,
  set: { code: 'M13', collectorNumber: 167 },
  colors: ['G'] as const,
  manaCost: { generic: 4, G: 3 },
  power: 7,
  toughness: 7,
  subtypes: ['Wurm'],
  keywords: ['trample'] as const,
  abilities: [ENTRY_ABILITY, FLOOR_ABILITY],
};

describe('Elderscale Wurm authoring', () => {
  it('prints the exact current Oracle text', () => {
    expect(renderOracleText(parseCard(ELDERSCALE_WURM))).toBe(
      'Trample\nWhen Elderscale Wurm enters the battlefield, if your life total is less than 7, your life total becomes 7.\nAs long as you have 7 or more life, damage that would reduce your life total to less than 7 reduces it to 7 instead.',
    );
  });

  it('keeps both hand-authored capabilities outside model output', () => {
    expect(ModelAbilitySchema.safeParse(ENTRY_ABILITY).success).toBe(false);
    expect(ModelAbilitySchema.safeParse(FLOOR_ABILITY).success).toBe(false);
  });
});
