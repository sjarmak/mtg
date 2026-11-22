/** Exact hand-authored linked discard-and-draw vocabulary for RTR Viashino Racketeer. */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, CardInput } from '../src/index';
import {
  ModelAbilitySchema,
  isOptionalDiscardThenDrawAbility,
  renderOracleText,
  safeParseCard,
} from '../src/index';
import { parseCard } from '../src/parse';

const RACKETEER_TRIGGER: AbilityInput = {
  kind: 'triggered',
  condition: 'selfEnters',
  printedSourceReference: 'thisCreature',
  optional: true,
  effects: [
    { kind: 'discardCards', count: 1, target: { kind: 'noTarget' } },
    { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
  ],
};

function racketeerInput(ability: AbilityInput = RACKETEER_TRIGGER): CardInput {
  return {
    kind: 'creature',
    id: 'rtr-112-viashino-racketeer',
    name: 'Viashino Racketeer',
    rarity: 'common',
    set: { code: 'RTR', collectorNumber: 112 },
    manaCost: { generic: 2, R: 1 },
    colors: ['R'],
    subtypes: ['Lizard', 'Rogue'],
    power: 2,
    toughness: 1,
    abilities: [ability],
  };
}

describe('Viashino Racketeer DSL', () => {
  it('renders the exact current Oracle text outside model output', () => {
    const card = parseCard(racketeerInput());
    const ability = card.abilities[0];

    expect(ability?.kind).toBe('triggered');
    if (ability?.kind !== 'triggered') throw new Error('Racketeer lost its trigger');
    expect(isOptionalDiscardThenDrawAbility(ability)).toBe(true);
    expect(ModelAbilitySchema.safeParse(RACKETEER_TRIGGER).success).toBe(false);
    expect(renderOracleText(card)).toBe(
      'When this creature enters, you may discard a card. If you do, draw a card.',
    );
  });

  it('admits only the exact optional reflexive one-card sequence', () => {
    const twoDiscards: AbilityInput = {
      ...RACKETEER_TRIGGER,
      effects: [
        { kind: 'discardCards', count: 2, target: { kind: 'noTarget' } },
        { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
      ],
    };
    const targetedDraw: AbilityInput = {
      ...RACKETEER_TRIGGER,
      effects: [
        { kind: 'discardCards', count: 1, target: { kind: 'noTarget' } },
        { kind: 'drawCards', count: 1, target: { kind: 'targetPlayer' } },
      ],
    };

    for (const nearMiss of [twoDiscards, targetedDraw]) {
      const result = safeParseCard(racketeerInput(nearMiss));
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('near-miss Racketeer unexpectedly parsed');
      expect(result.violations.map((violation) => violation.code)).toContain('OPTIONAL_TRIGGER_INVALID');
    }
  });
});
