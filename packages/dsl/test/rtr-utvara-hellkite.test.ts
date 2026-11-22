/** Exact hand-authored controlled-subtype attack trigger for RTR Utvara Hellkite. */
import { describe, expect, it } from 'vitest';
import {
  AbilitySchema,
  MODEL_TRIGGER_CONDITIONS,
  ModelAbilitySchema,
  parseCard,
  renderOracleText,
  validateCard,
  type AbilityInput,
  type CardInput,
  type TokenSpecInput,
} from '../src/index';

const DRAGON: TokenSpecInput = {
  name: 'Dragon',
  power: 6,
  toughness: 6,
  colors: ['R'],
  subtypes: ['Dragon'],
  keywords: ['flying'],
};

const DRAGON_ATTACK_TRIGGER = {
  kind: 'triggered',
  condition: 'selfAttacks',
  attackingCreatureSubtype: 'Dragon',
  effects: [{ kind: 'createToken', count: 1, token: DRAGON }],
} as const satisfies AbilityInput;

function utvaraHellkite(ability: AbilityInput = DRAGON_ATTACK_TRIGGER): CardInput {
  return {
    kind: 'creature',
    id: 'rtr-110-utvara-hellkite',
    name: 'Utvara Hellkite',
    rarity: 'mythic',
    set: { code: 'RTR', collectorNumber: 110 },
    manaCost: { generic: 6, R: 2 },
    colors: ['R'],
    subtypes: ['Dragon'],
    keywords: ['flying'],
    power: 6,
    toughness: 6,
    abilities: [ability],
  };
}

describe('RTR #110 Utvara Hellkite', () => {
  it('accepts one atomic controlled-attacker subtype and token payload bundle', () => {
    expect(validateCard(utvaraHellkite())).toEqual([]);
    expect(AbilitySchema.safeParse(DRAGON_ATTACK_TRIGGER).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(DRAGON_ATTACK_TRIGGER).success).toBe(false);
    expect(MODEL_TRIGGER_CONDITIONS).toContain('selfAttacks');
  });

  it('renders current Oracle text exactly', () => {
    expect(renderOracleText(parseCard(utvaraHellkite()))).toBe(
      'Flying\nWhenever a Dragon you control attacks, create a 6/6 red Dragon creature token with flying.',
    );
  });

  it('refuses the subtype filter and event condition when independently widened', () => {
    const nearMisses: readonly AbilityInput[] = [
      { ...DRAGON_ATTACK_TRIGGER, condition: 'selfEnters' },
      { ...DRAGON_ATTACK_TRIGGER, attackingCreatureSubtype: '' },
      {
        ...DRAGON_ATTACK_TRIGGER,
        effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      },
    ];

    for (const ability of nearMisses) expect(validateCard(utvaraHellkite(ability))).not.toEqual([]);
  });
});
