/** Engine capacity and generator design budget are deliberately different bounds. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { FilledCreatureWithAbilitiesSchema } from '../src/filled';

const ABILITIES = [
  {
    kind: 'static',
    scope: 'self',
    modification: { kind: 'statBonus', power: 1, toughness: 0 },
  },
  {
    kind: 'triggered',
    condition: 'selfEnters',
    effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
  },
  {
    kind: 'activated',
    cost: { mana: { generic: 1 } },
    effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
  },
  {
    kind: 'triggered',
    condition: 'selfDies',
    effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
  },
] as const;

describe('ability-count containment', () => {
  it('admits four hand-authored abilities without widening generator output', () => {
    const engineCard = parseCard({
      kind: 'creature',
      id: 'tst-four-abilities',
      name: 'Fourfold Engine',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { generic: 4 },
      power: 4,
      toughness: 4,
      abilities: ABILITIES,
    });

    const generatorCard = {
      slotId: 'creature-rare-1',
      kind: 'creature',
      name: 'Fourfold Engine',
      manaCost: { generic: 4 },
      power: 4,
      toughness: 4,
      designNote: 'Exercises the independently bounded ability list.',
      abilities: ABILITIES,
    };

    expect(engineCard.abilities).toHaveLength(4);
    expect(
      FilledCreatureWithAbilitiesSchema.safeParse({ ...generatorCard, abilities: ABILITIES.slice(0, 2) })
        .success,
    ).toBe(true);
    expect(FilledCreatureWithAbilitiesSchema.safeParse(generatorCard).success).toBe(false);
  });
});
