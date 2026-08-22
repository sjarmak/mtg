/**
 * The life vocabulary as Forge writes it, and the one member it refuses.
 *
 * Two rows and one refusal. `LoseLife` and `SetLife` are both shipped Forge
 * effect APIs with corpus spellings behind them, so those two are asserted
 * against the lines the transpiler emits. A blanket "prevent all combat damage
 * this turn" is not an effect API at all — Forge writes it as an `SP$ Effect`
 * installing a `ReplacementEffects$` line — and this transpiler emits neither,
 * so the row rejects with a named code rather than approximating it. That
 * refusal is asserted here for the reason `conformance.test.ts` asserts the
 * characteristic-defining P/T's: a parity oracle that boots on a card we
 * exported wrong is worse than one that refuses to export it.
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

  it('refuses a Fog by name rather than exporting a different card', () => {
    const result = transpileCard(spell('Test Held Blow', [{ kind: 'preventCombatDamage' }]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((entry) => entry.code)).toContain('UNMAPPED_EFFECT_KIND');
    expect(result.rejections[0]?.message).toMatch(/replacement effect/iu);
  });
});
