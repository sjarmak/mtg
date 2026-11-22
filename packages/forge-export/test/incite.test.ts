/** Forge's own Incite script pins both linked effect grammars. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const INCITE = parseCard({
  kind: 'instant',
  id: 'tst-incite',
  name: 'Incite',
  rarity: 'common',
  set: { code: 'M11', collectorNumber: 145 },
  colors: ['R'],
  manaCost: { R: 1 },
  effects: [
    { kind: 'setColorsUntilEndOfTurn', colors: ['R'], target: { kind: 'targetCreature' } },
    { kind: 'attacksThisTurnIfAble', target: { kind: 'thatCreature' } },
  ],
});

describe('Incite Forge parity', () => {
  it('matches the shipped Animate plus remembered MustAttack effect', () => {
    const result = transpileCard(INCITE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.text).toContain(
      'A:SP$ Animate | ValidTgts$ Creature | Colors$ Red | OverwriteColors$ True | SubAbility$ DBEffect1 | SpellDescription$ Target creature becomes red until end of turn and attacks this turn if able.',
    );
    expect(result.script.text).toContain(
      'SVar:DBEffect1:DB$ Effect | StaticAbilities$ MustAttack | ExileOnMoved$ Battlefield | RememberObjects$ Targeted',
    );
    expect(result.script.text).toContain(
      'SVar:MustAttack:Mode$ MustAttack | ValidCreature$ Creature.IsRemembered | Description$ This creature attacks this turn if able.',
    );
  });
});
