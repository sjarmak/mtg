/**
 * The declarations the enumeration cannot list, and how they get declared.
 *
 * `enumerate.ts` caps at 512 and a blocker declaration is exponential in the
 * board, so a crowded combat has legal declarations on no list. Measured on this
 * checkout against `blockerDecision`, one scenario board per row, every creature
 * untapped and able to block:
 *
 *   attackers  blockers  declarations  options  asked in steps
 *   1          8         256           256      no
 *   2          6         729           3        yes
 *   3          8         65,536        4        yes
 *
 * `mtg-y1t.2` filed the consequence of the list that used to stop at 512: an
 * index into `decision.options` was the only recorded value, so 217 of the 729
 * declarations on a two-attacker, six-blocker board could not be made through
 * any surface. `mtg-tb7v` stage 2 shrinks the question instead of truncating
 * the answer — past the cap the defender is asked about one creature at a time,
 * so every declaration has a path of indices and the list never reports itself
 * incomplete.
 *
 * Three things are asserted here. Every declaration of the two-attacker board is
 * walked to through indices alone and checked against brute force over
 * `validateAction`. `Decision.candidates` states the same legality one creature
 * at a time, so a roster can offer a pairing no option mentions — and it has to,
 * because a step names one creature and says nothing about the other seven. And
 * a recorded choice may be the action itself, so a whole declaration a player
 * built out of those pairings is still a legal answer to a stepwise question.
 */
import { describe, expect, it } from 'vitest';
import type {
  Action,
  BlockDeclaration,
  Decision,
  GameSession,
  GameState,
  ObjectId,
  ReduceResult,
} from '@mtg/kernel';
import {
  asksInSteps,
  canonicalAction,
  choose,
  chooseAction,
  createSession,
  humanSeat,
  indexOfAction,
  opponentOf,
  pendingDecision,
  reduce,
  replaySession,
  sameAction,
  scenario,
  serializeEvents,
  stateFingerprint,
  validateAction,
} from '@mtg/kernel';
import type { Card } from '@mtg/dsl';
import { exampleCard } from '@mtg/dsl';
import { creature, lands, MOUNTAIN } from './cards';

/**
 * A board with the given creatures attacking and the given creatures untapped to
 * answer them, parked on the blocker declaration.
 *
 * Walked there through the real turn machinery — the attack is declared as an
 * action and both players then pass through CR 508.2's priority — so every
 * position asserted about is one the kernel could have reached itself.
 *
 * `damage` is per blocker and positional, which is how a board states the one
 * difference two copies of a single card can carry without becoming two cards.
 */
function blockingState(
  attackers: readonly Card[],
  blockers: readonly Card[],
  damage: readonly number[] = [],
): GameState {
  const built: ReduceResult = scenario({
    seed: 'kernel/block-enumeration',
    battlefield: [
      ...attackers.map((card) => ({ card, controller: 0 as const })),
      ...blockers.map((card, index) => ({ card, controller: 1 as const, damage: damage[index] })),
    ],
    active: 0,
    turn: 6,
    step: 'declareAttackers',
  });
  const attacking = built.state.battlefield.filter((oid) => built.state.objects[oid]?.controller === 0);
  const defender = opponentOf(0);
  let current = reduce(built.state, {
    type: 'declareAttackers',
    player: 0,
    attackers: attacking.map((oid) => ({ oid, defender })),
  }).state;
  for (let guard = 0; guard < 20; guard += 1) {
    const pending = pendingDecision(current);
    if (pending === null) throw new Error('the game ended before blockers were declared');
    if (pending.kind === 'declareBlockers') return current;
    if (pending.kind !== 'priority') throw new Error(`unexpected decision ${pending.kind}`);
    current = reduce(current, { type: 'passPriority', player: pending.player }).state;
  }
  throw new Error('the board never reached a blocker declaration');
}

/** A session standing on a stated board, so a decision can be answered on it. */
function sessionOn(state: GameState): GameSession {
  const pending = pendingDecision(state);
  if (pending === null) throw new Error('the board left nobody to ask');
  return {
    seats: [humanSeat('you'), humanSeat('them')],
    state,
    events: [],
    result: null,
    pending,
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

function blockerDecisionOn(state: GameState): Extract<Decision, { kind: 'declareBlockers' }> {
  const decision = pendingDecision(state);
  if (decision === null || decision.kind !== 'declareBlockers') {
    throw new Error('the board is not asking for blockers');
  }
  return decision;
}

function vanilla(count: number, prefix: string): readonly Card[] {
  return Array.from({ length: count }, (_, index) => creature(`${prefix} ${String(index)}`, 2, 2));
}

/** Every (blocker, attacker) pair the option list happens to mention. */
function pairsIn(decision: Decision): ReadonlySet<string> {
  const found = new Set<string>();
  for (const option of decision.options) {
    if (option.type !== 'declareBlockers') continue;
    for (const block of option.blocks) found.add(`${block.blocker}>${block.attacker}`);
  }
  return found;
}

describe('the candidate list beside the declaration space', () => {
  it('names every legal pairing on a board whose option list names one creature', () => {
    const state = blockingState(vanilla(3, 'Attacker'), vanilla(8, 'Blocker'));
    const decision = blockerDecisionOn(state);

    // 4^8 = 65,536 declarations, so the question is one creature wide
    // (`mtg-tb7v` stage 2): stay home, or block any of the three attackers.
    expect(asksInSteps(decision)).toBe(true);
    expect(decision.complete).toBe(true);
    expect(decision.options.length).toBe(4);

    const offered = pairsIn(decision);
    const named = new Set(
      decision.candidates.flatMap((entry) =>
        entry.attackers.map((attacker) => `${entry.blocker}>${attacker}`),
      ),
    );
    // 8 blockers x 3 attackers, every one of them legal.
    expect(named.size).toBe(24);
    expect(decision.candidates.map((entry) => entry.blocker)).toEqual([...decision.eligible]);
    // The reason `candidates` is not derivable from `options`, restated for a
    // list that steps rather than truncates: a step names the one creature it
    // is asking about, so a roster built from it would offer seven of the eight
    // blockers nothing at all. `mtg-y1t.2` filed the same gap against the
    // truncated list, where the missing creatures were the ones past the cap.
    expect(offered.size).toBeLessThan(named.size);
    const mute = decision.eligible.filter((oid) => [...offered].every((pair) => !pair.startsWith(`${oid}>`)));
    expect(mute.length).toBe(7);
  });

  it('leaves out a pairing the rules forbid rather than one the cap dropped', () => {
    const flyer = creature('Windborne Herald', 2, 2, { keywords: ['flying'] });
    const grounded = creature('Stone Warden', 2, 3);
    const reacher = creature('Longbow Sentry', 2, 3, { keywords: ['reach'] });
    const decision = blockerDecisionOn(blockingState([flyer], [grounded, reacher]));

    expect(decision.complete).toBe(true);
    // CR 509.1b: only flying or reach may block a flyer. The grounded creature
    // is eligible to block *something* and can block nothing here, so it has no
    // candidate list at all rather than an empty one.
    expect(decision.eligible.length).toBe(2);
    expect(decision.candidates.length).toBe(1);
    expect(decision.candidates[0]?.attackers.length).toBe(1);
  });
});

describe('a legal declaration the cap dropped', () => {
  /** Every blocker onto the last attacker, which the truncation always loses. */
  function gangUp(decision: Extract<Decision, { kind: 'declareBlockers' }>): Action {
    const last = decision.attackers[decision.attackers.length - 1];
    if (last === undefined) throw new Error('nothing is attacking');
    const blocks: BlockDeclaration[] = decision.candidates
      .filter((entry) => entry.attackers.includes(last))
      .map((entry): BlockDeclaration => ({ blocker: entry.blocker, attacker: last }));
    return { type: 'declareBlockers', player: decision.player, blocks };
  }

  it('is declared through the constructed door and recorded as itself', () => {
    const state = blockingState(vanilla(3, 'Attacker'), vanilla(8, 'Blocker'));
    const decision = blockerDecisionOn(state);
    const wanted = gangUp(decision);

    expect(indexOfAction(decision.options, wanted)).toBeNull();

    const applied = chooseAction(sessionOn(state), wanted);

    expect(applied.choices.length).toBe(1);
    // The canonical spelling of the move rather than the caller's, so two
    // players who clicked the same block in different orders record one thing.
    const recorded = applied.choices[0];
    expect(typeof recorded).not.toBe('number');
    expect(sameAction(recorded as Action, wanted)).toBe(true);
    expect(recorded).toEqual(canonicalAction(wanted));
    expect(applied.state.combat.blocks.length).toBe(1);
    expect(applied.state.combat.blocks[0]?.blockers.length).toBe(8);
  });

  it('lands where spending the same recorded value lands', () => {
    const state = blockingState(vanilla(3, 'Attacker'), vanilla(8, 'Blocker'));
    const wanted = gangUp(blockerDecisionOn(state));

    const made = chooseAction(sessionOn(state), wanted);
    const spent = choose(sessionOn(state), made.choices[0] as Action);

    expect(stateFingerprint(spent.state)).toBe(stateFingerprint(made.state));
    expect(serializeEvents(spent.events)).toBe(serializeEvents(made.events));
  });

  it('is still refused when it is illegal, however far past the cap it is', () => {
    // CR 702.110b: menace wants two blockers, and a lone one is illegal whether
    // the enumeration listed the declaration or ran out before it.
    const menacing = creature('Ravening Bellower', 3, 3, { keywords: ['menace'] });
    const state = blockingState([menacing, ...vanilla(2, 'Attacker')], vanilla(8, 'Blocker'));
    const decision = blockerDecisionOn(state);
    const lone = decision.candidates[0];
    if (lone === undefined) throw new Error('nothing can block');
    const half: Action = {
      type: 'declareBlockers',
      player: decision.player,
      blocks: [{ blocker: lone.blocker, attacker: decision.attackers[0] as ObjectId }],
    };

    expect(asksInSteps(decision)).toBe(true);
    expect(() => chooseAction(sessionOn(state), half)).toThrow(/menace/);
    expect(() => choose(sessionOn(state), half)).toThrow(/menace/);
  });
});

/**
 * The claim `mtg-cs8t` filed and `mtg-tb7v` stage 2 answers, checked by walking
 * the whole space rather than by sampling it.
 *
 * Two attackers into six blockers is 3^6 = 729 declarations against a cap of
 * 512, so 217 of them used to have no index and no surface could reach them.
 * The stepwise question is asserted against brute force twice over: every path
 * of indices ends on a legal declaration, and the set of declarations the paths
 * reach is exactly the set `validateAction` accepts. Nothing here constructs an
 * action — `chooseAction` is the other door, and this is the claim that the
 * index door alone is now enough.
 */
/**
 * Budgeted rather than left to vitest's 5s default, and measured rather than
 * guessed.
 *
 * Two of these walk a declaration space by indices and compare it to a brute
 * force over `validateAction`: 729 declarations on the first board, and every
 * one a menace attacker leaves legal on the second. Measured alone 2026-08-16
 * they cost 1372ms and 1019ms, which is comfortable on an idle machine and not
 * comfortable at all when the whole 560-file suite puts fifteen files on
 * sixteen cores. The first timed out at 5661ms in exactly that run and passed
 * alone, which is a budget fault rather than a defect in what it checks.
 *
 * The cost is the point. The walk exists to prove that sequencing a wide
 * declaration reaches the same set a single list would have, so it may not
 * sample and it may not memoize: a cheaper version of this test is a version
 * that proves something weaker. If it starts timing out again on a quiet
 * machine, the enumeration got slower, and that is the thing to look at.
 */
describe('every legal declaration, reached by indices alone', { timeout: 20_000 }, () => {
  /** Every block assignment the walk of the stepwise question arrives at. */
  function walk(state: GameState): ReadonlySet<string> {
    const reached = new Set<string>();
    const visit = (position: GameState, depth: number): void => {
      if (depth > 40) throw new Error('the stepwise declaration did not terminate');
      const decision = pendingDecision(position);
      if (decision === null || decision.kind !== 'declareBlockers') {
        reached.add(blocksKey(position));
        return;
      }
      // A dead end would be a question with no answer, which is the failure
      // mode a menace prefix creates when it is not refused at the offer.
      expect(decision.options.length).toBeGreaterThan(0);
      for (const option of decision.options) visit(reduce(position, option).state, depth + 1);
    };
    visit(state, 0);
    return reached;
  }

  /** The declaration a position ended up with, spelled one way. */
  function blocksKey(state: GameState): string {
    return state.combat.blocks
      .flatMap((block) => block.blockers.map((blocker) => `${blocker}>${block.attacker}`))
      .sort()
      .join('|');
  }

  /** Every assignment of these blockers to these attackers the kernel accepts. */
  function bruteForce(state: GameState): ReadonlySet<string> {
    const decision = blockerDecisionOn(state);
    const legal = new Set<string>();
    const choices: readonly (ObjectId | null)[] = [null, ...decision.attackers];
    const assign = (at: number, blocks: readonly BlockDeclaration[]): void => {
      const blocker = decision.eligible[at];
      if (blocker === undefined) {
        const action: Action = { type: 'declareBlockers', player: decision.player, blocks };
        if (validateAction(state, action) === null) {
          legal.add(
            blocks
              .map((block) => `${block.blocker}>${block.attacker}`)
              .sort()
              .join('|'),
          );
        }
        return;
      }
      for (const attacker of choices) {
        assign(at + 1, attacker === null ? blocks : [...blocks, { blocker, attacker }]);
      }
    };
    assign(0, []);
    return legal;
  }

  it('reaches all 729 of a two-attacker, six-blocker board', () => {
    const state = blockingState(vanilla(2, 'Attacker'), vanilla(6, 'Blocker'));
    const decision = blockerDecisionOn(state);

    expect(asksInSteps(decision)).toBe(true);
    const reached = walk(state);
    const legal = bruteForce(state);
    expect(legal.size).toBe(729);
    expect(reached).toEqual(legal);
  });

  it('holds each answered position to what it answered', () => {
    // A step is an answer about one creature and it stands. The three rules a
    // prefix is held to, each on the same real interior: it may not reach past
    // the creatures it has been asked about, it may not take back a block
    // already declared, and it may not re-aim one. Without them a sequence of
    // answers would be a sequence of drafts, and two different paths would
    // reach one declaration.
    const state = blockingState(vanilla(3, 'Attacker'), vanilla(8, 'Blocker'));
    const opening = blockerDecisionOn(state);
    const first = opening.eligible[0];
    const second = opening.eligible[1];
    const attacker = opening.attackers[0];
    const other = opening.attackers[1];
    if (first === undefined || second === undefined || attacker === undefined || other === undefined) {
      throw new Error('the board is not the board');
    }
    const interior = reduce(state, {
      type: 'declareBlockers',
      player: opening.player,
      blocks: [{ blocker: first, attacker }],
      settled: 1,
    }).state;
    const step = (blocks: readonly BlockDeclaration[], settled: number): Action => ({
      type: 'declareBlockers',
      player: opening.player,
      blocks,
      settled,
    });

    expect(blockerDecisionOn(interior).options.length).toBeGreaterThan(0);
    expect(validateAction(interior, step([], 2))).toMatch(/cannot be taken back/);
    expect(validateAction(interior, step([{ blocker: first, attacker: other }], 2))).toMatch(
      /already blocking something else/,
    );
    expect(
      validateAction(
        interior,
        step(
          [
            { blocker: first, attacker },
            { blocker: second, attacker },
          ],
          1,
        ),
      ),
    ).not.toBeNull();
    // And the answer that keeps the block and settles the next creature is the
    // one the kernel takes.
    expect(
      validateAction(
        interior,
        step(
          [
            { blocker: first, attacker },
            { blocker: second, attacker },
          ],
          2,
        ),
      ),
    ).toBeNull();
  });

  it('refuses at the offer the one prefix nothing left can finish', () => {
    // Menace and flying on one attacker, and exactly one creature that can
    // block a flyer. Putting that creature in front of it alone is legal so far
    // and can never be finished (CR 702.110b needs a second blocker and every
    // other creature is grounded), so the option must not be offered — a listed
    // move that is refused when it is taken is a trap, and `checkBackend` plays
    // a game by taking `options[0]`.
    const menacingFlyer = creature('Ravening Bellower', 3, 3, {
      keywords: ['menace', 'flying'],
    });
    const flyer = creature('Windborne Herald', 2, 2, { keywords: ['flying'] });
    const state = blockingState(
      [menacingFlyer, ...vanilla(3, 'Attacker')],
      [flyer, ...vanilla(7, 'Blocker')],
    );
    const decision = blockerDecisionOn(state);

    expect(asksInSteps(decision)).toBe(true);
    const asking = decision.eligible[0];
    const menacing = decision.attackers[0];
    if (asking === undefined || menacing === undefined) throw new Error('the board is not the board');
    // The pairing is legal on its own — `candidates` offers it, because a
    // candidate is a pairing and not a declaration.
    expect(decision.candidates[0]?.blocker).toBe(asking);
    expect(decision.candidates[0]?.attackers).toContain(menacing);
    // And no step offers it, because no declaration extends it.
    for (const option of decision.options) {
      if (option.type !== 'declareBlockers') continue;
      expect(option.blocks.some((block) => block.attacker === menacing)).toBe(false);
    }
    // Nor does the kernel accept it if a caller builds it anyway.
    expect(() =>
      reduce(state, {
        type: 'declareBlockers',
        player: decision.player,
        blocks: [{ blocker: asking, attacker: menacing }],
        settled: 1,
      }),
    ).toThrow(/no legal block finishes/);
  });

  it('reaches every one a menace attacker leaves legal, and no dead ends', () => {
    // CR 702.110b is the one declaration-level rule that makes a prefix a dead
    // end: a lone blocker on the menacing creature is legal so far and can
    // never be finished once the other blockers are spent. The offer refuses
    // such a prefix, so the walk above finds an option at every node.
    const menacing = creature('Ravening Bellower', 3, 3, { keywords: ['menace'] });
    const state = blockingState([menacing, ...vanilla(1, 'Attacker')], vanilla(6, 'Blocker'));
    const decision = blockerDecisionOn(state);

    expect(asksInSteps(decision)).toBe(true);
    const legal = bruteForce(state);
    // Fewer than the 729 of the plain board, and not by a little: every
    // assignment putting exactly one creature in front of the bellower is out.
    expect(legal.size).toBeLessThan(729);
    expect(legal.size).toBeGreaterThan(0);
    expect(walk(state)).toEqual(legal);
  });
});

describe('an ordering no single question lists', () => {
  /**
   * Six blockers on one attacker is 720 damage-assignment orders (CR 509.2),
   * which no cap worth listing holds, so the question is asked one position at a
   * time (`mtg-tb7v` stage 1). The reversal of the kernel's own first ordering
   * is reachable through those steps and named by no option of the first one.
   */
  function orderingState(): GameState {
    const state = blockingState(vanilla(1, 'Attacker'), vanilla(6, 'Blocker'));
    const decision = blockerDecisionOn(state);
    const attacker = decision.attackers[0];
    if (attacker === undefined) throw new Error('nothing is attacking');
    return reduce(state, {
      type: 'declareBlockers',
      player: decision.player,
      blocks: decision.candidates.map((entry): BlockDeclaration => ({ blocker: entry.blocker, attacker })),
    }).state;
  }

  it('is declared and recorded, where an index could not name it', () => {
    const state = orderingState();
    const decision = pendingDecision(state);
    if (decision === null || decision.kind !== 'orderBlockers') {
      throw new Error('the board is not asking for an order');
    }
    const first = decision.blocks[0];
    if (first === undefined) throw new Error('nothing is blocked');

    // One option per blocker that could take damage first, and complete —
    // complete says the kernel ran out of legal moves rather than stopped
    // listing, and this list is the whole of what this step can be answered
    // with. The 720 orderings are behind it, not left off the end of it.
    expect(asksInSteps(decision)).toBe(true);
    expect(decision.options.length).toBe(first.blockers.length);
    expect(decision.complete).toBe(true);

    const reversed: Action = {
      type: 'orderBlockers',
      player: decision.player,
      orders: [{ attacker: first.attacker, blockers: [...first.blockers].reverse() }],
    };
    expect(indexOfAction(decision.options, reversed)).toBeNull();

    const applied = chooseAction(sessionOn(state), reversed);

    expect(applied.choices[0]).toEqual(reversed);
    expect(applied.state.combat.blocks[0]?.blockers).toEqual([...first.blockers].reverse());
  });
});

/**
 * `mtg-2aca`, measured on the flagship: eight blockers on one attacker, of which
 * three were one creature and two were another, and the rail offered 512
 * seven-line paragraphs where 486 and 504 were character-for-character
 * identical. Three copies of one card make 3! spellings of one decision, and the
 * enumeration listed every one of them.
 */
describe('an ordering that is the ordering beside it', () => {
  /** Several copies of one card, which is what a gang block is actually made of. */
  function copies(count: number, card: Card): readonly Card[] {
    return Array.from({ length: count }, () => card);
  }

  const RAIDER = creature('Emberflow Raider', 2, 2);
  const WARDEN = creature('Stone Warden', 2, 3);

  interface Gang {
    readonly state: GameState;
    readonly decision: Extract<Decision, { kind: 'orderBlockers' }>;
  }

  /** One attacker, every listed creature blocking it, parked on the order. */
  function gangBlocked(blockers: readonly Card[], damage: readonly number[] = []): Gang {
    const state = blockingState([creature('Ravening Bellower', 4, 4)], blockers, damage);
    const declaring = blockerDecisionOn(state);
    const attacker = declaring.attackers[0];
    if (attacker === undefined) throw new Error('nothing is attacking');
    const blocked = reduce(state, {
      type: 'declareBlockers',
      player: declaring.player,
      blocks: declaring.candidates.map((entry): BlockDeclaration => ({ blocker: entry.blocker, attacker })),
    }).state;
    const decision = pendingDecision(blocked);
    if (decision === null || decision.kind !== 'orderBlockers') {
      throw new Error('the board is not asking for an order');
    }
    return { state: blocked, decision };
  }

  /** What each option says, in the words a rail would print it in. */
  function lines(gang: Gang): readonly string[] {
    return gang.decision.options.map((option) =>
      option.type !== 'orderBlockers'
        ? ''
        : option.orders
            .map((order) => order.blockers.map((oid) => gang.state.objects[oid]?.card.name ?? '?').join(', '))
            .join('; '),
    );
  }

  it('is one decision when three copies of one creature gang up', () => {
    const gang = gangBlocked(copies(3, RAIDER));

    // 3! permutations of three interchangeable objects, and one decision.
    expect(gang.decision.options.length).toBe(1);
    expect(gang.decision.complete).toBe(true);
    expect(gang.decision.blocks[0]?.blockers.length).toBe(3);
  });

  it('keeps every ordering the board can tell apart', () => {
    const gang = gangBlocked([RAIDER, RAIDER, WARDEN]);

    // Where the warden sits is the whole of the choice: 3!/2! = 3.
    expect(gang.decision.options.length).toBe(3);
    expect(gang.decision.complete).toBe(true);
    expect(new Set(lines(gang)).size).toBe(3);
  });

  it('separates two copies the moment the board separates them', () => {
    expect(gangBlocked(copies(2, RAIDER)).decision.options.length).toBe(1);

    // One of them has taken a point of damage, so it dies to less and the two
    // orderings are two answers (CR 510.1c).
    const marked = gangBlocked(copies(2, RAIDER), [1, 0]);

    expect(marked.decision.options.length).toBe(2);
  });

  it('reads differently on every line of the board that filed this', () => {
    const gang = gangBlocked([
      ...copies(3, RAIDER),
      ...copies(2, WARDEN),
      creature('Ironclad Golem', 1, 4),
      creature('Longbow Sentry', 3, 1),
      creature('Windborne Herald', 1, 3),
    ]);

    // 8!/(3!2!) = 3,360 orderings, so the question is asked a position at a
    // time — and the position offers five moves rather than eight, because
    // three copies of one card are one move. That is the whole of `mtg-2aca`:
    // the rail's paragraph 486 and its paragraph 504 were the same paragraph,
    // and no two lines here read alike.
    expect(asksInSteps(gang.decision)).toBe(true);
    expect(gang.decision.complete).toBe(true);
    expect(new Set(lines(gang))).toEqual(
      new Set(['Emberflow Raider', 'Stone Warden', 'Ironclad Golem', 'Longbow Sentry', 'Windborne Herald']),
    );
    expect(new Set(lines(gang)).size).toBe(gang.decision.options.length);
    expect(gang.decision.options.length).toBe(5);
  });

  it('still accepts a spelling it no longer lists', () => {
    const gang = gangBlocked(copies(3, RAIDER));
    const block = gang.decision.blocks[0];
    if (block === undefined) throw new Error('nothing is blocked');
    const swapped: Action = {
      type: 'orderBlockers',
      player: gang.decision.player,
      orders: [{ attacker: block.attacker, blockers: [...block.blockers].reverse() }],
    };

    // Not on the list under its own spelling, and not illegal either:
    // `validateOrdering` never read the list.
    expect(indexOfAction(gang.decision.options, swapped)).toBeNull();

    const applied = chooseAction(sessionOn(gang.state), swapped);

    // It is the listed option said backwards, so it records as that option's
    // index and lands on that option's board — which is the same board, because
    // the three creatures the reversal moved are one creature three times.
    expect(applied.choices).toEqual([0]);
    expect(applied.state.combat.blocks[0]?.blockers).toEqual([...block.blockers]);
  });
});

describe('a recording that holds actions', () => {
  const deck = (name: string): { readonly name: string; readonly cards: readonly Card[] } => ({
    name,
    cards: [
      ...lands(MOUNTAIN, 17),
      ...Array.from({ length: 8 }, () => exampleCard('slc-emberflow-raider')),
      ...Array.from({ length: 8 }, () => exampleCard('slc-lightning-lash')),
      ...Array.from({ length: 7 }, () => exampleCard('slc-ironclad-golem')),
    ],
  });
  const SETUP = { seed: 'kernel/block-enumeration/v0', decks: [deck('One'), deck('Two')] as const };
  const seats = () => [humanSeat('one'), humanSeat('two')] as const;

  /**
   * The determinism assertion the wider recorded type rests on. A whole game is
   * played by handing `choose` the *action* at each decision rather than its
   * index — the shape a declaration past the cap records — and the recording is
   * then replayed. Nothing about the game is unusual; what is being checked is
   * that a recording of actions reproduces a position byte for byte, exactly as
   * a recording of integers does.
   */
  it('replays byte for byte', () => {
    let played = createSession(SETUP, seats());
    for (let step = 0; step < 10_000 && played.pending !== null; step += 1) {
      played = choose(played, played.pending.options[0] as Action);
    }

    expect(played.result).not.toBeNull();
    expect(played.choices.length).toBeGreaterThan(50);
    expect(played.choices.every((choice) => typeof choice !== 'number')).toBe(true);

    const replayed = replaySession(SETUP, seats(), played.choices);

    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(played.state));
    expect(serializeEvents(replayed.events)).toBe(serializeEvents(played.events));
    expect(replayed.choices).toEqual(played.choices);
  });

  it('reaches the same position a recording of the same moves by index does', () => {
    let byIndex = createSession(SETUP, seats());
    for (let step = 0; step < 10_000 && byIndex.pending !== null; step += 1) {
      byIndex = choose(byIndex, 0);
    }
    let byAction = createSession(SETUP, seats());
    for (let step = 0; step < 10_000 && byAction.pending !== null; step += 1) {
      byAction = choose(byAction, byAction.pending.options[0] as Action);
    }

    expect(stateFingerprint(byAction.state)).toBe(stateFingerprint(byIndex.state));
    expect(serializeEvents(byAction.events)).toBe(serializeEvents(byIndex.events));
  });

  it('mixes the two shapes in one recording', () => {
    let session = createSession(SETUP, seats());
    for (let step = 0; step < 40 && session.pending !== null; step += 1) {
      session = step % 2 === 0 ? choose(session, 0) : choose(session, session.pending.options[0] as Action);
    }

    expect(session.choices.some((choice) => typeof choice === 'number')).toBe(true);
    expect(session.choices.some((choice) => typeof choice !== 'number')).toBe(true);

    const replayed = replaySession(SETUP, seats(), session.choices);

    expect(stateFingerprint(replayed.state)).toBe(stateFingerprint(session.state));
  });
});
