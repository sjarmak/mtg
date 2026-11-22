/** Exact M13 Fog Bank authoring and generator containment. */
import { describe, expect, it } from 'vitest';
import { classifyStaticModification, parseCard, renderOracleText, STATIC_MODIFICATION_KINDS } from '@mtg/dsl';
import { ModelStaticModificationSchema } from '../src/ability-shape';

const PREVENTS_COMBAT_DAMAGE = { kind: 'preventCombatDamage' as const };

function fogBank() {
  return parseCard({
    kind: 'creature',
    id: 'm13-052-fog-bank',
    name: 'Fog Bank',
    rarity: 'uncommon',
    set: { code: 'M13', collectorNumber: 52 },
    colors: ['U'],
    manaCost: { generic: 1, U: 1 },
    power: 0,
    toughness: 2,
    subtypes: ['Wall'],
    keywords: ['flying'],
    keywordAbilities: [{ kind: 'defender' }],
    keywordLineGroups: [[{ kind: 'defender' }, 'flying']],
    abilities: [
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: PREVENTS_COMBAT_DAMAGE,
      },
    ],
  });
}

describe('M13 Fog Bank authoring', () => {
  it('renders the exact prevention clause from one live static modification', () => {
    expect(renderOracleText(fogBank())).toBe(
      'Defender, flying\nPrevent all combat damage that would be dealt to and dealt by this creature.',
    );
  });

  it('classifies combat-damage prevention as an event rule rather than a layer or declaration rule', () => {
    expect(classifyStaticModification(PREVENTS_COMBAT_DAMAGE)).toBe('damagePrevention');
    expect(STATIC_MODIFICATION_KINDS).toContain('preventCombatDamage');
  });

  it('keeps the capability hand-authored and outside generator output', () => {
    expect(ModelStaticModificationSchema.safeParse(PREVENTS_COMBAT_DAMAGE).success).toBe(false);
    expect(ModelStaticModificationSchema.options.map((option) => option.shape.kind.value)).toEqual([
      'statBonus',
      'grantKeyword',
    ]);
  });

  it('requires a source layout to contain every structured keyword exactly once', () => {
    expect(() => parseCard({ ...fogBank(), keywordLineGroups: [['flying']] })).toThrow(
      /keyword line groups must contain every printed keyword and keyword ability exactly once/iu,
    );
    expect(() =>
      parseCard({
        ...fogBank(),
        keywordLineGroups: [[{ kind: 'defender' }, 'flying'], ['flying']],
      }),
    ).toThrow(/keyword line groups must contain every printed keyword and keyword ability exactly once/iu);
  });
});
