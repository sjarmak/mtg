/** Exact M13 Void Stalker authoring and generator containment. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import {
  CardEffectSchema,
  ModelEffectSchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  validateCard,
} from '@mtg/dsl';

const EFFECT = {
  kind: 'putSourceAndTargetOnOwnersLibrariesThenShuffle',
  target: { kind: 'targetCreature' },
} as const;

const INPUT = {
  kind: 'creature',
  id: 'm13-77',
  name: 'Void Stalker',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 77 },
  manaCost: { generic: 1, U: 1 },
  colors: ['U'],
  subtypes: ['Elemental'],
  power: 2,
  toughness: 1,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2, U: 1 }, tapSelf: true },
      effects: [EFFECT],
    },
  ],
} as CardInput;

describe('Void Stalker authoring', () => {
  it('accepts and renders the exact current Oracle line', () => {
    expect(CardEffectSchema.parse(EFFECT)).toEqual(EFFECT);
    const card = parseCard(INPUT);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "{2}{U}, {T}: Put this creature and target creature on top of their owners' libraries, then those players shuffle their libraries.",
    );
  });

  it('keeps the atomic owner-and-shuffle operation outside the model schema', () => {
    expect(ModelEffectSchema.safeParse(EFFECT).success).toBe(false);
  });

  it('rejects the retained-source operation on a resolving spell', () => {
    const result = safeParseCard({
      kind: 'sorcery',
      id: 'void-stalker-spell',
      name: 'Void Stalker Spell',
      rarity: 'rare',
      set: { code: 'TEST', collectorNumber: 1 },
      manaCost: { generic: 3 },
      effects: [EFFECT],
    });

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.violations.map((violation) => violation.code)).toContain('EFFECT_ILLEGAL_ON_CARD_TYPE');
  });
});
