/** Exact authored shape for one damage event over creatures and players. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard, type CardInput } from '@mtg/dsl';

const DAMAGE_EVERYTHING = {
  kind: 'dealDamage',
  amount: 3,
  scope: 'allPermanents',
  scopeFilter: { cardTypes: ['creature'] },
  players: 'eachPlayer',
  target: { kind: 'noTarget' },
} as const;

function magmaPhoenix(effect: Record<string, unknown> = DAMAGE_EVERYTHING): CardInput {
  return {
    kind: 'creature',
    id: 'm11-150',
    name: 'Magma Phoenix',
    rarity: 'rare',
    set: { code: 'M11', collectorNumber: 150 },
    colors: ['R'],
    manaCost: { generic: 3, R: 2 },
    subtypes: ['Phoenix'],
    keywords: ['flying'],
    power: 3,
    toughness: 3,
    abilities: [
      { kind: 'triggered', condition: 'selfDies', effects: [effect] },
      {
        kind: 'activated',
        activationZone: 'graveyard',
        cost: { mana: { generic: 3, R: 2 } },
        effects: [{ kind: 'returnSourceFromGraveyard', destination: 'hand' }],
      },
    ],
  } as CardInput;
}

describe('Magma Phoenix', () => {
  it('prints one exact damage clause over every creature and player', () => {
    expect(renderOracleText(parseCard(magmaPhoenix()))).toBe(
      'Flying\n' +
        'When Magma Phoenix dies, it deals 3 damage to each creature and each player.\n' +
        '{3}{R}{R}: Return Magma Phoenix from your graveyard to your hand.',
    );
  });

  it('keeps the player-sweep field outside the generator contract', () => {
    expect(ModelEffectSchema.safeParse(DAMAGE_EVERYTHING).success).toBe(false);
  });

  it('accepts controller damage and refuses a player sweep with a live target', () => {
    const empty = safeParseCard(
      magmaPhoenix({ kind: 'dealDamage', amount: 3, target: { kind: 'noTarget' } }),
    );
    expect(empty.ok).toBe(true);
    if (empty.ok) {
      expect(renderOracleText(empty.card)).toContain('When Magma Phoenix dies, it deals 3 damage to you.');
    }

    const targetedSweep = safeParseCard(
      magmaPhoenix({
        kind: 'dealDamage',
        amount: 3,
        players: 'eachPlayer',
        target: { kind: 'targetPlayer' },
      }),
    );
    expect(
      targetedSweep.ok ? [] : targetedSweep.violations.map((found) => [found.code, found.path]),
    ).toContainEqual(['ILLEGAL_EFFECT_SCOPE', 'abilities[0].effects[0].players']);
  });
});
