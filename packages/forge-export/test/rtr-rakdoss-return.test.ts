/** Rakdos's Return against Forge's installed card script. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const RAKDOSS_RETURN = parseCard({
  kind: 'sorcery',
  id: 'rtr-188-rakdoss-return-forge',
  name: "Rakdos's Return",
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 188 },
  manaCost: { hasX: true, B: 1, R: 1 },
  colors: ['B', 'R'],
  effects: [
    {
      kind: 'dealDamage',
      amount: { kind: 'chosenX' },
      target: { kind: 'targetPlayerOrPlaneswalker' },
      opponentPlayerOrPlaneswalkerOnly: true,
    },
    {
      kind: 'discardCards',
      count: 1,
      countFrom: 'chosenX',
      target: { kind: 'thatPlayerOrPlaneswalkerController' },
    },
  ],
});

describe("Rakdos's Return in Forge", () => {
  it('exports the installed opponent routing and one linked X value', () => {
    const script = mustTranspile(RAKDOSS_RETURN);
    expect(script).toContain(
      'A:SP$ DealDamage | ValidTgts$ Opponent,Planeswalker | TgtPrompt$ Select target opponent or planeswalker | NumDmg$ X',
    );
    expect(script).toContain('DB$ Discard | Defined$ TargetedOrController | NumCards$ X | Mode$ TgtChoose');
    expect(script.match(/SVar:X:Count\$xPaid/gu)).toHaveLength(1);
  });
});
