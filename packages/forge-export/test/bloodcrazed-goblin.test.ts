/** Forge's shipped Bloodcrazed Goblin condition grammar. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const CARD = parseCard({
  kind: 'creature',
  id: 'tst-bloodcrazed-goblin',
  name: 'Bloodcrazed Goblin',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 125 },
  colors: ['R'],
  manaCost: { R: 1 },
  power: 2,
  toughness: 2,
  subtypes: ['Goblin', 'Berserker'],
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      enabledWhile: { kind: 'opponentUndamagedThisTurn' },
      modification: { kind: 'cantAttack' },
    },
  ],
});

describe('Bloodcrazed Goblin Forge parity', () => {
  it('matches the shipped CantAttack plus player-count SVar', () => {
    const result = transpileCard(CARD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.text).toContain(
      "S:Mode$ CantAttack | ValidCard$ Card.Self | CheckSVar$ X | SVarCompare$ LT1 | Description$ CARDNAME can't attack unless an opponent has been dealt damage this turn.",
    );
    expect(result.script.text).toContain('SVar:X:PlayerCountPropertyYou$DamageToOppsThisTurn');
  });
});
