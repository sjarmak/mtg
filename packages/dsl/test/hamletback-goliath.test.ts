/** Exact hand-authored vocabulary for M13 Hamletback Goliath. */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, CardInput, EffectInput } from '../src/index';
import {
  ComputedAmountSchema,
  MODEL_TRIGGER_CONDITIONS,
  ModelEffectSchema,
  SharedComputedAmountSchema,
  TRIGGER_CONDITIONS,
  TRIGGERING_CREATURE_CONDITIONS,
  renderOracleText,
} from '../src/index';
import { parseCard } from '../src/parse';

const TRIGGERING_POWER = { kind: 'triggeringCreaturePower' } as const;

const GROW: EffectInput = {
  kind: 'putCounters',
  counter: 'plusOnePlusOne',
  count: TRIGGERING_POWER,
  target: { kind: 'selfCreature' },
};

const HAMLETBACK_TRIGGER: AbilityInput = {
  kind: 'triggered',
  condition: 'anotherCreatureEnters',
  optional: true,
  effects: [GROW],
};

function hamletback(abilities: readonly AbilityInput[] = [HAMLETBACK_TRIGGER]): CardInput {
  return {
    kind: 'creature',
    id: 'm13-136-hamletback-goliath',
    name: 'Hamletback Goliath',
    rarity: 'rare',
    set: { code: 'M13', collectorNumber: 136 },
    manaCost: { generic: 6, R: 1 },
    colors: ['R'],
    subtypes: ['Giant', 'Warrior'],
    power: 6,
    toughness: 6,
    keywords: [],
    abilities: [...abilities],
  };
}

describe('Hamletback Goliath vocabulary', () => {
  it('keeps the condition and event-derived amount outside the generator schemas', () => {
    expect(TRIGGER_CONDITIONS).toContain('anotherCreatureEnters');
    expect(TRIGGERING_CREATURE_CONDITIONS).toContain('anotherCreatureEnters');
    expect(MODEL_TRIGGER_CONDITIONS).not.toContain('anotherCreatureEnters');

    expect(ComputedAmountSchema.parse(TRIGGERING_POWER)).toEqual(TRIGGERING_POWER);
    expect(SharedComputedAmountSchema.safeParse(TRIGGERING_POWER).success).toBe(false);
    expect(ModelEffectSchema.safeParse(GROW).success).toBe(false);
  });

  it('renders the current Oracle text exactly', () => {
    expect(renderOracleText(parseCard(hamletback()))).toBe(
      "Whenever another creature enters, you may put X +1/+1 counters on this creature, where X is that creature's power.",
    );
  });

  it('refuses the amount on a trigger that retains no creature', () => {
    const wrongTrigger: AbilityInput = {
      ...HAMLETBACK_TRIGGER,
      condition: 'selfEnters',
    };
    expect(() => parseCard(hamletback([wrongTrigger]))).toThrow(/triggeringCreaturePower/u);
  });

  it('refuses the amount on an activated ability and a spell', () => {
    const activated: AbilityInput = {
      kind: 'activated',
      cost: { mana: { generic: 1 } },
      effects: [GROW],
    };
    expect(() => parseCard(hamletback([activated]))).toThrow(/triggeringCreaturePower/u);

    expect(() =>
      parseCard({
        kind: 'sorcery',
        id: 'tst-stolen-stature',
        name: 'Stolen Stature',
        rarity: 'rare',
        set: { code: 'TST', collectorNumber: 1 },
        manaCost: { generic: 2, R: 1 },
        colors: ['R'],
        effects: [
          {
            ...GROW,
            target: { kind: 'targetCreature' },
          },
        ],
      }),
    ).toThrow(/triggeringCreaturePower/u);
  });
});
