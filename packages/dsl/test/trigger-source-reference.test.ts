/** Hand-authored triggers may retain modern Oracle's source-generic creature reference. */
import { describe, expect, it } from 'vitest';
import {
  AttachingMechanicModelAbilitySchema,
  AttachingModelAbilitySchema,
  MechanicModelAbilitySchema,
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  safeParseCard,
  type CardInput,
} from '../src/index';

function creatureTrigger(overrides: Record<string, unknown> = {}): CardInput {
  return {
    kind: 'creature',
    id: 'rtr-wayfaring-temple-reference',
    name: 'Wayfaring Temple',
    rarity: 'rare',
    set: { code: 'RTR', collectorNumber: 209 },
    manaCost: { generic: 1, G: 1, W: 1 },
    colors: ['G', 'W'],
    subtypes: ['Elemental'],
    power: 2,
    toughness: 2,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfDealsCombatDamageToPlayer',
        effects: [{ kind: 'populate' }],
        ...overrides,
      },
    ],
  } as CardInput;
}

describe('trigger source presentation reference', () => {
  it('prints a validated creature-generic source reference without changing the trigger condition', () => {
    const card = parseCard(creatureTrigger({ printedSourceReference: 'thisCreature' }));
    expect(card.abilities[0]).toEqual(
      expect.objectContaining({
        condition: 'selfDealsCombatDamageToPlayer',
        printedSourceReference: 'thisCreature',
      }),
    );
    expect(renderOracleText(card)).toBe('Whenever this creature deals combat damage to a player, populate.');
  });

  it('keeps the historical card-name rendering and parsed shape when the override is absent', () => {
    const card = parseCard(creatureTrigger());
    expect(card.abilities[0]).not.toHaveProperty('printedSourceReference');
    expect(renderOracleText(card)).toBe(
      'Whenever Wayfaring Temple deals combat damage to a player, populate.',
    );
  });

  it('refuses the creature phrase on noncreatures and conditions with no source slot', () => {
    const enchantment = safeParseCard({
      ...creatureTrigger({ printedSourceReference: 'thisCreature' }),
      kind: 'enchantment',
      power: undefined,
      toughness: undefined,
      subtypes: [],
    });
    expect(enchantment.ok).toBe(false);
    if (enchantment.ok) throw new Error('noncreature source reference unexpectedly parsed');
    expect(enchantment.violations).toContainEqual(
      expect.objectContaining({
        code: 'ABILITY_ILLEGAL_ON_CARD_TYPE',
        path: 'abilities[0].printedSourceReference',
      }),
    );

    const noSourceSlot = safeParseCard(
      creatureTrigger({
        condition: 'beginningOfYourUpkeep',
        printedSourceReference: 'thisCreature',
      }),
    );
    expect(noSourceSlot.ok).toBe(false);
    if (noSourceSlot.ok) throw new Error('source-free trigger reference unexpectedly parsed');
    expect(noSourceSlot.violations).toContainEqual(
      expect.objectContaining({
        code: 'ABILITY_ILLEGAL_ON_CARD_TYPE',
        path: 'abilities[0].printedSourceReference',
      }),
    );
  });

  it('keeps source transcription outside every generator-facing ability schema', () => {
    const baseline = {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    } as const;
    for (const schema of [
      ModelAbilitySchema,
      AttachingModelAbilitySchema,
      MechanicModelAbilitySchema,
      AttachingMechanicModelAbilitySchema,
    ]) {
      expect(schema.safeParse(baseline).success).toBe(true);
      expect(schema.safeParse({ ...baseline, printedSourceReference: 'thisCreature' }).success).toBe(false);
    }
  });
});
