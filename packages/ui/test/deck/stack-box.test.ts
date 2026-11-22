/**
 * The box a strip column is laid out inside, once the pane can say how tall it is.
 *
 * `mtg-47xi`. The arithmetic only: `../../src/routes/deck/stack-box.ts` splits
 * the four lengths out of the DOM for exactly this reason, the same way
 * `../../src/routes/deck/strips.ts` splits the pitch out of the drawing. What a
 * browser has to answer -- whether the pane declares the token at all, and
 * whether the lengths measured are the right lengths -- is
 * `./deck-frame.browser.test.ts`'s.
 */
import { describe, expect, it } from 'vitest';
import { boxFromRoom, roomOf } from '../../src/routes/deck/stack-box';
import { DECK_STACK_BOX, stackMetrics } from '../../src/routes/deck/strips';
import type { StackRoom } from '../../src/routes/deck/stack-box';

/** A 1440x900 desk: the pane the frame leaves, with the region at the top of it. */
const DESK: StackRoom = {
  scrollportHeight: 689,
  scrollportWidth: 1130,
  regionTop: 0,
  stackTop: 28,
  regionFoot: 4,
};

describe('the box a column is laid out inside', () => {
  it('takes the room the pane has, less what the column heads are already using', () => {
    expect(boxFromRoom(DECK_STACK_BOX, DESK).boxHeight).toBe(657);
  });

  it('changes nothing else about the box, because nothing else belongs to the pane', () => {
    const grown = boxFromRoom(DECK_STACK_BOX, DESK);
    expect(grown.stripHeight).toBe(DECK_STACK_BOX.stripHeight);
    expect(grown.faceHeight).toBe(DECK_STACK_BOX.faceHeight);
    expect(grown.minPitch).toBe(DECK_STACK_BOX.minPitch);
  });

  // The other direction, since `mtg-4lfg`. Keeping the constant here is what put
  // a 392px region inside the sealed builder's 325px pane and let every column
  // in it report no clipping while the pane cut them.
  it('comes down to the room where the pane has less of it than the constant', () => {
    const cramped: StackRoom = { ...DESK, scrollportHeight: 325 };
    expect(boxFromRoom(DECK_STACK_BOX, cramped).boxHeight).toBe(293);
  });

  // What that buys: the column that the pane was cutting silently now says so,
  // and says it at the pitch floor rather than at a pitch derived from room it
  // does not have.
  it('makes a column the pane was cutting report itself clipped', () => {
    const cramped: StackRoom = { ...DESK, scrollportHeight: 325 };
    // Twenty-four rather than the fourteen this case was written with: since
    // mtg-mxkrk the bottom strip is one bar rather than a whole card, so the
    // constant box holds a far deeper column before the floor is reached and
    // fourteen strips no longer distinguish the two boxes at all.
    expect(stackMetrics(24, DECK_STACK_BOX).clipped).toBe(false);
    expect(stackMetrics(24, DECK_STACK_BOX).pitch).toBeCloseTo(14.52, 2);
    const measured = stackMetrics(24, boxFromRoom(DECK_STACK_BOX, cramped));
    expect(measured.clipped).toBe(true);
    expect(measured.pitch).toBe(DECK_STACK_BOX.minPitch);
  });

  // The bottom strip is the floor at either density, for `fullStackBox`'s
  // reason: a region with less height than the one thing it always draws whole
  // has nothing to say. That is a card at full and, since mtg-mxkrk, one name
  // bar at compact.
  it('never goes below one bottom strip, however little room the pane reports', () => {
    const airless: StackRoom = { ...DESK, scrollportHeight: 40 };
    expect(boxFromRoom(DECK_STACK_BOX, airless).boxHeight).toBe(DECK_STACK_BOX.faceHeight);
  });

  it('floors to whole pixels, so the last strip lands inside the box rather than a tenth outside it', () => {
    const fractional: StackRoom = { ...DESK, scrollportHeight: 689.75 };
    expect(boxFromRoom(DECK_STACK_BOX, fractional).boxHeight).toBe(657);
  });

  // The point of the whole exercise: on a desk the deep column stops being
  // clipped, because there was room under it the constant could not see.
  it('un-clips a column that only overflowed because the box was a constant', () => {
    const deck = stackMetrics(30, DECK_STACK_BOX);
    expect(deck.clipped).toBe(true);
    const desk = stackMetrics(30, boxFromRoom(DECK_STACK_BOX, DESK));
    expect(desk.clipped).toBe(false);
    expect(desk.pitch).toBeGreaterThan(deck.pitch);
  });

  // And what it does not fix. A column deep enough to sit on the floor in 657px
  // is still deeper than its box, which is why the box scrolls it now.
  it('leaves a column that sits on the floor clipped, and the pitch on the floor', () => {
    const grown = boxFromRoom(DECK_STACK_BOX, DESK);
    const deep = stackMetrics(60, grown);
    expect(deep.pitch).toBe(grown.minPitch);
    expect(deep.clipped).toBe(true);
  });
});

/**
 * The DOM half, stood up out of plain objects.
 *
 * `roomOf` takes the two reads it needs as an interface and a function for
 * exactly this: what it does is decide which boxes to measure and subtract them
 * in the right order, and that is checkable without a layout engine. Whether
 * those boxes are the right boxes on a real page is
 * `./stack-box.browser.test.ts`'s.
 */
interface FakeElement {
  readonly getBoundingClientRect: () => { readonly top: number };
  readonly querySelector: (selector: string) => FakeElement | null;
  readonly parentElement: FakeElement | null;
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly clientWidth: number;
  readonly offsetHeight: number;
}

function element(top: number, extra: Partial<FakeElement> = {}): FakeElement {
  return {
    getBoundingClientRect: () => ({ top }),
    querySelector: () => null,
    parentElement: null,
    scrollTop: 0,
    clientHeight: 0,
    clientWidth: 0,
    offsetHeight: 0,
    ...extra,
  };
}

/**
 * A framed pane: the scrollport at 100, the region 40 into it, the heads 28 tall.
 *
 * `scrollbar` is what the region draws under its columns when they run off the
 * right, which on this platform is the difference between its offset height and
 * its client height and is nothing at all on another.
 */
function pane(
  token: string,
  scrollbar = 0,
): {
  readonly region: FakeElement;
  readonly styleOf: () => { getPropertyValue: (property: string) => string };
} {
  const stack = element(168);
  const scrollport = element(100, { clientHeight: 689, clientWidth: 1130, scrollTop: 12 });
  const region = element(128, {
    parentElement: scrollport,
    querySelector: () => stack,
    clientHeight: 200,
    offsetHeight: 200 + scrollbar,
  });
  return {
    region,
    styleOf: () => ({
      getPropertyValue: (property: string): string => (property === '--strip-box-from' ? token : '4px'),
    }),
  };
}

describe('the lengths the box is derived from', () => {
  it('reads the region past the scroll, so a driven pane does not shorten its own columns', () => {
    const { region, styleOf } = pane('pane');
    // 128 - 100 + 12: where the region sits in the scrollport's content, which
    // is what a scrolled pane makes different from where it sits on screen.
    expect(roomOf(region, styleOf)).toEqual({
      scrollportHeight: 689,
      scrollportWidth: 1130,
      regionTop: 40,
      stackTop: 40,
      regionFoot: 4,
    });
  });

  it('counts the sideways scrollbar under the columns, which is space they cannot have', () => {
    // `mtg-qs2d`. A region sized by its content is grown by its own horizontal
    // scrollbar rather than drawing it inside itself, so a foot read off the
    // padding alone left the derived box a scrollbar too tall and the deepest
    // column hanging out the bottom of the pane by that much.
    const { region, styleOf } = pane('pane', 15);
    expect(roomOf(region, styleOf)?.regionFoot).toBe(19);
  });

  it('refuses to measure a pane that did not say it has a height of its own', () => {
    const { region, styleOf } = pane('');
    expect(roomOf(region, styleOf)).toBeNull();
  });

  it('refuses a region with no column in it, which is a pane with an empty deck', () => {
    const { styleOf } = pane('pane');
    const scrollport = element(100, { clientHeight: 689 });
    expect(roomOf(element(128, { parentElement: scrollport }), styleOf)).toBeNull();
  });

  it('refuses a region with no scrollport around it at all', () => {
    const { styleOf } = pane('pane');
    expect(roomOf(element(128), styleOf)).toBeNull();
  });
});
