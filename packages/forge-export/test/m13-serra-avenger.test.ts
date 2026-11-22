import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

describe('M13 #33 Serra Avenger Forge export', () => {
  it('uses Forge native turn counting and exact Oracle', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'm13-serra-avenger-forge',
      name: 'Serra Avenger',
      rarity: 'rare',
      set: { code: 'M13', collectorNumber: 33 },
      manaCost: { W: 2 },
      colors: ['W'],
      subtypes: ['Angel'],
      power: 3,
      toughness: 3,
      keywords: ['flying', 'vigilance'],
      castingRestriction: { kind: 'prohibitedPlayerTurns', turns: [1, 2, 3] },
    });
    const script = mustTranspile(card);
    expect(script).toContain(
      "S:Mode$ CantBeCast | ValidCard$ Card.Self | EffectZone$ All | Caster$ Player.Active | CheckSVar$ X | SVarCompare$ LE3 | Description$ You can't cast this spell during your first, second, or third turns of the game.",
    );
    expect(script).toContain('SVar:X:Count$YourTurns');
    expect(script).toContain(
      "Oracle:You can't cast Serra Avenger during your first, second, or third turns of the game.\\nFlying, vigilance",
    );
  });
});
