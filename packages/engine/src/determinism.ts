/**
 * The one thing the two engines genuinely do not share, modeled rather than
 * papered over.
 *
 * `@mtg/kernel` is an event-sourced reducer with the RNG inside the state, so
 * **seed plus choice list is the entire record of a game**. `replaySession`
 * rebuilds the game from those two values and `stateFingerprint` checks that
 * what it rebuilt is byte-identical. Everything expensive in this lab is
 * downstream of that: the balance gate is 10,035 seeded games whose per-color
 * win rates come back identical at three different worker widths; `undoTo`
 * rewinds by replaying a prefix; `@mtg/netplay` reopens a table by replaying its
 * choices; the parity harness diffs two engines at a named turn because it can
 * put both of them in the same position twice.
 *
 * A foreign engine promises none of that. Forge may or may not be seedable
 * through a purpose-built bridge — ADR-0001 §8.2 records that as an open
 * question and it is still open — and even a seedable one is reproducible only
 * against itself at one version, since a weekly release can change what the
 * seed means.
 *
 * So the contract has two shapes and a caller must know which it is holding.
 *
 * # Why this is a discriminant and not a capability flag
 *
 * The obvious design is `capabilities.replay: boolean` beside a `replay()`
 * method that throws when it is false. Three things are wrong with it, and the
 * third is the one that matters:
 *
 *  1. A caller can call the method without reading the flag. Nothing fails at
 *     compile time and the failure at run time is a thrown error in the middle
 *     of somebody's game.
 *  2. An optional method invites `backend.replay?.(record)`, which is worse than
 *     the throw: it does nothing, returns `undefined`, and the surface renders an
 *     empty replay as though the game had no moves in it.
 *  3. The flag makes replay look like a feature that is missing, when it is a
 *     **different kind of record**. A recorded backend's record is a seed and a
 *     list of moves and can regenerate every position in the game. An observed
 *     backend's record is a transcript of positions that were observed, and no
 *     position outside it can ever be recovered. Those are not the same value
 *     with a flag on it, and a type that says they are will be believed.
 *
 * So `determinism` is a literal discriminant on both the backend and the
 * session, and the members that only make sense under one of them live only on
 * that arm. A surface that wants to replay has to narrow, and the narrowing is
 * the place where the question "what does this surface do when there is no
 * replay?" is asked. It cannot be skipped, because the member is not there to
 * call.
 *
 * # What each surface does when the recorded arm is absent
 *
 * **The Replay tab keeps working, and this was the surprise.** It reads
 * `packages/ui/public/replay.events.jsonl`: one frame per decision carrying the
 * options, the events and a board snapshot, and `ReplayViewer` steps through the
 * recorded frames rather than re-simulating. That is a transcript reader
 * already. So it is the observed arm's natural consumer, and what it loses under
 * an observed backend is not the tab but two claims about it: that the frames
 * are what the engine would produce again, and that a frame can be resumed into
 * live play.
 *
 * **`@mtg/metrics` is not affected, because it is not downstream of this seam.**
 * Nothing under `packages/metrics/src` imports `@mtg/kernel`; it reads
 * `@mtg/sim`'s log schema. What balance CI actually rests on is `playIndex`
 * being a pure function of (spec, index), which is a property of the sim driver
 * over the kernel. The rule that follows is therefore about the sim and not
 * about metrics: **a mass-simulation substrate must be a recorded backend**, and
 * a function that needs reproducibility takes `RecordedBackend` in its signature
 * rather than checking a flag at run time. An observed backend does not fail
 * that check; it fails to typecheck, which is the earliest place it can fail.
 *
 * **Undo needs it too**, for the mechanical reason that `undoTo` *is* a replay
 * of a prefix. `capabilities.undo` exists as a separate declaration anyway,
 * because a recorded backend may still refuse a rewind — the kernel does, at a
 * commit boundary — and "can reproduce" and "will let you go back" are two
 * different permissions.
 */
import type { MoveId } from './decision';
import type { SessionSpec } from './table';
import type { TableView } from './projection';
import type { EngineEvent } from './events';

export type Determinism = 'recorded' | 'observed';

/**
 * What a backend does beyond playing a game, declared as data.
 *
 * Determinism is deliberately **not** in here. It is the discriminant, one level
 * up, for the reason this file's docblock argues: a boolean in a capability bag
 * is a thing a caller can forget to read, and this is the one property no caller
 * may forget to read.
 *
 * Every field names a consumer that exists. A capability nobody asks about is a
 * promise nobody checks.
 */
export interface BackendCapabilities {
  /**
   * Whether a session can be rewound to an earlier decision.
   *
   * Asked by the play surface's undo control. Separate from determinism because
   * the kernel is recorded and still refuses a rewind past a commit boundary.
   */
  readonly undo: boolean;
  /**
   * Whether a position can be forked cheaply for search.
   *
   * Asked by any bot tier above the greedy one. The kernel forks in O(1) because
   * state is immutable; a subprocess forks by starting another subprocess, which
   * is why this is declared rather than assumed.
   */
  readonly fork: boolean;
  /**
   * Whether every session this backend opens carries a `SeatProjection`.
   *
   * Asked by `@mtg/netplay`, and the distinction is the one `visibility.ts`
   * argues: concealing at the viewer is honest at one screen and is nothing
   * across a wire. A backend that cannot do this cannot serve two machines.
   *
   * The one capability here with something behind it, which is why it is the one
   * capability that is *also* a member: this is the pre-open declaration, for a
   * caller picking a backend before it has a session, and `SessionBase.seats` is
   * the projector it promises. Nothing can be reached through this boolean, and
   * `checkBackend` refuses a backend whose sessions disagree with it in either
   * direction — declaring it does not get a backend out of passing it.
   */
  readonly perSeatProjection: boolean;
  /**
   * Whether the backend's own bots can hold a seat.
   *
   * Asked by every `SeatSpec` with `controller: 'engine'`. A backend that
   * answers false can only seat people.
   */
  readonly engineSeats: boolean;
}

/**
 * A recorded backend's record: the two values a game can be rebuilt from.
 *
 * `moves` holds the ids exactly as they were submitted, which for the kernel are
 * its option indices and for another recorded backend are whatever it hands out.
 * A record is therefore only meaningful to the backend that wrote it, and
 * `backend` is on the value so a reader can refuse one that is not its own
 * rather than replaying it into nonsense.
 */
export interface SessionRecord {
  readonly backend: string;
  readonly table: SessionSpec;
  /** The seed actually used, whether the spec named it or the backend picked. */
  readonly seed: string;
  readonly moves: readonly MoveId[];
}

/**
 * An observed backend's record: positions that were seen, and nothing else.
 *
 * The deliberate difference from `SessionRecord` is that this is a list of
 * *observations* rather than a list of *inputs*. Nothing outside it can be
 * recovered, which is why it carries whole board views: a reader cannot
 * regenerate a position it does not hold, so the position has to be in the file.
 * That is also why it is expensive, and why the kernel does not use it.
 */
export interface TranscriptFrame {
  readonly seq: number;
  readonly view: TableView;
  readonly events: readonly EngineEvent[];
  /** The move submitted at this frame, or null for the opening frame. */
  readonly move: MoveId | null;
}
