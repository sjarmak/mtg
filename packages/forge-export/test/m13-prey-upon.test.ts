/** Forge parity for M13 #181, sourced from Forge's shipped Prey Upon script. */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const PREY_UPON = parseCard({
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
} as CardInput);

describe('Prey Upon Forge export', () => {
  it('writes Forge native parent-target fight chaining exactly', () => {
    const script = mustTranspile(PREY_UPON);

    expect(script).toContain(
      "A:SP$ Pump | ValidTgts$ Creature.YouCtrl | TgtPrompt$ Select target creature you control | StackDescription$ None | SubAbility$ DBEffect1 | SpellDescription$ Target creature you control fights target creature you don't control. (Each deals damage equal to its power to the other.)",
    );
    expect(script).toContain(
      "SVar:DBEffect1:DB$ Fight | Defined$ ParentTarget | ValidTgts$ Creature.YouDontCtrl | TgtPrompt$ Select target creature you don't control",
    );
  });
});
