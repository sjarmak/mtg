/** Sublime Archangel's live layer-6 grant of a complete triggered ability. */
import { describe, expect, it } from 'vitest';
import {
  ModelAbilitySchema,
  StaticModificationSchema,
  TokenAbilitySchema,
  exaltedAbility,
  parseCard,
  renderOracleText,
} from '@mtg/dsl';
import { ModelStaticModificationSchema } from '../src/ability-shape';

export const SUBLIME_ARCHANGEL = {
  kind: 'creature',
  id: 'm13-sublime-archangel',
  name: 'Sublime Archangel',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 36 },
  manaCost: { generic: 2, W: 2 },
  colors: ['W'],
  subtypes: ['Angel'],
  keywords: ['flying'],
  abilities: [
    exaltedAbility(),
    {
      kind: 'static',
      scope: 'otherCreaturesYouControl',
      subtype: null,
      modification: { kind: 'grantTriggeredAbility', ability: exaltedAbility() },
    },
  ],
  power: 4,
  toughness: 3,
} as const;

describe('Sublime Archangel DSL vocabulary', () => {
  it('parses and renders the exact rules-bearing Oracle text', () => {
    const card = parseCard(SUBLIME_ARCHANGEL);
    expect(renderOracleText(card)).toBe('Flying\nExalted\nOther creatures you control have exalted.');
  });

  it('types a whole granted trigger while keeping every model-facing schema frozen', () => {
    const modification = {
      kind: 'grantTriggeredAbility',
      ability: exaltedAbility(),
    } as const;
    expect(StaticModificationSchema.safeParse(modification).success).toBe(true);
    expect(ModelStaticModificationSchema.safeParse(modification).success).toBe(false);
    expect(
      ModelAbilitySchema.safeParse({
        kind: 'static',
        scope: 'otherCreaturesYouControl',
        subtype: null,
        modification,
      }).success,
    ).toBe(false);
  });

  it('keeps the engine-only grant available to typed token abilities', () => {
    expect(
      TokenAbilitySchema.safeParse({
        kind: 'static',
        scope: 'otherCreaturesYouControl',
        subtype: null,
        modification: {
          kind: 'grantTriggeredAbility',
          ability: exaltedAbility(),
        },
      }).success,
    ).toBe(true);
  });
});
