/**
 * "Damage equal to the number of cards exiled this way", in Forge.
 *
 * The count is not a parameter of any Forge effect API; it is a protocol across
 * the ability chain (`remember.ts` argues the whole of it). These cases pin the
 * three lines that make it work and, as much as anything here can, the two
 * shapes that must keep rejecting: a count with nothing behind it, and a count
 * read before the exile that would feed it. The second is the dangerous one —
 * Forge would run that script happily and deal zero, which is a card that plays
 * one way in the parity oracle and another in the kernel.
 *
 * Every parameter spelling below was read off Forge 2.0.14's shipped
 * `res/cardsfolder`, not off a game Forge ran; `cinder_seer.txt` carries the
 * whole shape and 2,304 scripts carry the cleanup line. `mtg-17a` is the check
 * that turns that into a played card.
 */
import { describe, expect, it } from 'vitest';
import type { EffectInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '../src/index';
import { mustTranspile, slugId, spell } from './helpers';

const exileTheirBoard: EffectInput = {
  kind: 'exileTarget',
  scope: 'creaturesThatPlayerControls',
  target: { kind: 'targetOpponent' },
};
const exileTheirHand: EffectInput = {
  kind: 'exileTarget',
  scope: 'creatureCardsInPlayerHand',
  target: { kind: 'targetOpponent' },
};
const burnForTheCount: EffectInput = {
  kind: 'dealDamage',
  amount: { kind: 'exiledThisResolution' },
  target: { kind: 'targetOpponent' },
};

function lineStartingWith(script: string, prefix: string): string | undefined {
  return script.split('\n').find((line) => line.startsWith(prefix));
}

describe('a spell that counts what its own earlier clause exiled', () => {
  const script = mustTranspile(spell('Twofold Ruin', [exileTheirBoard, exileTheirHand, burnForTheCount]));

  it('makes every exile remember what it moved', () => {
    const remembering = script.split('\n').filter((line) => line.includes('RememberChanged$ True'));
    expect(remembering).toHaveLength(2);
    expect(remembering[0]).toContain('Origin$ Battlefield');
    expect(remembering[1]).toContain('Origin$ Hand');
  });

  it('reads the count back as a numeral rather than a parameter of its own', () => {
    expect(script).toContain('NumDmg$ X');
    expect(script).toContain('SVar:X:Remembered$Amount');
  });

  /**
   * A remembered list that outlives the resolution would be counted again by
   * the next copy of the spell, so the chain has to end by emptying it.
   */
  it('ends the chain by clearing the remembered list', () => {
    const cleanup = lineStartingWith(script, 'SVar:DBEffect3:');
    expect(cleanup).toBe('SVar:DBEffect3:DB$ Cleanup | ClearRemembered$ True');
    expect(lineStartingWith(script, 'SVar:DBEffect2:')).toContain('SubAbility$ DBEffect3');
  });
});

describe('the shapes that must keep rejecting', () => {
  it('rejects a count read before the exile that would feed it', () => {
    const result = transpileCard(spell('Premature Reckoning', [burnForTheCount, exileTheirBoard]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toContain('UNMAPPED_COMPUTED_AMOUNT');
  });

  it('rejects a count on a spell that exiles nothing at all', () => {
    const result = transpileCard(spell('Empty Tally', [burnForTheCount]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toContain('UNMAPPED_COMPUTED_AMOUNT');
  });

  /**
   * The protocol is built for the spell chain and nothing else. A triggered
   * ability builds its own `SVar:` chain in `ability-script.ts`, which passes
   * no spelling, so the count there still has no Forge form — and says so
   * rather than writing a script that counts a different resolution.
   */
  it('rejects the count inside a printed ability, where no protocol is written', () => {
    const result = transpileCard(
      parseCard({
        kind: 'creature',
        id: slugId('Tallying Sentry'),
        name: 'Tallying Sentry',
        rarity: 'common',
        set: { code: 'TST', collectorNumber: 900 },
        manaCost: { generic: 2, B: 1 },
        colors: ['B'],
        power: 2,
        toughness: 2,
        abilities: [
          {
            kind: 'triggered',
            condition: 'selfEnters',
            effects: [exileTheirBoard, burnForTheCount],
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toContain('UNMAPPED_COMPUTED_AMOUNT');
  });
});

describe('a spell that exiles and counts nothing', () => {
  const script = mustTranspile(spell('Plain Banishment', [exileTheirBoard]));

  /**
   * No shipped script carries a `RememberChanged$` that nothing reads, and one
   * here would be a line that does work for no reader. The protocol is written
   * only when the chain turns out to want it.
   */
  it('writes no protocol at all', () => {
    expect(script).not.toContain('RememberChanged');
    expect(script).not.toContain('ClearRemembered');
    expect(script).not.toContain('Remembered$Amount');
  });
});
