import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe("RTR #57 Assassin's Strike", () => {
  it('matches the installed Forge target-controller subability exactly', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'rtr-assassins-strike',
      name: "Assassin's Strike",
      rarity: 'uncommon',
      set: { code: 'RTR', collectorNumber: 57 },
      manaCost: { generic: 4, B: 2 },
      colors: ['B'],
      effects: [
        { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
        { kind: 'discardCards', count: 1, target: { kind: 'thatCreaturesController' } },
      ],
    } as CardInput);

    expect(mustTranspile(card)).toContain(
      'A:SP$ Destroy | ValidTgts$ Creature | SubAbility$ DBEffect1 | SpellDescription$ Destroy target creature. Its controller discards a card.\n' +
        'SVar:DBEffect1:DB$ Discard | Defined$ TargetedController | NumCards$ 1 | Mode$ TgtChoose',
    );
  });
});
