/**
 * A block is one position or it is none, and undo has to land on one of those.
 *
 * `mtg-nj6m`. Today a `declareBlockers` decision is answered once, so the
 * recording holds one choice for the whole block and there is nowhere between
 * the two positions to land. Sequencing it into one submit per blocker
 * (`mtg-cs8t`, stage 2) puts k choices where that one was, and `undoTo` takes
 * any prefix at or above the commit floor — so k-1 of the new prefixes replay to
 * a position with some blockers assigned and some not, which is not a position
 * CR 509.1 has. This file measures the window that is there now and fixes the
 * property the sequencing change has to keep.
 *
 * The scan is an absence, so it carries its own positive control: the forbidden
 * position is *built* out of the two real landings either side of the
 * declaration and handed to the same predicate, which says yes to it. Without
 * that the run would be indistinguishable from a scan over a window with
 * nothing in it.
 *
 * `packages/kernel/src/undo.ts` argues why the answer is a landing rule and not
 * an eighth boundary event; `docs/design/blocker-sequence-commitment.md` carries
 * the measurement this file is the executable half of.
 */
import { describe, expect, it } from 'vitest';
import type {
  Action,
  DeckList,
  Decision,
  GameEvent,
  GameSession,
  GameSetup,
  GameState,
  Seat,
} from '@mtg/kernel';
import {
  asksInSteps,
  canUndo,
  choose,
  commitPoint,
  createSession,
  humanSeat,
  passIndex,
  pendingDecision,
  undo,
  UndoRefusedError,
  undoTo,
} from '@mtg/kernel';
import type { Card } from '@mtg/dsl';
import { exampleCard } from '@mtg/dsl';
import { lands, MOUNTAIN } from './cards';

function redDeck(name: string): DeckList {
  const cards: Card[] = [
    ...lands(MOUNTAIN, 17),
    ...Array.from({ length: 8 }, () => exampleCard('slc-emberflow-raider')),
    ...Array.from({ length: 8 }, () => exampleCard('slc-lightning-lash')),
    ...Array.from({ length: 7 }, () => exampleCard('slc-ironclad-golem')),
  ];
  return { name, cards };
}

const SETUP: GameSetup = {
  seed: 'blockers/v2',
  decks: [redDeck('One'), redDeck('Two')],
  maximumTurns: 40,
};

const seats = (): readonly [Seat, Seat] => [humanSeat('One'), humanSeat('Two')];

const PREFERRED = ['playLand', 'castSpell'] as const;

/**
 * A driver that reaches a combat with several creatures in front of one
 * attacker, which is the only kind of block a sequence has an interior in.
 *
 * One seat swings with everything and the other keeps its creatures home, and
 * that asymmetry is the whole trick: a creature that attacked is still tapped on
 * the turn it would otherwise block, so a game where both seats attack with
 * their board reaches combat after combat with at most one legal blocker in it.
 * Six seeds driven with both seats swinging produced a maximum of one blocker;
 * with one seat holding back, this seed reaches three.
 */
function nextChoice(decision: Decision): number {
  if (decision.kind === 'mulligan') {
    const keep = decision.options.findIndex((option: Action) => option.type === 'keepHand');
    return keep < 0 ? 0 : keep;
  }
  if (decision.kind === 'declareBlockers') {
    let widest = 0;
    let at = 0;
    for (const [index, option] of decision.options.entries()) {
      const blocks = option.type === 'declareBlockers' ? option.blocks.length : 0;
      if (blocks > widest) {
        widest = blocks;
        at = index;
      }
    }
    return at;
  }
  if (decision.kind === 'declareAttackers') {
    return decision.player === 0 ? decision.options.length - 1 : 0;
  }
  if (decision.kind !== 'priority') return decision.options.length - 1;
  for (const type of PREFERRED) {
    const found = decision.options.findIndex((option: Action) => option.type === type);
    if (found >= 0) return found;
  }
  return passIndex(decision) ?? 0;
}

/** How many creatures the position has assigned to block, over every attacker. */
function assignedBlockers(state: GameState): number {
  return state.combat.blocks.reduce((total, block) => total + block.blockers.length, 0);
}

/**
 * The position the rules do not have: some of the block is in and the defender
 * is still being asked for the rest.
 *
 * A predicate over a position rather than over the recording, because that is
 * what makes it answerable at all — the recording says how many choices were
 * spent, and only the replayed position says what they left half-done.
 */
function halfAssigned(state: GameState, decision: Decision | null): boolean {
  return decision !== null && decision.kind === 'declareBlockers' && assignedBlockers(state) > 0;
}

interface Block {
  /** The session as it stood with the defender still owing the declaration. */
  readonly before: GameSession;
  /** The same game with the whole block declared. */
  readonly declared: GameSession;
  readonly blockers: number;
}

/**
 * Drives one seeded game to the first whole declaration with two blockers in it.
 *
 * Whole is the load-bearing word there, and it is said rather than assumed. `before`
 * is captured as the position one choice back, so the fixture is only what it
 * claims to be when that one choice was the entire declaration; where the
 * kernel narrows to one creature at a time, one choice back is the middle of
 * the block and every assertion downstream is about a position CR 509.1 does
 * not have. The stepwise arm of the same question has its own fixture
 * (`reachedStepwiseBlock`) and its own describe block.
 *
 * Two guards, because one does not cover it. `asksInSteps` reads the options
 * and catches a declaration the kernel is still narrowing. It does **not**
 * catch the last step of a narrowed declaration: once enough blockers are
 * settled the remainder can fit under the cap, and the kernel then offers the
 * rest whole, with the settled blocks folded into every option and no `settled`
 * field to read. That option list looks exactly like a whole declaration and is
 * the interior of one, so the second guard asks the position instead of the
 * options — a block already half assigned is not a block this fixture opened.
 *
 * Whether a declaration is asked whole is a function of
 * `DEFAULT_ENUMERATION_CAP` against `(attackers + 1) ** blockers`, and a
 * session enumerates at that constant — `createSession` and `choose` take no
 * width — so this fixture cannot state the one it needs the way a direct
 * `pendingDecision` caller can. At a cap low enough to narrow every declaration
 * this seeded game reaches, the throw below is the honest report.
 */
function reachedBlock(): Block {
  let session = createSession(SETUP, seats());
  for (let step = 0; step < 1500 && session.pending !== null; step += 1) {
    const decision = session.pending;
    const index = nextChoice(decision);
    const before = session;
    session = choose(session, index);
    if (decision.kind !== 'declareBlockers') continue;
    if (asksInSteps(decision)) continue;
    if (halfAssigned(before.state, decision)) continue;
    const blockers = assignedBlockers(session.state);
    if (blockers >= 2) return { before, declared: session, blockers };
  }
  throw new Error('the driven game never declared a whole block with two creatures in it');
}

const BLOCK = reachedBlock();

/** Every prefix `undoTo` will land on from a position, floor included. */
function landings(session: GameSession): readonly GameSession[] {
  const floor = session.committed?.floor ?? 0;
  const landed: GameSession[] = [];
  for (let keep = floor; keep <= session.choices.length; keep += 1) {
    landed.push(undoTo(SETUP, session, keep));
  }
  return landed;
}

describe('the window undo may land in around a declared block', () => {
  it('holds no position with the block half assigned', () => {
    // A sequence over this declaration would have an interior at all, which is
    // the thing that makes the scan below about something.
    expect(BLOCK.blockers).toBeGreaterThanOrEqual(2);

    const landed = landings(BLOCK.declared);
    let withBlockers = 0;
    let owingTheDeclaration = 0;
    for (const session of landed) {
      if (assignedBlockers(session.state) > 0) withBlockers += 1;
      if (session.pending?.kind === 'declareBlockers') owingTheDeclaration += 1;
      expect(
        halfAssigned(session.state, session.pending),
        `landing on ${String(session.choices.length)} choices left the block half assigned`,
      ).toBe(false);
    }

    // Both halves of the forbidden position are inside the scanned window, so
    // the absence above is a conjunction that failed rather than two terms that
    // were never there. A window that had lost either one would report clean.
    expect(landed.length).toBeGreaterThanOrEqual(2);
    expect(withBlockers).toBeGreaterThanOrEqual(1);
    expect(owingTheDeclaration).toBeGreaterThanOrEqual(1);
  });

  it('would report the position a sequenced declaration stops at', () => {
    const landed = landings(BLOCK.declared);
    const owing = landed.find((session) => session.pending?.kind === 'declareBlockers');
    const finished = landed.find((session) => assignedBlockers(session.state) > 0);
    if (owing === undefined || finished === undefined) throw new Error('the window lost one of its two ends');

    const block = finished.state.combat.blocks[0];
    const first = block?.blockers[0];
    if (block === undefined || first === undefined) throw new Error('the finished landing declared no block');
    // The interior: the position that still owes the declaration, carrying the
    // first blocker the finished one assigned. It is assembled rather than
    // played because no reducer produces it yet, and it is put to the kernel
    // rather than asserted about, so what makes it half-assigned is the kernel
    // still asking for blockers there.
    const interior: GameState = {
      ...owing.state,
      combat: { ...owing.state.combat, blocks: [{ attacker: block.attacker, blockers: [first] }] },
    };

    const asked = pendingDecision(interior);
    expect(asked?.kind).toBe('declareBlockers');
    expect(asked?.player).toBe(owing.pending?.player);
    expect(halfAssigned(interior, asked)).toBe(true);
    // And the predicate is not simply true of everything: the same position
    // without the block in it is a whole position.
    expect(halfAssigned(owing.state, asked)).toBe(false);
  });

  it('asks the damage assignment order only once the whole block is in', () => {
    // Stage 1 of the sequencing change is `orderDecision`, and this is why it
    // needs none of this: the ordering is a separate decision the kernel asks
    // after the declaration is answered, so its own interior is behind the
    // block's commitment rather than inside it.
    const landed = landings(BLOCK.declared);
    const last = landed[landed.length - 1];
    if (last === undefined) throw new Error('the window was empty');

    expect(last.choices.length).toBe(BLOCK.declared.choices.length);
    expect(assignedBlockers(last.state)).toBe(BLOCK.blockers);
    expect(last.pending?.kind).toBe('orderBlockers');
  });
});

/**
 * The same window around a block the kernel really does ask one creature at a
 * time.
 *
 * The game above answers its block in a single choice, because eight legal
 * assignments fit under the cap and always did. `mtg-tb7v` stage 2 only changes
 * the boards that do not fit, so the interior this file was written to forbid
 * needs a board with more block assignments than the cap lists: this driver
 * lets both seats build up, has the defender decline every block so its
 * creatures stay alive and untapped, and stops at the first declaration the
 * kernel breaks into steps.
 */
function nextChoiceHoldingBlocks(decision: Decision): number {
  // Decline is the first option of a stepwise question and of a listed one
  // alike, so the defender keeps its board and the boards grow.
  if (decision.kind === 'declareBlockers') return 0;
  return nextChoice(decision);
}

interface StepwiseBlock {
  /** The session with the defender owing the declaration and nothing answered. */
  readonly before: GameSession;
  /** The same game one step into the declaration. */
  readonly interior: GameSession;
  /** The same game with the whole declaration answered. */
  readonly declared: GameSession;
}

function reachedStepwiseBlock(): StepwiseBlock {
  let session = createSession(SETUP, seats());
  for (let step = 0; step < 4000 && session.pending !== null; step += 1) {
    const decision = session.pending;
    if (decision.kind === 'declareBlockers' && asksInSteps(decision)) {
      const before = session;
      // Answer every step, taking the first blocking option each time, so the
      // interior is a real recorded prefix rather than an assembled state.
      let interior: GameSession | null = null;
      let current = session;
      for (let inner = 0; inner < 60; inner += 1) {
        const asking = current.pending;
        if (asking === null || asking.kind !== 'declareBlockers') break;
        current = choose(current, asking.options.length > 1 ? 1 : 0);
        if (interior === null && current.pending?.kind === 'declareBlockers') interior = current;
      }
      if (interior === null) throw new Error('the stepwise declaration had no interior');
      return { before, interior, declared: current };
    }
    session = choose(session, nextChoiceHoldingBlocks(decision));
  }
  throw new Error('the driven game never reached a declaration the kernel asked in steps');
}

const STEPWISE = reachedStepwiseBlock();

describe('the window undo may land in around a block asked one creature at a time', () => {
  it('spends more than one choice on the declaration, so the interior is real', () => {
    expect(STEPWISE.interior.choices.length).toBeGreaterThan(STEPWISE.before.choices.length);
    expect(STEPWISE.declared.choices.length).toBeGreaterThan(STEPWISE.interior.choices.length);
    // The interior is exactly the position mtg-nj6m forbids: the kernel is
    // still asking for blockers and part of the block is already in.
    expect(halfAssigned(STEPWISE.interior.state, STEPWISE.interior.pending)).toBe(true);
  });

  it('lands on no half-assigned position, from anywhere in the window', () => {
    for (const session of [STEPWISE.interior, STEPWISE.declared]) {
      for (const landed of landings(session)) {
        expect(
          halfAssigned(landed.state, landed.pending),
          `landing on ${String(landed.choices.length)} choices left the block half assigned`,
        ).toBe(false);
      }
    }
  });

  it('pops the whole block, landing on the position the declaration opened from', () => {
    // Every prefix inside the declaration rewinds to the same place: the
    // position that owes the whole block. A rewind that stopped inside would
    // hand the defender a position CR 509.1 does not have.
    for (let keep = STEPWISE.before.choices.length; keep < STEPWISE.declared.choices.length; keep += 1) {
      const landed = undoTo(SETUP, STEPWISE.declared, keep);
      expect(landed.choices.length).toBe(STEPWISE.before.choices.length);
      expect(assignedBlockers(landed.state)).toBe(0);
      expect(landed.pending?.kind).toBe('declareBlockers');
    }
  });
});

describe('what a declared block commits', () => {
  /** The events the declaration itself appended, and nothing before them. */
  const declaration: readonly GameEvent[] = BLOCK.declared.events.slice(BLOCK.before.events.length);

  it('commits nothing, so the block comes back whole rather than a piece at a time', () => {
    // Non-vacuous: this really is the declaration's slice of the log.
    expect(declaration.some((event) => event.type === 'blockersDeclared')).toBe(true);
    expect(commitPoint(declaration)).toBeNull();

    expect(canUndo(BLOCK.declared)).toBe(true);
    const back = undo(SETUP, BLOCK.declared);
    expect(back.choices).toEqual(BLOCK.before.choices);
    expect(assignedBlockers(back.state)).toBe(0);
    expect(back.pending?.kind).toBe('declareBlockers');
  });

  it('is closed by the pass that follows it and not by the declaration', () => {
    // The alternative `undo.ts` rejects — making the end of the sequence a
    // boundary — would move this refusal onto the declaration itself, and the
    // rewind above would stop working. The refusal belongs here: a pass is where
    // the other seat has been asked.
    let session = BLOCK.declared;
    const past = BLOCK.declared.choices.length;
    for (let step = 0; step < 40 && session.pending !== null; step += 1) {
      if ((session.committed?.floor ?? 0) >= past) break;
      session = choose(session, nextChoice(session.pending));
    }
    expect(session.committed?.reason.event).toBe('priorityPassed');
    expect(session.committed?.floor).toBeGreaterThanOrEqual(past);

    expect(() => undoTo(SETUP, session, BLOCK.before.choices.length)).toThrow(UndoRefusedError);
  });
});
