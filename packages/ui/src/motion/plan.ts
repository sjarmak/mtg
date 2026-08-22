/**
 * What the table should show, derived from the event stream and from nothing
 * else.
 *
 * The complaint (`mtg-ncg`, and the playtester's own words) is that the board applies
 * state instantly: a creature dies and it is simply gone, damage lands and the
 * number has already changed. The board is a projection of `GameState`, so a
 * projection can only ever show the *result*. What changed is in `session.events`
 * — the kernel emits a `zoneChanged` for every movement it makes, with the
 * object, the zone it left and the zone it arrived in — so the animation is a
 * rendering of the event log, exactly as the game log's sentences are.
 *
 * That choice is the whole architecture of this lane, and the alternative is
 * worth naming: a diff of two rendered boards. A diff can tell that a card is no
 * longer on the battlefield and is now in a graveyard, but it cannot tell that
 * from a card that was exiled and a *different* card that was milled, it has no
 * order between two changes in one render, and it is a second derivation of
 * something the kernel already wrote down. `../log/group.ts` reached the same
 * conclusion one surface over and keys a movement as `(oid, from, to)`; this
 * file keys a cue the same way for the same reason.
 *
 * # Pure, and that is what makes it testable
 *
 * Everything here is a function of the events and two flags. No DOM, no clock,
 * no React. What a cue *is* — which object, which zones, in which order, for how
 * long — is settled here and asserted in `test/play/motion.test.ts`; where on
 * screen the two zones happen to be is `./runner.ts`'s problem and is answered
 * by measuring the laid-out page. A plan for a board nobody has rendered is a
 * legitimate value, which is why the ordering and the pacing can be held to
 * exact numbers in a test that starts no browser.
 *
 * # What is deliberately not animated
 *
 * - **A player's life total.** It is damage arriving at a seat, not at a card,
 *   and the pod that draws it is not a card-shaped thing that can travel. The
 *   pod's own number changing is the mark, and giving it one of these cues would
 *   have meant a second motion vocabulary for a surface with no geometry in
 *   common with a card.
 * - **Mana produced, paid and emptied; priority; the step and turn headings.**
 *   These are `../log/group.ts`'s `detail` and `priority` tiers, which is
 *   two thirds of the stream by count. Animating them is the firehose `mtg-81a`
 *   was told not to build.
 * - **A card the viewer may not see.** A `zoneChanged` inside an opponent's
 *   library or hand is a real movement of an object with no element on screen;
 *   the runner finds nothing to move and the cue costs a lookup. It is left in
 *   the plan rather than filtered here because whether an object is *drawn* is a
 *   fact about the rendered page, not about the event.
 */
import type { GameEvent, ObjectId, PlayerId, ZoneId } from '@mtg/kernel';
import { BEAT_GAP_MS, ECHO_GAP_MS, MARK_FAST_MS, MARK_MS, MOTION_BUDGET_MS, MOVE_MS } from './timing';

/** Which half of the table an object belongs to, from the viewer's chair. */
export type MotionSeat = 'you' | 'opponent';

/**
 * The four things that can happen to a permanent in place.
 *
 * One name per kind rather than one generic highlight, because the sheet draws
 * them in different colors and a reader of a plan should be able to tell a
 * counter from a wound without reading a stylesheet.
 */
export type MotionMark = 'damage' | 'counter' | 'tap' | 'target';

interface CueBase {
  /** Unique inside a plan; the runner uses it to cancel and to key nothing else. */
  readonly key: string;
  readonly oid: ObjectId;
  /** Milliseconds after the chain starts. */
  readonly atMs: number;
  readonly durationMs: number;
}

export interface MoveCue extends CueBase {
  readonly kind: 'move';
  readonly from: ZoneId;
  readonly to: ZoneId;
  readonly seat: MotionSeat;
}

export interface MarkCue extends CueBase {
  readonly kind: 'mark';
  readonly mark: MotionMark;
}

export type MotionCue = MoveCue | MarkCue;

export interface MotionPlan {
  readonly cues: readonly MotionCue[];
  /** When the last cue is finished, so a caller can size a timeout once. */
  readonly totalMs: number;
  /** True when the plan is empty because the viewer asked for less motion. */
  readonly reduced: boolean;
}

export interface MotionPlanInput {
  /** The seat reading the board, so a cue can say which half it belongs to. */
  readonly viewer: PlayerId;
  /** `prefers-reduced-motion: reduce`. A true here is an empty plan. */
  readonly reduced?: boolean;
}

/** Nothing to do, said once so every early return is the same value. */
const EMPTY: MotionPlan = { cues: [], totalMs: 0, reduced: false };

/**
 * A cue before it has been given a time. The pacing pass is separate from the
 * reading pass because the gap a cue earns depends on the cues before it, and
 * mixing the two would mean the event switch knowing about the budget.
 */
interface RawCue {
  readonly kind: 'move' | 'mark';
  readonly oid: ObjectId;
  readonly mark?: MotionMark;
  readonly from?: ZoneId;
  readonly to?: ZoneId;
  readonly seat?: MotionSeat;
}

function seatOf(owner: PlayerId, viewer: PlayerId): MotionSeat {
  return owner === viewer ? 'you' : 'opponent';
}

/**
 * The cues one event is worth, in the order they should be seen.
 *
 * Most events are worth none, and the switch says so by falling through: this is
 * deliberately not exhaustive over `GameEvent`, unlike `../log/group.ts`'s
 * `eventRole`. The log has to place every event or it stops being the record;
 * an animation that grew a cue every time the kernel gained an event would grow
 * toward the firehose. A new kernel event is silent here until somebody decides
 * it should move something, and that is the safe default.
 */
function cuesFor(event: GameEvent, viewer: PlayerId): readonly RawCue[] {
  switch (event.type) {
    case 'zoneChanged':
      return [
        {
          kind: 'move',
          oid: event.oid,
          from: event.from,
          to: event.to,
          seat: seatOf(event.owner, viewer),
        },
      ];
    case 'damageDealt':
      // Damage to a player is a life total, which is not a card and has no
      // travel; the pod's number changing is what a seat taking damage looks
      // like. See the module docblock.
      return event.target.kind === 'permanent'
        ? [{ kind: 'mark', oid: event.target.oid, mark: 'damage' }]
        : [];
    case 'countersChanged':
      return [{ kind: 'mark', oid: event.oid, mark: 'counter' }];
    case 'permanentTapped':
      return [{ kind: 'mark', oid: event.oid, mark: 'tap' }];
    case 'triggerTargetsChosen':
      // The one targeting nobody clicked. A target the *player* is choosing is
      // already lit by `../styles/board/aim.ts` while they aim; a trigger picks
      // its targets with no gesture at all, which is precisely the case where
      // the board changed and nothing said where it came from.
      return event.targets.flatMap((target): readonly RawCue[] =>
        target !== null && target.kind === 'permanent'
          ? [{ kind: 'mark', oid: target.oid, mark: 'target' }]
          : [],
      );
    default:
      return [];
  }
}

/** How long a cue runs. A tap is the one that is shorter, and `./timing.ts` says why. */
function durationOf(cue: RawCue): number {
  if (cue.kind === 'move') return MOVE_MS;
  return cue.mark === 'tap' ? MARK_FAST_MS : MARK_MS;
}

/**
 * What makes two cues the same news, for the purpose of the shorter gap.
 *
 * The object and the kind, not the zones: a card that goes hand to stack to
 * graveyard in one chain is one card doing one thing as far as the pace is
 * concerned, and a second combat damage mark on a creature already marked this
 * chain is the same. Two *different* creatures dying is two things and pays the
 * full gap each, which is the whole point of the pacing.
 */
function echoKey(cue: RawCue): string {
  return `${cue.kind}|${cue.oid}|${cue.mark ?? ''}`;
}

/**
 * The plan for one batch of events: every cue those events are worth, in stream
 * order, each with the moment it starts.
 *
 * The batch is the events appended since the last render, so a whole bot turn
 * that lands in one commit is one chain and paces out inside it. Ordering is the
 * kernel's, never re-sorted — the kernel emitted the trigger before its effect,
 * so showing them in that order is showing what happened.
 */
export function motionPlan(events: readonly GameEvent[], input: MotionPlanInput): MotionPlan {
  // Reduced motion is answered before anything is read, and it is answered with
  // an empty plan rather than with short durations. A 1ms travel is a card
  // teleporting with extra steps; the requirement is that the motion is off and
  // the board is fully readable without it, which it is, because every cue here
  // is a second rendering of something the board already draws and the log
  // already narrates.
  if (input.reduced === true) return { cues: [], totalMs: 0, reduced: true };
  if (events.length === 0) return EMPTY;

  const cues: MotionCue[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  let totalMs = 0;

  for (const [index, event] of events.entries()) {
    for (const [offset, raw] of cuesFor(event, input.viewer).entries()) {
      const key = `${String(index)}-${String(offset)}-${raw.oid}`;
      const durationMs = durationOf(raw);
      // Past the ceiling every remaining cue starts together rather than being
      // dropped: the board must not disagree with the log about what happened.
      const atMs = Math.min(cursor, MOTION_BUDGET_MS);
      const repeat = seen.has(echoKey(raw));
      seen.add(echoKey(raw));
      // A tap pays the short gap on its first appearance too. It is the most
      // frequent mark on the table and the one the board already states by
      // rotating the card, so it never sets the pace for what follows it.
      const gap = repeat || raw.mark === 'tap' ? ECHO_GAP_MS : BEAT_GAP_MS;
      cursor = atMs + gap;
      totalMs = Math.max(totalMs, atMs + durationMs);
      if (raw.kind === 'move') {
        const from = raw.from;
        const to = raw.to;
        const seat = raw.seat;
        // A move with no zones is unconstructible above; the guard is what turns
        // that into a type rather than a comment.
        if (from === undefined || to === undefined || seat === undefined) continue;
        cues.push({ kind: 'move', key, oid: raw.oid, atMs, durationMs, from, to, seat });
        continue;
      }
      const mark = raw.mark;
      if (mark === undefined) continue;
      cues.push({ kind: 'mark', key, oid: raw.oid, atMs, durationMs, mark });
    }
  }

  return { cues, totalMs, reduced: false };
}
