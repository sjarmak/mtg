// @vitest-environment node
/**
 * The plan: what the table shows and in what order, derived from events alone.
 *
 * The playtester, 2026-08-16: effects happening automatically are jarring, and the
 * reference is Magic Online — every state change legible as a movement with a
 * source, a destination and a beat, and a chain of triggers that reads as
 * several things rather than as one frame. `mtg-ncg` is the bead.
 *
 * This file is the half of that claim that is a pure function. `motionPlan` maps
 * a batch of kernel events to an ordered list of cues, each with the moment it
 * starts and how long it runs, and takes no DOM, no clock and no React. So the
 * three properties a reader would otherwise have to take on trust — that the
 * order is the kernel's, that a chain paces out, and that a sweep cannot make
 * anybody wait — are exact assertions here rather than something to eyeball.
 *
 * What it cannot answer is where any of it lands on screen. That is
 * `motion-runner.test.ts` (the matching and the FLIP arithmetic) and
 * `motion.browser.test.ts` (the sheet, in a real engine).
 */
import { describe, expect, it } from 'vitest';
import type { GameEvent, ZoneId } from '@mtg/kernel';
import { motionPlan } from '../../src/motion/plan';
import type { MotionCue } from '../../src/motion/plan';
import {
  BEAT_GAP_MS,
  ECHO_GAP_MS,
  MARK_FAST_MS,
  MARK_MS,
  MOTION_BUDGET_MS,
  MOVE_MS,
} from '../../src/motion/timing';

const VIEWER = 0;

function moved(oid: string, from: ZoneId, to: ZoneId, owner: 0 | 1 = VIEWER): GameEvent {
  return { type: 'zoneChanged', oid, from, to, owner };
}

/** Events the motion layer is deliberately deaf to, used as filler. */
const NOISE: readonly GameEvent[] = [
  { type: 'priorityGained', player: 0 },
  { type: 'priorityPassed', player: 0 },
  { type: 'permanentUntapped', oid: 'land-1' },
  { type: 'lifeChanged', player: 1, delta: -3, life: 17, reason: 'damage' },
];

function kinds(cues: readonly MotionCue[]): readonly string[] {
  return cues.map((cue) => (cue.kind === 'move' ? `${cue.from}>${cue.to}` : `${cue.mark}:${cue.oid}`));
}

describe('what the plan is worth reading from', () => {
  it('turns every zone movement into a cue, in the kernel order', () => {
    const plan = motionPlan(
      [
        moved('c1', 'library', 'hand'),
        moved('c1', 'hand', 'battlefield'),
        moved('c2', 'battlefield', 'graveyard'),
      ],
      { viewer: VIEWER },
    );
    expect(kinds(plan.cues)).toEqual(['library>hand', 'hand>battlefield', 'battlefield>graveyard']);
    for (const cue of plan.cues) expect(cue.durationMs).toBe(MOVE_MS);
  });

  /**
   * The seat is the viewer's, not the kernel's. A card owned by player 1 is on
   * the far half of a board player 0 is looking at, and the runner finds a zone
   * by that half rather than by a player number the DOM has never heard of.
   */
  it('names the half of the table each card belongs to, from the viewer chair', () => {
    const events = [moved('mine', 'hand', 'battlefield', 0), moved('theirs', 'hand', 'battlefield', 1)];
    const seats = motionPlan(events, { viewer: 0 }).cues.map((cue) =>
      cue.kind === 'move' ? cue.seat : null,
    );
    expect(seats).toEqual(['you', 'opponent']);
    const flipped = motionPlan(events, { viewer: 1 }).cues.map((cue) =>
      cue.kind === 'move' ? cue.seat : null,
    );
    expect(flipped).toEqual(['opponent', 'you']);
  });

  it('marks a permanent that damage, a counter, a tap or a trigger reached', () => {
    const events: readonly GameEvent[] = [
      {
        type: 'damageDealt',
        sourceOid: 's',
        target: { kind: 'permanent', oid: 'p1' },
        amount: 2,
        deathtouch: false,
        combat: true,
      },
      { type: 'countersChanged', oid: 'p2', plusOnePlusOne: 1, minusOneMinusOne: 0 },
      { type: 'permanentTapped', oid: 'p3' },
      {
        type: 'triggerTargetsChosen',
        oid: 'a',
        source: 's',
        targets: [{ kind: 'permanent', oid: 'p4' }, null],
      },
    ];
    expect(kinds(motionPlan(events, { viewer: VIEWER }).cues)).toEqual([
      'damage:p1',
      'counter:p2',
      'tap:p3',
      'target:p4',
    ]);
  });

  /**
   * Damage to a player is a life total, which is not a card and has nothing to
   * travel. The pod's number changing is what a seat taking damage looks like,
   * and giving it a cue would have meant a second motion vocabulary for a
   * surface with no geometry in common with a card.
   */
  it('says nothing about damage to a player', () => {
    const event: GameEvent = {
      type: 'damageDealt',
      sourceOid: 's',
      target: { kind: 'player', player: 1 },
      amount: 3,
      deathtouch: false,
      combat: true,
    };
    expect(motionPlan([event], { viewer: VIEWER }).cues).toEqual([]);
  });

  /**
   * The stream is two thirds priority and bookkeeping by count (`log/group.ts`
   * measures 589 priority lines in a 1252-event game), and an animation layer
   * that grew a cue per event would be the firehose `mtg-81a` was told not to
   * build. Silence is the default for anything nobody has decided should move.
   */
  it('is silent on the events that are two thirds of the stream', () => {
    expect(motionPlan(NOISE, { viewer: VIEWER }).cues).toEqual([]);
  });
});

describe('how a chain paces out', () => {
  it('starts each fresh cue one beat after the last, and overlaps rather than queues', () => {
    const plan = motionPlan(
      [
        moved('c1', 'battlefield', 'graveyard'),
        moved('c2', 'battlefield', 'graveyard'),
        moved('c3', 'battlefield', 'graveyard'),
      ],
      { viewer: VIEWER },
    );
    expect(plan.cues.map((cue) => cue.atMs)).toEqual([0, BEAT_GAP_MS, BEAT_GAP_MS * 2]);
    // Overlap is the point: three cards leaving take one gap each, not one
    // whole travel each, so the chain is 420ms rather than 720ms.
    expect(plan.totalMs).toBe(BEAT_GAP_MS * 2 + MOVE_MS);
    expect(plan.totalMs).toBeLessThan(MOVE_MS * 3);
  });

  /**
   * The second time the same object does the same thing in one chain it pays the
   * short gap. The case is the sweep — a board wipe, a mass mill, a combat
   * damage step over eight creatures — where the full gap per object would spend
   * the whole budget on the first six of them.
   */
  it('paces a repeat at the short gap and a tap at the short gap from the start', () => {
    const events: readonly GameEvent[] = [
      { type: 'permanentTapped', oid: 'p1' },
      { type: 'permanentTapped', oid: 'p2' },
      { type: 'countersChanged', oid: 'p3', plusOnePlusOne: 1, minusOneMinusOne: 0 },
      { type: 'countersChanged', oid: 'p3', plusOnePlusOne: 2, minusOneMinusOne: 0 },
    ];
    const plan = motionPlan(events, { viewer: VIEWER });
    expect(plan.cues.map((cue) => cue.atMs)).toEqual([
      0,
      ECHO_GAP_MS,
      ECHO_GAP_MS * 2,
      ECHO_GAP_MS * 2 + BEAT_GAP_MS,
    ]);
    expect(plan.cues.map((cue) => cue.durationMs)).toEqual([MARK_FAST_MS, MARK_FAST_MS, MARK_MS, MARK_MS]);
  });

  /**
   * The ceiling, which is the requirement that a player who has seen this a
   * thousand times is never waiting on it. Past `MOTION_BUDGET_MS` the remaining
   * cues all start together — they are not dropped, because a cue dropped is the
   * board and the log disagreeing about whether something happened.
   */
  it('never starts a cue past the budget, and drops none of them', () => {
    const wipe = Array.from({ length: 40 }, (_unused, index): GameEvent =>
      moved(`c${String(index)}`, 'battlefield', 'graveyard'),
    );
    const plan = motionPlan(wipe, { viewer: VIEWER });
    expect(plan.cues).toHaveLength(40);
    for (const cue of plan.cues) expect(cue.atMs).toBeLessThanOrEqual(MOTION_BUDGET_MS);
    expect(plan.cues.at(-1)?.atMs).toBe(MOTION_BUDGET_MS);
    expect(plan.totalMs).toBe(MOTION_BUDGET_MS + MOVE_MS);
  });

  it('gives every cue a key of its own, so nothing collapses two events into one', () => {
    const plan = motionPlan([moved('c1', 'hand', 'stack'), moved('c1', 'stack', 'graveyard')], {
      viewer: VIEWER,
    });
    expect(new Set(plan.cues.map((cue) => cue.key)).size).toBe(2);
  });
});

/**
 * The hard requirement on this lane: reduce turns all of it off, and the game
 * stays fully playable and readable. It is answered here, before any event is
 * read, and it is answered with an empty plan rather than with short durations —
 * a 1ms travel is a card teleporting with extra steps, and a 1ms highlight is a
 * flash, which is the thing a viewer asking for less motion is asking not to
 * get. Nothing is lost: every cue is a second rendering of something the board
 * already draws and the log already narrates.
 */
describe('prefers-reduced-motion', () => {
  it('plans nothing at all, and says why the plan is empty', () => {
    const events = [
      moved('c1', 'battlefield', 'graveyard'),
      { type: 'permanentTapped', oid: 'p1' } as GameEvent,
    ];
    const plan = motionPlan(events, { viewer: VIEWER, reduced: true });
    expect(plan.cues).toEqual([]);
    expect(plan.totalMs).toBe(0);
    expect(plan.reduced).toBe(true);
    // The same batch with the preference off is the control: the emptiness is
    // the preference, not the events.
    expect(motionPlan(events, { viewer: VIEWER, reduced: false }).cues).toHaveLength(2);
  });

  it('is not the same value as having nothing to show', () => {
    expect(motionPlan([], { viewer: VIEWER }).reduced).toBe(false);
  });
});
