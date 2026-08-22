/**
 * What `doesNotUntap` exports as.
 *
 * Forge has no parameter for "and it stays down". It writes the sentence as two
 * abilities chained by `SubAbility$`: the tap, then a pump that grants the
 * creature a hidden keyword with `Duration$ Permanent`. 2.0.14's
 * `res/cardsfolder` prints it that way on every card whose text is what this
 * rider prints, in both arms:
 *
 *   Frost Breath  A:SP$ Tap    | ValidTgts$ Creature | SubAbility$ TrigPump
 *                 SVar:TrigPump:DB$ Pump | Defined$ Targeted | KW$ HIDDEN ... | Duration$ Permanent
 *   Sleep         A:SP$ TapAll | ValidTgts$ Player | ValidCards$ Creature | SubAbility$ DBPumpAll
 *                 SVar:DBPumpAll:DB$ PumpAll | Defined$ Targeted | ValidCards$ Creature | KW$ HIDDEN ... | Duration$ Permanent
 *
 * So the chain is the assertion, and so is which half of it moves: `Pump` for
 * the single target and `PumpAll` for the sweep, matching the API the tap
 * itself picked, with the group named the same way the tap named it.
 *
 * Dungeon Geists is deliberately not the model. It holds the creature for as
 * long as its own body is on the battlefield, which Forge writes as a remembered
 * `Effect` carrying a `CantHappen` replacement — a different duration and a
 * different card. This rider is one untap step, which is the keyword.
 *
 * Read off `res/cardsfolder` rather than a booted Forge, the standing limit on
 * the whole package (`mtg-17a`).
 */
import { describe, expect, it } from 'vitest';
import type { Card, EffectInput } from '@mtg/dsl';
import { mustTranspile, spell } from './helpers';

const HOLD = "KW$ HIDDEN This card doesn't untap during your next untap step.";
const SWEEP = 'creaturesThatPlayerControls' as const;

function linesFor(name: string, effect: EffectInput): readonly string[] {
  return mustTranspile(spell(name, [effect]) as Card).split('\n');
}

function lineStarting(lines: readonly string[], prefix: string): string {
  const line = lines.find((text) => text.startsWith(prefix));
  if (line === undefined) throw new Error(`no ${prefix} line in:\n${lines.join('\n')}`);
  return line;
}

describe('a tap that holds', () => {
  it("chains a hidden-keyword Pump behind the tap, like Frost Breath's", () => {
    const lines = linesFor('Stasis Rune', {
      kind: 'tapPermanent',
      target: { kind: 'targetCreature' },
      doesNotUntap: true,
    });
    const ability = lineStarting(lines, 'A:');
    expect(ability).toContain('SP$ Tap |');
    expect(ability).toContain('SubAbility$ DBEffect1');

    const held = lineStarting(lines, 'SVar:DBEffect1:');
    expect(held).toContain('DB$ Pump');
    expect(held).toContain('Defined$ Targeted');
    expect(held).toContain(HOLD);
    expect(held).toContain('Duration$ Permanent');
    // The single-target arm grants the keyword to the one creature it tapped,
    // so it names no group; a `ValidCards$` here would widen the hold past the
    // tap.
    expect(held).not.toContain('ValidCards$');
  });

  it("chains PumpAll behind the sweep, like Sleep's, over the same group", () => {
    const lines = linesFor('Sleep of the Thornwood Tree', {
      kind: 'tapPermanent',
      scope: SWEEP,
      target: { kind: 'targetOpponent' },
      doesNotUntap: true,
    });
    const ability = lineStarting(lines, 'A:');
    expect(ability).toContain('SP$ TapAll');
    expect(ability).toContain('ValidTgts$ Player.Opponent');
    expect(ability).toContain('SubAbility$ DBEffect1');

    const held = lineStarting(lines, 'SVar:DBEffect1:');
    expect(held).toContain('DB$ PumpAll');
    expect(held).toContain('Defined$ Targeted');
    expect(held).toContain('ValidCards$ Creature');
    expect(held).toContain(HOLD);
    expect(held).toContain('Duration$ Permanent');
  });

  /** Without the rider there is nothing to chain, and the card is one line. */
  it('leaves a bare tap a single ability', () => {
    const lines = linesFor('Bewildering Gust', {
      kind: 'tapPermanent',
      target: { kind: 'targetCreature' },
    });
    expect(lineStarting(lines, 'A:')).not.toContain('SubAbility$');
    expect(lines.filter((text) => text.startsWith('SVar:DBEffect'))).toHaveLength(0);
  });
});
