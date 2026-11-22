/** M13 #181: a spell-bound fight between two independently targeted creatures. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { ModelEffectSchema, parseCard, renderOracleText, validateCard } from '../src/index';

const PREY_UPON_INPUT = {
  kind: 'sorcery',
  id: 'm13-prey-upon',
  name: 'Prey Upon',
  rarity: 'common',
  set: { code: 'M13', collectorNumber: 181 },
  manaCost: { G: 1 },
  colors: ['G'],
  effects: [
    {
      kind: 'fight',
      fighter: { kind: 'targetCreatureYouControl' },
      target: { kind: 'targetCreatureYouDontControl' },
    },
  ],
} as CardInput;

describe('Prey Upon authoring', () => {
  it('prints the exact two-target Oracle sentence', () => {
    const card = parseCard(PREY_UPON_INPUT);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      "Target creature you control fights target creature you don't control. (Each deals damage equal to its power to the other.)",
    );
  });

  it('keeps the targeted fight outside the model effect schema', () => {
    expect(ModelEffectSchema.safeParse(PREY_UPON_INPUT.effects?.[0]).success).toBe(false);
  });

  it('keeps the ordered pair exact and spell-bound', () => {
    expect(() =>
      parseCard({
        ...PREY_UPON_INPUT,
        effects: [
          {
            kind: 'fight',
            fighter: { kind: 'targetCreatureYouControl' },
            target: {
              kind: 'targetCreatureYouDontControl',
              restriction: { kind: 'maxPower', power: 2 },
            },
          },
        ],
      } as CardInput),
    ).toThrow('targeted fight form requires exactly');

    expect(() =>
      parseCard({
        kind: 'creature',
        id: 'targeted-fight-trigger',
        name: 'Targeted Fight Trigger',
        rarity: 'common',
        set: { code: 'TEST', collectorNumber: 1 },
        manaCost: { generic: 2, G: 1 },
        colors: ['G'],
        power: 2,
        toughness: 2,
        abilities: [{ kind: 'triggered', condition: 'selfEnters', effects: PREY_UPON_INPUT.effects }],
      } as CardInput),
    ).toThrow('targeted fight is a spell effect');
  });
});
