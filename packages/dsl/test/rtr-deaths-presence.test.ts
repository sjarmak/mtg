/** Exact hand-authored vocabulary for RTR Death's Presence. */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, CardInput, EffectInput } from '../src/index';
import {
  MODEL_TRIGGER_CONDITIONS,
  ModelEffectSchema,
  TRIGGER_CONDITIONS,
  TRIGGERING_CREATURE_CONDITIONS,
  renderOracleText,
} from '../src/index';
import { parseCard } from '../src/parse';

const GROW: EffectInput = {
  kind: 'putCounters',
  counter: 'plusOnePlusOne',
  count: { kind: 'triggeringCreaturePower' },
  target: { kind: 'targetCreatureYouControl' },
};

const TRIGGER: AbilityInput = {
  kind: 'triggered',
  condition: 'controlledCreatureDies',
  effects: [GROW],
};

function deathsPresence(abilities: readonly AbilityInput[] = [TRIGGER]): CardInput {
  return {
    kind: 'enchantment',
    id: 'rtr-121-deaths-presence',
    name: "Death's Presence",
    rarity: 'rare',
    set: { code: 'RTR', collectorNumber: 121 },
    manaCost: { generic: 5, G: 1 },
    colors: ['G'],
    abilities: [...abilities],
  };
}

describe("RTR #121 Death's Presence", () => {
  it('keeps the trigger and effect outside the generator vocabulary', () => {
    expect(TRIGGER_CONDITIONS).toContain('controlledCreatureDies');
    expect(TRIGGERING_CREATURE_CONDITIONS).toContain('controlledCreatureDies');
    expect(MODEL_TRIGGER_CONDITIONS).not.toContain('controlledCreatureDies');
    expect(ModelEffectSchema.safeParse(GROW).success).toBe(false);
  });

  it('renders current Oracle text exactly', () => {
    expect(renderOracleText(parseCard(deathsPresence()))).toBe(
      'Whenever a creature you control dies, put X +1/+1 counters on target creature you control, where X is the power of the creature that died.',
    );
  });

  it('refuses the event-derived power on a trigger that retains no creature', () => {
    expect(() => parseCard(deathsPresence([{ ...TRIGGER, condition: 'selfEnters' }]))).toThrow(
      /triggeringCreaturePower/u,
    );
  });
});
