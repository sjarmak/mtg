/**
 * The life vocabulary as Forge writes it.
 *
 * Three rows, all of them shipped Forge effect APIs with corpus spellings
 * behind them, so all three are asserted against the lines the transpiler
 * emits. The third used to be a refusal, on the ground that a blanket "prevent
 * all combat damage this turn" is not an effect API at all but an `SP$ Effect`
 * installing a `ReplacementEffects$` line. Forge master spells it `A:SP$ Fog`,
 * in 19 files of the 2.0.14 corpus, so the refusal named a limitation the
 * oracle does not have (`mtg-udc9`).
 *
 * The reason the refusal existed is still the right instinct and is now met by
 * a stronger assertion than a rejection code: this transpiler's Fog line is
 * compared byte for byte against `res/cardsfolder/f/fog.txt`'s own. A parity
 * oracle that boots on a card we exported wrong is worse than one that refuses
 * to export it, and better than either is one that exports the file Forge
 * ships.
 */
import { describe, expect, it } from 'vitest';
import { transpileCard } from '@mtg/forge-export';
import { spell } from './helpers';

/** The one line of a transpiled card that starts with the given prefix. */
function lineStartingWith(card: Parameters<typeof transpileCard>[0], prefix: string): string {
  const result = transpileCard(card);
  if (!result.ok) throw new Error(`unexpected rejection: ${JSON.stringify(result.rejections)}`);
  const line = result.script.text.split('\n').find((text) => text.startsWith(prefix));
  if (line === undefined) throw new Error(`no ${prefix} line in\n${result.script.text}`);
  return line;
}

describe('the life rows', () => {
  it('writes a targeted drain with the target clause and the amount', () => {
    expect(
      lineStartingWith(
        spell('Test Vein Drain', [{ kind: 'loseLife', amount: 2, target: { kind: 'targetOpponent' } }]),
        'A:',
      ),
    ).toContain('LoseLife');
    expect(
      lineStartingWith(
        spell('Test Vein Drain Two', [{ kind: 'loseLife', amount: 2, target: { kind: 'targetOpponent' } }]),
        'A:',
      ),
    ).toContain('LifeAmount$ 2');
  });

  /**
   * `Defined$ You` rather than a target clause, and it is written by the row
   * itself: the effect names no target at all, so there is no targeting clause
   * for the shared builder to produce, and the seat whose total moves is the
   * controller's.
   */
  it('writes a life total set as the controller’s own, with no target clause', () => {
    const line = lineStartingWith(spell('Test Level Out', [{ kind: 'setLife', amount: 10 }]), 'A:');
    expect(line).toContain('SetLife');
    expect(line).toContain('Defined$ You');
    expect(line).toContain('LifeAmount$ 10');
    expect(line).not.toContain('ValidTgts$');
  });

  /**
   * Forge master `forge-gui/res/cardsfolder/f/fog.txt`, quoted whole. Nine more
   * files carry the identical line: Holy Day, Darkness, Angelsong, Lull,
   * Root Snare, Moment's Peace, Haze of Pollen, Pause for Reflection and
   * Constant Mists. Equality rather than `toContain`, because the claim being
   * made is that the exported card is the card Forge ships and not merely a
   * card built on the right API.
   */
  it('writes a Fog as the line Forge ships for Fog', () => {
    expect(lineStartingWith(spell('Test Held Blow', [{ kind: 'preventCombatDamage' }]), 'A:')).toBe(
      'A:SP$ Fog | SpellDescription$ Prevent all combat damage that would be dealt this turn.',
    );
  });

  /**
   * The API carries the whole meaning, so there is nothing beside it to get
   * wrong: no target clause for an effect that names no target, and no amount
   * for a prevention that has none. `SP$ PreventDamage` with an `Amount$` was
   * the approximation the refusal was protecting against, and it earns its
   * assertion: it would prevent one instance and let the rest of the combat
   * damage step through.
   */
  it('writes the Fog with no target clause and no damage amount', () => {
    const line = lineStartingWith(spell('Test Held Blow Two', [{ kind: 'preventCombatDamage' }]), 'A:');
    expect(line).not.toContain('ValidTgts$');
    expect(line).not.toContain('Defined$');
    expect(line).not.toContain('Amount$');
    expect(line).not.toContain('PreventDamage');
  });
});
