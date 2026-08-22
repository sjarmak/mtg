/**
 * A zero in a power/toughness change takes the sign of the number beside it
 * (mtg-76qq).
 *
 * `formatDelta` is handed one number, and a zero has no sign of its own, so a
 * mass power reduction printed "gets -3/+0 until end of turn". Magic prints
 * -3/-0: the sign belongs to the change, and a change that takes three power
 * away does not add nothing to toughness. `formatPtDelta` reads the pair, and
 * `formatDeltaBeside` is the half of it `renderPump` needs, because either of
 * its amounts may be a computed letter with no sign to lend.
 */
import { describe, expect, it } from 'vitest';
import { renderAbility, renderEffect } from '@mtg/dsl';
import { formatDelta, formatDeltaBeside, formatPtDelta } from '../src/text-util';
import type { Ability, Effect } from '@mtg/dsl';

describe('formatPtDelta', () => {
  it('gives a zero the sign of its partner', () => {
    expect(formatPtDelta(-3, 0)).toBe('-3/-0');
    expect(formatPtDelta(0, -2)).toBe('-0/-2');
  });

  it('leaves a positive pair and a positive-with-zero pair alone', () => {
    expect(formatPtDelta(2, 2)).toBe('+2/+2');
    expect(formatPtDelta(1, 0)).toBe('+1/+0');
    expect(formatPtDelta(0, 1)).toBe('+0/+1');
  });

  it('leaves a mixed pair to its own two signs, which is the case with no zero', () => {
    expect(formatPtDelta(99, -3)).toBe('+99/-3');
    expect(formatPtDelta(-1, 2)).toBe('-1/+2');
  });

  it('prints both zeroes positive, which no card says and the function still must', () => {
    expect(formatPtDelta(0, 0)).toBe('+0/+0');
  });

  it('leaves formatDelta itself alone, since one number still has no partner', () => {
    expect(formatDelta(0)).toBe('+0');
    expect(formatDelta(-3)).toBe('-3');
    expect(formatDeltaBeside(0, -3)).toBe('-0');
    expect(formatDeltaBeside(0, 3)).toBe('+0');
  });
});

describe('the renderers that print a pair', () => {
  it('prints a negative pump with a signed zero', () => {
    const effect: Effect = {
      kind: 'pumpUntilEndOfTurn',
      power: -3,
      toughness: 0,
      target: { kind: 'targetCreature' },
    };
    expect(renderEffect(effect, 'Falter of the Camp')).toBe('Target creature gets -3/-0 until end of turn.');
  });

  it('prints a negative static with a signed zero', () => {
    const ability: Ability = {
      kind: 'static',
      scope: 'otherCreaturesYouControl',
      subtype: null,
      modification: { kind: 'statBonus', power: 0, toughness: -1 },
    };
    expect(renderAbility(ability, 'Gloom Banner')).toBe('Other creatures you control get -0/-1.');
  });

  it('leaves a computed half as its letter and the literal zero beside it positive', () => {
    const effect: Effect = {
      kind: 'pumpUntilEndOfTurn',
      power: { kind: 'countMatching', filter: { cardTypes: ['creature'] } },
      toughness: 0,
      target: { kind: 'targetCreature' },
    };
    expect(renderEffect(effect, 'Sylvanok Chorus')).toBe(
      'Target creature gets +X/+0 until end of turn, where X is the number of creatures you control.',
    );
  });
});
