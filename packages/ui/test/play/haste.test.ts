// @vitest-environment jsdom
/**
 * A hasted creature on the table, and the mark it must not wear.
 *
 * The bug this closes was reported from play: a creature cast with haste
 * attacked perfectly well and sat there labeled SICK the whole time. Both
 * halves were true at once, which is the tell — the kernel's combat rule asks
 * for the keyword (CR 702.10b) and the board's projection asked only for the
 * flag, so the two disagreed about the same permanent.
 *
 * Haste does not clear summoning sickness. The flag stays set and the keyword
 * waives what the flag forbids, so `object.summoningSick` is the wrong question
 * for anything a player reads. The first test asserts the projection and the
 * second asserts the rendered mark, because the projection is what the icon
 * reads: the label became an hourglass in `mtg-lnv`, and every assertion here
 * is by key rather than by glyph so that redrawing the mark could never quietly
 * reintroduce the wrong input to it.
 *
 * The creature beside it is the control, and it is deliberately not a vanilla
 * one: `Thornhide Guardian` carries reach and trample, so it also fails a
 * projection that had asked whether the permanent has any keyword at all rather
 * than whether it has this one. Without a control of some kind, a projection
 * that had simply stopped reporting sickness would pass both tests above.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { scenario } from '@mtg/kernel';
import { boardPosition } from '../../src/routes/play/position';
import type { SeatNames } from '../../src/routes/play/position';
import { permanentMarks } from '../../src/board/Battlefield';
import type { BoardPermanent } from '../../src/board/Battlefield';

afterEach(cleanup);

const NAMES: SeatNames = ['Player one', 'Player two'];

function example(name: string): Card {
  const card = EXAMPLE_CARDS.find((candidate) => candidate.name === name);
  if (card === undefined) throw new Error(`no example card named ${name}`);
  return card;
}

/** `Emberflow Raider` is 2/1 with haste; `Thornhide Guardian` has reach and trample. */
const HASTED = example('Emberflow Raider');
const PLAIN = example('Thornhide Guardian');

/** Both creatures arrived this turn, so both carry the flag. */
function justArrived(): readonly BoardPermanent[] {
  const start = scenario({
    battlefield: [
      { card: HASTED, controller: 0, summoningSick: true },
      { card: PLAIN, controller: 0, summoningSick: true },
    ],
  });
  return boardPosition(start.state, 0, NAMES).you.battlefield.permanents;
}

function named(name: string): BoardPermanent {
  const permanent = justArrived().find((candidate) => candidate.card.name === name);
  if (permanent === undefined) throw new Error(`${name} is not on the board`);
  return permanent;
}

describe('a creature with haste', () => {
  it('is not projected as summoning sick', () => {
    expect(named(HASTED.name).summoningSick).toBe(false);
  });

  it('wears no sick mark', () => {
    expect(permanentMarks(named(HASTED.name)).map((mark) => mark.key)).not.toContain('sick');
  });
});

describe('a creature without haste, the same turn', () => {
  it('is projected as summoning sick', () => {
    expect(named(PLAIN.name).summoningSick).toBe(true);
  });

  it('wears the sick mark', () => {
    expect(permanentMarks(named(PLAIN.name)).map((mark) => mark.key)).toContain('sick');
  });
});
