/** Engine-only source animation for the five Return to Ravnica Keyrunes. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard } from '@mtg/dsl';

const animateBird = {
  kind: 'animateSourceUntilEndOfTurn',
  power: 2,
  toughness: 2,
  colors: ['W', 'U'],
  subtypes: ['Bird'],
  keywords: ['flying'],
  target: { kind: 'selfPermanent' },
} as const;

describe('an RTR Keyrune animation', () => {
  it('prints the exact Azorius mana and animation lines outside model output', () => {
    const card = parseCard({
      kind: 'artifact',
      id: 'rtr-225',
      name: 'Azorius Keyrune',
      rarity: 'uncommon',
      set: { code: 'RTR', collectorNumber: 225 },
      manaCost: { generic: 3 },
      colors: [],
      subtypes: [],
      abilities: [
        {
          kind: 'activated',
          cost: { mana: {}, tapSelf: true },
          effects: [{ kind: 'addMana', produces: ['W', 'U'], amount: 1 }],
        },
        {
          kind: 'activated',
          printedSourceReference: 'thisArtifact',
          cost: { mana: { W: 1, U: 1 }, tapSelf: false },
          effects: [animateBird],
        },
      ],
    });

    expect(renderOracleText(card)).toBe(
      '{T}: Add {W} or {U}.\n{W}{U}: This artifact becomes a 2/2 white and blue Bird artifact creature with flying until end of turn.',
    );
    expect(ModelEffectSchema.safeParse(animateBird).success).toBe(false);
  });

  it('can retain the source-attested duration-first wording without changing semantics', () => {
    const result = parseCard({
      kind: 'artifact',
      id: 'rtr-230',
      name: 'Izzet Keyrune',
      rarity: 'uncommon',
      set: { code: 'RTR', collectorNumber: 230 },
      manaCost: { generic: 3 },
      colors: [],
      subtypes: [],
      abilities: [
        {
          kind: 'activated',
          printedSourceReference: 'thisArtifact',
          cost: { mana: { U: 1, R: 1 }, tapSelf: false },
          effects: [
            {
              ...animateBird,
              toughness: 1,
              colors: ['U', 'R'],
              subtypes: ['Elemental'],
              keywords: [],
              printedDurationFirst: true,
            },
          ],
        },
        {
          kind: 'triggered',
          condition: 'selfDealsCombatDamageToPlayer',
          printedSourceReference: 'thisArtifact',
          optional: true,
          effects: [
            { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
            { kind: 'discardCards', count: 1, target: { kind: 'noTarget' } },
          ],
        },
      ],
    });

    expect(renderOracleText(result)).toBe(
      '{U}{R}: Until end of turn, this artifact becomes a 2/1 blue and red Elemental artifact creature.\nWhenever this artifact deals combat damage to a player, you may draw a card. If you do, discard a card.',
    );
  });

  it('refuses animation outside a subtype-free artifact battlefield activation', () => {
    const subtypeArtifact = safeParseCard({
      kind: 'artifact',
      id: 'typed-relic',
      name: 'Typed Relic',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { generic: 3 },
      colors: [],
      subtypes: ['Keyrune'],
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { W: 1, U: 1 } },
          effects: [animateBird],
        },
      ],
    });
    const triggered = safeParseCard({
      kind: 'artifact',
      id: 'triggered-relic',
      name: 'Triggered Relic',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: { generic: 3 },
      colors: [],
      subtypes: [],
      abilities: [{ kind: 'triggered', condition: 'selfEnters', effects: [animateBird] }],
    });

    expect(subtypeArtifact.ok).toBe(false);
    expect(triggered.ok).toBe(false);
    if (subtypeArtifact.ok || triggered.ok) throw new Error('illegal animation unexpectedly parsed');
    expect(subtypeArtifact.violations.map((violation) => violation.code)).toContain(
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
    );
    expect(triggered.violations.map((violation) => violation.code)).toContain('ABILITY_ILLEGAL_ON_CARD_TYPE');
  });

  it('refuses an artifact source label on a creature and near-miss optional sequences', () => {
    const wrongReference = safeParseCard({
      kind: 'creature',
      id: 'wrong-reference',
      name: 'Wrong Reference',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 3 },
      manaCost: { U: 1 },
      colors: ['U'],
      subtypes: ['Wizard'],
      power: 1,
      toughness: 1,
      abilities: [
        {
          kind: 'activated',
          printedSourceReference: 'thisArtifact',
          cost: { mana: { U: 1 } },
          effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
        },
      ],
    });
    const nearMiss = safeParseCard({
      kind: 'artifact',
      id: 'near-miss-loot',
      name: 'Near-Miss Loot',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 4 },
      manaCost: { generic: 3 },
      colors: [],
      subtypes: [],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfDealsCombatDamageToPlayer',
          optional: true,
          effects: [
            { kind: 'drawCards', count: 2, target: { kind: 'noTarget' } },
            { kind: 'discardCards', count: 1, target: { kind: 'noTarget' } },
          ],
        },
      ],
    });

    expect(wrongReference.ok).toBe(false);
    expect(nearMiss.ok).toBe(false);
    if (wrongReference.ok || nearMiss.ok) throw new Error('invalid source wording unexpectedly parsed');
    expect(wrongReference.violations.map((violation) => violation.code)).toContain(
      'ABILITY_ILLEGAL_ON_CARD_TYPE',
    );
    expect(nearMiss.violations.map((violation) => violation.code)).toContain('OPTIONAL_TRIGGER_INVALID');
  });
});
