// @vitest-environment node
/**
 * The runner: a plan matched to the elements it is about, and played.
 *
 * The runner declares the DOM members it uses as structural interfaces, because
 * the workspace tsconfig has no `lib: dom` — and that constraint pays for itself
 * here. A fake board is a handful of objects with a rectangle and an `animate`
 * that records what it was asked for, so the four behaviors that are genuinely
 * hard to see in a browser can be asserted exactly:
 *
 *  - a card still on the table that has moved is inverted, not re-created;
 *  - a card that has just appeared travels from the zone the *event* says it
 *    came from, which a diff of the board could never know;
 *  - a card that has gone is the node React removed, re-parented and flown to
 *    its destination — the thing `mtg-ncg` recorded as the reason the CSS-only
 *    lane stopped short of departures;
 *  - and nothing at all happens on the first commit, which is a page load rather
 *    than an event.
 *
 * What it cannot answer is whether any of it is visible, which is
 * `motion.browser.test.ts`, and whether the cues are the right cues in the right
 * order, which is `motion-plan.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { MARK_ATTRIBUTE, MOTION_ATTRIBUTE, createMotionRunner } from '../../src/motion/runner';
import type { MotionKeyframe, MotionNode, MotionRoot, MotionTiming } from '../../src/motion/runner';
import { fallbackRect, invert } from '../../src/motion/geometry';
import type { Rect } from '../../src/motion/geometry';
import { motionPlan } from '../../src/motion/plan';
import type { MotionPlan } from '../../src/motion/plan';
import { MARK_MS, MOVE_MS } from '../../src/motion/timing';

interface Played {
  readonly frames: readonly MotionKeyframe[];
  readonly timing: MotionTiming;
}

/** A board element: a box, some attributes, and a record of what it was asked to play. */
class FakeNode implements MotionNode {
  readonly played: Played[] = [];
  readonly attributes = new Map<string, string>();
  readonly children: FakeNode[] = [];
  readonly handles: { cancel: () => void; onfinish: (() => void) | null }[] = [];
  canceled = 0;
  isConnected = true;

  constructor(
    private rect: Rect,
    attributes: Readonly<Record<string, string>> = {},
  ) {
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value);
  }

  getBoundingClientRect(): Rect {
    return this.rect;
  }

  moveTo(rect: Rect): void {
    this.rect = rect;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  appendChild(child: MotionNode): unknown {
    const node = child as FakeNode;
    node.isConnected = true;
    this.children.push(node);
    return node;
  }

  remove(): void {
    this.isConnected = false;
  }

  animate = (
    frames: readonly MotionKeyframe[],
    timing: MotionTiming,
  ): { cancel: () => void; onfinish: (() => void) | null } => {
    const handle = {
      cancel: (): void => {
        this.canceled += 1;
      },
      onfinish: null as (() => void) | null,
    };
    this.played.push({ frames, timing });
    this.handles.push(handle);
    return handle;
  };
}

/** A board whose selectors are a lookup table rather than a query engine. */
class FakeBoard extends FakeNode implements MotionRoot {
  readonly created: FakeNode[] = [];
  private readonly zones = new Map<string, FakeNode>();
  private cards: FakeNode[] = [];

  readonly ownerDocument = {
    createElement: (): MotionNode => {
      const made = new FakeNode({ x: 0, y: 0, width: 0, height: 0 });
      made.isConnected = false;
      this.created.push(made);
      return made;
    },
  };

  zone(selector: string, rect: Rect): void {
    this.zones.set(selector, new FakeNode(rect));
  }

  setCards(cards: readonly FakeNode[]): void {
    this.cards = [...cards];
  }

  querySelector(selector: string): MotionNode | null {
    return this.zones.get(selector) ?? null;
  }

  querySelectorAll(selector: string): ArrayLike<MotionNode> {
    return selector === '[data-permanent-key]' ? this.cards : [];
  }
}

const BOX: Rect = { x: 0, y: 0, width: 100, height: 140 };

function card(key: string, rect: Rect): FakeNode {
  return new FakeNode(rect, { 'data-permanent-key': key });
}

function board(): FakeBoard {
  const made = new FakeBoard({ x: 0, y: 0, width: 1200, height: 800 });
  made.zone(".mtg-board__side[data-seat='you']", { x: 0, y: 400, width: 1200, height: 400 });
  made.zone(".mtg-board__side[data-seat='you'] .mtg-zone__body[data-layout='board']", {
    x: 0,
    y: 400,
    width: 1200,
    height: 200,
  });
  made.zone(".mtg-board__side[data-seat='you'] .mtg-zone__body[data-layout='rail']", {
    x: 0,
    y: 640,
    width: 1200,
    height: 160,
  });
  made.zone(".mtg-browser[data-seat='you']", { x: 900, y: 300, width: 200, height: 52 });
  return made;
}

/** A plan with one move in it, written the way the event stream would have written it. */
function movePlan(
  oid: string,
  from: 'hand' | 'library' | 'battlefield' | 'stack',
  to: 'hand' | 'battlefield' | 'graveyard',
): MotionPlan {
  return motionPlan([{ type: 'zoneChanged', oid, from, to, owner: 0 }], { viewer: 0 });
}

/** A schedule that runs nothing until a test says so, so a beat is exact rather than awaited. */
function manualHost(): {
  readonly host: { schedule: (fn: () => void, ms: number) => () => void };
  readonly runDue: (ms: number) => void;
} {
  const queued: { at: number; fn: () => void; canceled: boolean }[] = [];
  let clock = 0;
  return {
    host: {
      schedule: (fn, ms): (() => void) => {
        const entry = { at: clock + ms, fn, canceled: false };
        queued.push(entry);
        return (): void => {
          entry.canceled = true;
        };
      },
    },
    runDue: (ms): void => {
      clock += ms;
      for (const entry of [...queued]) {
        if (entry.canceled || entry.at > clock) continue;
        entry.canceled = true;
        entry.fn();
      }
    },
  };
}

describe('the first commit', () => {
  /**
   * A page load is not an event. Without this every card on the table would fly
   * in from an anchor on the first paint of a resumed game, which is the
   * firehose version of the thing this lane exists to fix.
   */
  it('remembers the board and animates nothing', () => {
    const root = board();
    const face = card('c1', BOX);
    root.setCards([face]);
    createMotionRunner().sync(root, movePlan('c1', 'hand', 'battlefield'));
    expect(face.played).toEqual([]);
  });

  /**
   * It still claims the board. The attribute is what turns off the CSS-only
   * arrival (`styles/board/arrival.ts`), and an object may never wear two motion
   * vocabularies at once — so it is written on the commit the runner takes over,
   * before the browser has painted anything.
   */
  it('marks the board as driven, so the older CSS arrival stands down', () => {
    const root = board();
    root.setCards([]);
    createMotionRunner().sync(root, motionPlan([], { viewer: 0 }));
    expect(root.getAttribute(MOTION_ATTRIBUTE)).toBe('on');
  });
});

describe('a card that is still on the table', () => {
  it('travels from where it was to where it is, and keeps its element', () => {
    const root = board();
    const face = card('c1', { x: 20, y: 660, width: 80, height: 112 });
    root.setCards([face]);
    const runner = createMotionRunner();
    runner.sync(root, motionPlan([], { viewer: 0 }));

    face.moveTo({ x: 300, y: 420, width: 100, height: 140 });
    runner.sync(root, movePlan('c1', 'hand', 'battlefield'));

    expect(face.played).toHaveLength(1);
    const played = face.played[0];
    expect(played?.timing.duration).toBe(MOVE_MS);
    expect(played?.timing.delay).toBe(0);
    // Backwards fill, so the card holds its origin through the delay rather than
    // appearing at its destination and jumping back to travel.
    expect(played?.timing.fill).toBe('backwards');
    expect(played?.frames.at(-1)?.transform).toBe('none');
    const step = invert(
      { x: 20, y: 660, width: 80, height: 112 },
      { x: 300, y: 420, width: 100, height: 140 },
    );
    expect(played?.frames[0]?.transform).toContain(String(Math.round(step.dx * 100) / 100));
  });

  /**
   * A row re-fits every time a permanent lands, so on a busy commit every card
   * on the table has a new box by a pixel or two. Animating those would be a
   * table that shivers, and the cue the plan wrote was about one card.
   */
  it('is left alone when its box only settled', () => {
    const root = board();
    const face = card('c1', { x: 300, y: 420, width: 100, height: 140 });
    root.setCards([face]);
    const runner = createMotionRunner();
    runner.sync(root, motionPlan([], { viewer: 0 }));
    face.moveTo({ x: 300.4, y: 420.2, width: 100, height: 140 });
    runner.sync(root, movePlan('c1', 'hand', 'battlefield'));
    expect(face.played).toEqual([]);
  });
});

describe('a card the board has just drawn', () => {
  it('comes in from the zone the event says it came from', () => {
    const root = board();
    root.setCards([]);
    const runner = createMotionRunner();
    runner.sync(root, motionPlan([], { viewer: 0 }));

    const face = card('c1', { x: 300, y: 420, width: 100, height: 140 });
    root.setCards([face]);
    runner.sync(root, movePlan('c1', 'hand', 'battlefield'));

    expect(face.played).toHaveLength(1);
    expect(face.played[0]?.frames[0]?.opacity).toBe('0');
    expect(face.played[0]?.frames.at(-1)?.opacity).toBe('1');
  });

  /**
   * The library has no element anywhere on the table — a deck is a count in a
   * pod — so a draw falls back to just outside the seat's own edge. A card that
   * rose out of nothing would be the complaint again in a smaller box.
   */
  it('falls back to the seat edge for a zone the board does not draw', () => {
    const root = board();
    root.setCards([]);
    const runner = createMotionRunner();
    runner.sync(root, motionPlan([], { viewer: 0 }));

    const face = card('c1', { x: 100, y: 660, width: 80, height: 112 });
    root.setCards([face]);
    runner.sync(root, movePlan('c1', 'library', 'hand'));
    expect(face.played).toHaveLength(1);
    // Below the near seat's lane, so the card rises into the hand from the edge
    // the viewer's own cards come from.
    expect(face.played[0]?.frames[0]?.transform).toContain('px)');
  });
});

describe('a card that has left the table', () => {
  it('flies to the pile as the element React removed, and is cleared when it lands', () => {
    const root = board();
    const face = card('c1', { x: 300, y: 420, width: 100, height: 140 });
    root.setCards([face]);
    const runner = createMotionRunner();
    runner.sync(root, motionPlan([], { viewer: 0 }));

    face.isConnected = false;
    root.setCards([]);
    runner.sync(root, movePlan('c1', 'battlefield', 'graveyard'));

    // Two elements were made: the plane, and the ghost on it holding the card.
    const [layer, ghost] = root.created;
    expect(layer?.getAttribute(MOTION_ATTRIBUTE)).toBe('layer');
    expect(ghost?.getAttribute(MOTION_ATTRIBUTE)).toBe('ghost');
    expect(ghost?.children[0]).toBe(face);
    expect(ghost?.played[0]?.frames.at(-1)?.opacity).toBe('0');
    expect(ghost?.isConnected).toBe(true);
    ghost?.handles[0]?.onfinish?.();
    expect(ghost?.isConnected).toBe(false);
  });

  /**
   * Equipping moves a creature into the attachment tray, which is a different
   * parent and a different element (`board/Battlefield.ts`, and `mtg-wwy`
   * records the same remount from the other side). The node is still in the
   * document, so it is never stolen out of the table to be flown anywhere.
   */
  it('never takes a node that is still in the document', () => {
    const root = board();
    const face = card('c1', { x: 300, y: 420, width: 100, height: 140 });
    root.setCards([face]);
    const runner = createMotionRunner();
    runner.sync(root, motionPlan([], { viewer: 0 }));
    root.setCards([]);
    runner.sync(root, movePlan('c1', 'battlefield', 'graveyard'));
    expect(root.created).toEqual([]);
    expect(face.isConnected).toBe(true);
  });
});

/**
 * A spell cast and resolved inside one commit emits hand to stack and stack to
 * graveyard. The board only ever shows the end of that, so replaying both would
 * animate a card to a stack it is no longer on and then away from it. What the
 * player saw is one card going from their hand to the graveyard.
 */
describe('two movements of one object in one commit', () => {
  it('is one travel, from the first origin to the last destination', () => {
    const root = board();
    const face = card('c1', { x: 20, y: 660, width: 80, height: 112 });
    root.setCards([face]);
    const runner = createMotionRunner();
    runner.sync(root, motionPlan([], { viewer: 0 }));

    face.isConnected = false;
    root.setCards([]);
    runner.sync(
      root,
      motionPlan(
        [
          { type: 'zoneChanged', oid: 'c1', from: 'hand', to: 'stack', owner: 0 },
          { type: 'zoneChanged', oid: 'c1', from: 'stack', to: 'graveyard', owner: 0 },
        ],
        { viewer: 0 },
      ),
    );
    const ghosts = root.created.filter((node) => node.getAttribute(MOTION_ATTRIBUTE) === 'ghost');
    expect(ghosts).toHaveLength(1);
  });
});

describe('something happening to a permanent in place', () => {
  it('wears the mark from its own beat until its own end, and nothing after', () => {
    const { host, runDue } = manualHost();
    const root = board();
    const face = card('p1', { x: 300, y: 420, width: 100, height: 140 });
    root.setCards([face]);
    const runner = createMotionRunner(host);
    runner.sync(root, motionPlan([], { viewer: 0 }));

    runner.sync(
      root,
      motionPlan(
        [
          {
            type: 'damageDealt',
            sourceOid: 's',
            target: { kind: 'permanent', oid: 'p1' },
            amount: 2,
            deathtouch: false,
            combat: true,
          },
        ],
        { viewer: 0 },
      ),
    );
    expect(face.getAttribute(MARK_ATTRIBUTE)).toBeNull();
    runDue(0);
    expect(face.getAttribute(MARK_ATTRIBUTE)).toBe('damage');
    runDue(MARK_MS);
    expect(face.getAttribute(MARK_ATTRIBUTE)).toBeNull();
  });
});

describe('reduced motion, at the runner', () => {
  /**
   * The plan is already empty (`motion-plan.test.ts`), so this is the property
   * that the emptiness reaches the page: no element is animated, no ghost is
   * made, no attribute is set. The board is exactly what it was.
   */
  it('touches nothing on the page', () => {
    const root = board();
    const face = card('c1', { x: 20, y: 660, width: 80, height: 112 });
    root.setCards([face]);
    const runner = createMotionRunner();
    runner.sync(root, motionPlan([], { viewer: 0 }));

    face.moveTo({ x: 300, y: 420, width: 100, height: 140 });
    runner.sync(
      root,
      motionPlan([{ type: 'zoneChanged', oid: 'c1', from: 'hand', to: 'battlefield', owner: 0 }], {
        viewer: 0,
        reduced: true,
      }),
    );
    expect(face.played).toEqual([]);
    expect(face.getAttribute(MARK_ATTRIBUTE)).toBeNull();
    expect(root.created).toEqual([]);
  });
});

/**
 * `mtg-gt4q`: the pause's Continue is offered *during* the motion now
 * (`routes/play/beat-motion.ts`), so pressing it has to end the motion. What
 * separates a cut from the reset below is the snapshot, and the difference is
 * invisible until the commit after it — which is exactly the commit the player
 * pressed Continue to see.
 */
describe('cutting a beat short', () => {
  it('stops what is in flight and still animates the commit after it', () => {
    const root = board();
    const face = card('c1', { x: 20, y: 660, width: 80, height: 112 });
    root.setCards([face]);
    const runner = createMotionRunner();
    runner.sync(root, motionPlan([], { viewer: 0 }));
    face.moveTo({ x: 300, y: 420, width: 100, height: 140 });
    runner.sync(root, movePlan('c1', 'hand', 'battlefield'));

    runner.cut();
    expect(face.canceled).toBe(1);

    // The board is remembered, so this is an ordinary second commit rather than
    // a first one. Under `reset` it would have been a first commit and the card
    // would have traveled nowhere.
    face.moveTo({ x: 500, y: 420, width: 100, height: 140 });
    runner.sync(root, movePlan('c1', 'battlefield', 'battlefield'));
    expect(face.played).toHaveLength(2);
  });

  /**
   * A departing card is held on a fixed plane past its own removal, so a cut
   * that only canceled animations would leave a dead creature parked over the
   * table for the rest of the game.
   */
  it('takes the plane the departed cards are held on with it', () => {
    const root = board();
    const face = card('c1', { x: 300, y: 420, width: 100, height: 140 });
    root.setCards([face]);
    const runner = createMotionRunner();
    runner.sync(root, motionPlan([], { viewer: 0 }));

    face.isConnected = false;
    root.setCards([]);
    runner.sync(root, movePlan('c1', 'battlefield', 'graveyard'));
    const [layer] = root.created;
    expect(layer?.isConnected).toBe(true);

    runner.cut();
    expect(layer?.isConnected).toBe(false);
  });

  /**
   * A mark is two timers, and canceling them is not the same as undoing them.
   * The attribute goes on with the first and comes off with the second, so a cut
   * between the two leaves the ring painted on a permanent that is still on the
   * board — for the rest of the game, since nothing else ever removes it. Both
   * halves of the window are asserted, because only one of them is a cancel.
   */
  it('takes off a mark that is already showing, and never sets one that is not', () => {
    const damage = motionPlan(
      [
        {
          type: 'damageDealt',
          sourceOid: 's',
          target: { kind: 'permanent', oid: 'p1' },
          amount: 2,
          deathtouch: false,
          combat: true,
        },
      ],
      { viewer: 0 },
    );

    const showing = manualHost();
    const first = board();
    const marked = card('p1', { x: 300, y: 420, width: 100, height: 140 });
    first.setCards([marked]);
    const one = createMotionRunner(showing.host);
    one.sync(first, motionPlan([], { viewer: 0 }));
    one.sync(first, damage);
    showing.runDue(0);
    expect(marked.getAttribute(MARK_ATTRIBUTE)).toBe('damage');
    one.cut();
    expect(marked.getAttribute(MARK_ATTRIBUTE)).toBeNull();

    const waiting = manualHost();
    const second = board();
    const pending = card('p1', { x: 300, y: 420, width: 100, height: 140 });
    second.setCards([pending]);
    const two = createMotionRunner(waiting.host);
    two.sync(second, motionPlan([], { viewer: 0 }));
    two.sync(second, damage);
    two.cut();
    waiting.runDue(MARK_MS);
    expect(pending.getAttribute(MARK_ATTRIBUTE)).toBeNull();
  });
});

describe('leaving the route', () => {
  it('cancels what is in flight and forgets the board', () => {
    const root = board();
    const face = card('c1', { x: 20, y: 660, width: 80, height: 112 });
    root.setCards([face]);
    const runner = createMotionRunner();
    runner.sync(root, motionPlan([], { viewer: 0 }));
    face.moveTo({ x: 300, y: 420, width: 100, height: 140 });
    runner.sync(root, movePlan('c1', 'hand', 'battlefield'));

    runner.reset();
    expect(face.canceled).toBe(1);
    // Forgotten, so the next commit is a first commit again rather than one
    // where every card on a freshly mounted board has apparently departed.
    face.moveTo({ x: 500, y: 420, width: 100, height: 140 });
    runner.sync(root, movePlan('c1', 'hand', 'battlefield'));
    expect(face.played).toHaveLength(1);
  });
});

describe('the arithmetic underneath', () => {
  it('inverts to the offset and the scale between two boxes', () => {
    const step = invert({ x: 0, y: 0, width: 50, height: 70 }, { x: 100, y: 200, width: 100, height: 140 });
    expect(step.dx).toBe(-125);
    expect(step.dy).toBe(-235);
    expect(step.scale).toBe(0.5);
  });

  it('never divides by a box the layout gave no width', () => {
    expect(invert({ x: 0, y: 0, width: 50, height: 70 }, { x: 0, y: 0, width: 0, height: 0 }).scale).toBe(1);
  });

  it('puts an undrawn zone off the far edge of its own seat', () => {
    const lane = { x: 0, y: 400, width: 1200, height: 400 };
    const size = { x: 10, y: 10, width: 100, height: 140 };
    expect(fallbackRect(lane, 'opponent', size).y).toBeLessThan(lane.y);
    expect(fallbackRect(lane, 'you', size).y).toBeGreaterThan(lane.y + lane.height - size.height);
  });
});
