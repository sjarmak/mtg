/**
 * The two set-selection decisions, at a width their enumeration cannot list.
 *
 * `discardDecision` and `mulliganDecision` are one `combinations` call each, and
 * a binomial passes the enumeration cap on a board a real game reaches: twelve
 * cards discarding five is C(12,5) = 792 against `DEFAULT_ENUMERATION_CAP` of
 * 512, so 280 legal discards used to have no index — unreachable through
 * `submit` by any surface, and a `checkBackend` finding against our own kernel.
 *
 * `mtg-cs8t` steps 1 and 2 shrink the question instead of truncating the answer,
 * the same hybrid `mtg-tb7v` installed at the three combat sites: while the whole
 * remaining product fits under the cap the flat list is emitted index for index
 * exactly as before, and only past the cap does the question shrink to "which
 * card goes next". Two properties follow and both are asserted here at the
 * default cap rather than a shrunk one, because a gate that only fires under a
 * cap nobody passes is not a gate.
 *
 *  - `complete` is unconditionally true. A step list is one option per card
 *    still eligible, which is linear in the hand rather than binomial in it, so
 *    no cap can bite on it.
 *  - Every legal selection is reachable through indices alone. This is asserted
 *    as **set equality against brute force over `validateAction`**, never as a
 *    count: a kernel that offered one selection twice and another never would
 *    pass a count and fail a person.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { basicLand, parseCard } from '@mtg/dsl';
import type { Action, Decision, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import {
  DEFAULT_ENUMERATION_CAP,
  asksInSteps,
  createGame,
  pendingDecision,
  reduce,
  scenario,
  stateFingerprint,
  validateAction,
} from '@mtg/kernel';

/** A hand of distinguishable cards, so a selection is a set of real choices. */
function handCard(index: number): Card {
  return parseCard({
    kind: 'creature',
    id: `sel-${String(index)}`,
    name: `Selection Subject ${String(index)}`,
    rarity: 'common',
    set: { code: 'SEL', collectorNumber: index + 1 },
    manaCost: { generic: index % 4, G: 1 },
    colors: ['G'],
    power: 1 + (index % 3),
    toughness: 2,
  });
}

/**
 * The active player holding `handSize` cards in their cleanup step, with a
 * maximum hand size of seven.
 *
 * Walked there through the real turn machinery rather than assembled, so the
 * position asserted about is one the kernel could have reached itself.
 */
function discardState(handSize: number): GameState {
  const hand = Array.from({ length: handSize }, (_, index) => handCard(index));
  let current = scenario({
    seed: 'kernel/selection-sequence',
    hands: [hand, []],
    active: 0,
    turn: 6,
    step: 'end',
    maximumHandSize: 7,
  }).state;
  for (let guard = 0; guard < 20; guard += 1) {
    const pending = pendingDecision(current);
    if (pending === null) throw new Error('the game ended before the cleanup step');
    if (pending.kind === 'discard') return current;
    if (pending.kind !== 'priority') throw new Error(`unexpected decision ${pending.kind}`);
    current = reduce(current, { type: 'passPriority', player: pending.player }).state;
  }
  throw new Error('the turn never reached a discard');
}

const FOREST = basicLand('Forest', 'SEL', 90);

/**
 * A seat that has mulliganed `taken` times out of an opening hand of
 * `openingHandSize`, which is the only dial that widens this decision: the keeps
 * are C(openingHandSize, mulligans) and nothing else in the position moves it.
 */
function mulliganState(openingHandSize: number, taken: number): GameState {
  const cards: Card[] = [];
  for (let index = 0; index < 40; index += 1) {
    cards.push(index % 4 === 3 ? FOREST : handCard(index % 12));
  }
  const deck = { name: 'selection', cards };
  let current = createGame({
    seed: 'kernel/selection-sequence',
    decks: [deck, deck] as const,
    openingHandSize,
  }).state;
  for (let step = 0; step < taken; step += 1) {
    const pending = pendingDecision(current);
    if (pending === null || pending.kind !== 'mulligan') throw new Error('the seat is not being asked');
    current = reduce(current, { type: 'mulligan', player: pending.player }).state;
    // The opponent answers in between, and always by keeping, so the seat under
    // test is the one whose mulligan count is being driven.
    const between = pendingDecision(current);
    if (between !== null && between.kind === 'mulligan' && between.player !== pending.player) {
      current = reduce(current, {
        type: 'keepHand',
        player: between.player,
        bottom: between.hand.slice(0, between.count),
      }).state;
    }
  }
  return current;
}

function decisionOn(state: GameState, kind: 'discard' | 'mulligan', cap = DEFAULT_ENUMERATION_CAP): Decision {
  const decision = pendingDecision(state, cap);
  if (decision === null || decision.kind !== kind) {
    throw new Error(`the position is asking ${String(decision?.kind)}, not ${kind}`);
  }
  return decision;
}

/** A selection as a set, so two spellings of one answer are one key. */
function key(oids: readonly ObjectId[]): string {
  return [...oids].sort().join('+');
}

/** C(n, k), so a fixture can say how wide its selection space is. */
function choose(n: number, k: number): number {
  let found = 1;
  for (let step = 0; step < k; step += 1) found = (found * (n - step)) / (step + 1);
  return found;
}

/** Every k-subset of `pool`, uncapped, straight from the definition. */
function subsetsOf(pool: readonly ObjectId[], k: number): readonly (readonly ObjectId[])[] {
  if (k === 0) return [[]];
  const found: (readonly ObjectId[])[] = [];
  for (let index = 0; index + k <= pool.length; index += 1) {
    const head = pool[index];
    if (head === undefined) continue;
    for (const tail of subsetsOf(pool.slice(index + 1), k - 1)) found.push([head, ...tail]);
  }
  return found;
}

/**
 * Every selection the kernel accepts, built without asking the kernel what it
 * offers.
 *
 * Brute force over `validateAction` is the independent oracle the walk is
 * compared against: it is the same authority `reduce` consults and it is reached
 * without touching `Decision.options`, so a truncated, duplicated or reordered
 * option list cannot make both sides wrong in the same direction.
 */
function acceptedSelections(
  state: GameState,
  hand: readonly ObjectId[],
  count: number,
  build: (oids: readonly ObjectId[]) => Action,
): ReadonlySet<string> {
  const found = new Set<string>();
  for (const subset of subsetsOf(hand, count)) {
    if (validateAction(state, build(subset)) === null) found.add(key(subset));
  }
  return found;
}

/**
 * Every finished selection reachable by answering with indices alone.
 *
 * `submit` and `choose` take an integer, so an option this walk never lands on
 * is an answer no surface can give. Nothing here constructs an action: each step
 * reduces against `decision.options[index]` and recurses on whatever the kernel
 * asks next, and a selection is recorded only when the kernel stops asking for
 * this one.
 */
function reachableSelections(
  start: GameState,
  kind: 'discard' | 'mulligan',
  selected: (option: Action) => readonly ObjectId[] | null,
): ReadonlySet<string> {
  const found = new Set<string>();
  const walk = (state: GameState, depth: number): void => {
    if (depth > 32) throw new Error(`${kind}: the sequence did not finish within 32 questions`);
    const decision = pendingDecision(state, DEFAULT_ENUMERATION_CAP);
    if (decision === null || decision.kind !== kind) return;
    for (let index = 0; index < decision.options.length; index += 1) {
      const option = decision.options[index];
      if (option === undefined) throw new Error('an index the decision listed addressed nothing');
      const oids = selected(option);
      if (oids === null) continue;
      const next = reduce(state, option).state;
      const after = pendingDecision(next, DEFAULT_ENUMERATION_CAP);
      if (after !== null && after.kind === kind && after.player === decision.player) {
        walk(next, depth + 1);
        continue;
      }
      found.add(key(oids));
    }
  };
  walk(start, 0);
  return found;
}

describe('a discard wider than the enumeration cap', () => {
  it('asks a complete question, and one card at a time when the subsets do not fit', () => {
    const state = discardState(12);
    const decision = decisionOn(state, 'discard');
    if (decision.kind !== 'discard') throw new Error('not a discard');

    // C(12,5) = 792 against a cap of 512. The property, not the constant: the
    // whole space does not fit, and the question is complete anyway.
    expect(decision.count).toBe(5);
    expect(subsetsOf(decision.hand, decision.count).length).toBeGreaterThan(DEFAULT_ENUMERATION_CAP);
    expect(decision.complete).toBe(true);
    expect(asksInSteps(decision)).toBe(true);
    // One option per card that can still start a legal selection, which is
    // linear in the hand rather than binomial in it.
    expect(decision.options.length).toBeLessThanOrEqual(decision.hand.length);
  });

  it('reaches every discard the kernel accepts, and no others, through indices alone', () => {
    const state = discardState(12);
    const decision = decisionOn(state, 'discard');
    if (decision.kind !== 'discard') throw new Error('not a discard');
    const player: PlayerId = decision.player;

    const accepted = acceptedSelections(state, decision.hand, decision.count, (oids) => ({
      type: 'discard',
      player,
      oids,
    }));
    const reached = reachableSelections(state, 'discard', (option) =>
      option.type === 'discard' ? option.oids : null,
    );

    expect(accepted.size).toBe(subsetsOf(decision.hand, decision.count).length);
    expect([...reached].sort()).toEqual([...accepted].sort());
  });

  it('lists the whole space index for index while it still fits', () => {
    const state = discardState(9);
    // C(9,2) = 36, and the question is asked at that width rather than at
    // `DEFAULT_ENUMERATION_CAP`: the claim here is about a space that fits, and
    // whether 36 fits under the shipped cap is a fact about the cap, not about
    // this board. The claim that 792 does not fit is the sibling above, and it
    // does name the constant.
    const space = choose(9, 2);
    expect(space).toBe(36);
    const decision = decisionOn(state, 'discard', space);
    if (decision.kind !== 'discard') throw new Error('not a discard');

    // Under the cap nothing about this site moved: every option is a whole
    // answer, in the order `combinations` has always produced.
    expect(asksInSteps(decision)).toBe(false);
    expect(decision.complete).toBe(true);
    expect(decision.options.length).toBe(subsetsOf(decision.hand, decision.count).length);
    for (const option of decision.options) {
      expect(option.type).toBe('discard');
      if (option.type === 'discard') expect(option.oids.length).toBe(decision.count);
    }
  });
});

describe('a whole selection at a question asked one card at a time', () => {
  /**
   * The shape every constructing caller sends. `@mtg/sim`'s two bots and
   * `@mtg/kernel`'s `simple-agent` build a discard out of `decision.hand` and
   * never read the enumeration, so a stepwise question that refused a whole
   * answer would stop the simulator dead at the first twelve-card hand.
   */
  it('finishes the discard in one reduction, from the first question', () => {
    const state = discardState(12);
    const decision = decisionOn(state, 'discard');
    if (decision.kind !== 'discard') throw new Error('not a discard');
    const whole = decision.hand.slice(0, decision.count);

    expect(asksInSteps(decision)).toBe(true);
    expect(validateAction(state, { type: 'discard', player: decision.player, oids: whole })).toBeNull();
    const after = reduce(state, { type: 'discard', player: decision.player, oids: whole }).state;
    expect(pendingDecision(after, DEFAULT_ENUMERATION_CAP)?.kind).not.toBe('discard');
    expect(after.pendingSelection).toBeUndefined();
  });

  it('finishes it from part-way through, and only over the cards already named', () => {
    const state = discardState(12);
    const opened = decisionOn(state, 'discard');
    if (opened.kind !== 'discard') throw new Error('not a discard');
    const step = opened.options[3];
    if (step === undefined || step.type !== 'discard') throw new Error('the step list is too short');
    const midway = reduce(state, step).state;
    const player = opened.player;

    // The named card is held rather than moved: a card in the graveyard a
    // question early would not be in the hand its own discard is chosen from.
    expect(midway.pendingSelection).toEqual(step.oids);
    expect(midway.players[player].hand).toEqual(opened.hand);

    const named = step.oids[0];
    if (named === undefined) throw new Error('a step named nothing');
    const rest = opened.hand.filter((oid) => oid !== named).slice(0, opened.count - 1);
    expect(validateAction(midway, { type: 'discard', player, oids: [named, ...rest] })).toBeNull();
    // A whole answer that drops a card already named is refused for the reason a
    // half-declared block cannot be taken back: it un-answers a question.
    expect(
      validateAction(midway, {
        type: 'discard',
        player,
        oids: opened.hand.filter((oid) => oid !== named).slice(0, opened.count),
      }),
    ).toContain('cannot be taken back');
  });

  it('leaves the fingerprint of every position that is not mid-selection alone', () => {
    const state = discardState(12);
    const decision = decisionOn(state, 'discard');
    if (decision.kind !== 'discard') throw new Error('not a discard');
    const step = decision.options[0];
    if (step === undefined) throw new Error('the discard offered nothing');

    // `stateFingerprint` drops undefined entries, so the field only shows up in
    // the hash at the positions the sequence actually stands in — which is what
    // keeps every fingerprint pinned elsewhere in the repository where it was.
    expect(state.pendingSelection).toBeUndefined();
    const midway = reduce(state, step).state;
    expect(stateFingerprint(midway)).not.toBe(stateFingerprint(state));
    const { pendingSelection: _named, ...dropped } = midway;
    expect(stateFingerprint(dropped)).toBe(stateFingerprint(state));
  });
});

describe('a mulligan wider than the enumeration cap', () => {
  /** Twelve cards bottoming six is C(12,6) = 924, the widest this seat reaches. */
  const OPENING = 12;
  const TAKEN = 6;

  it('asks a complete question, and one card at a time when the keeps do not fit', () => {
    const decision = decisionOn(mulliganState(OPENING, TAKEN), 'mulligan');
    if (decision.kind !== 'mulligan') throw new Error('not a mulligan');

    expect(decision.count).toBe(TAKEN);
    expect(subsetsOf(decision.hand, decision.count).length).toBeGreaterThan(DEFAULT_ENUMERATION_CAP);
    expect(decision.complete).toBe(true);
    expect(asksInSteps(decision)).toBe(true);
    // CR 103.4's other answer stays last, at every step, so the ordering claim
    // in `mulliganDecision`'s docblock holds at both widths.
    expect(decision.options[decision.options.length - 1]?.type).toBe('mulligan');
    expect(decision.options.filter((option) => option.type === 'mulligan').length).toBe(1);
  });

  it('reaches every keep the kernel accepts, and no others, through indices alone', () => {
    const state = mulliganState(OPENING, TAKEN);
    const decision = decisionOn(state, 'mulligan');
    if (decision.kind !== 'mulligan') throw new Error('not a mulligan');
    const player: PlayerId = decision.player;

    const accepted = acceptedSelections(state, decision.hand, decision.count, (oids) => ({
      type: 'keepHand',
      player,
      bottom: oids,
    }));
    const reached = reachableSelections(state, 'mulligan', (option) =>
      option.type === 'keepHand' ? option.bottom : null,
    );

    expect(accepted.size).toBe(subsetsOf(decision.hand, decision.count).length);
    expect([...reached].sort()).toEqual([...accepted].sort());
  });

  it('lists the whole space index for index while it still fits', () => {
    // C(7,3) = 35, which is every opening hand this game has ever asked about,
    // and the width the question is asked at for the same reason as the discard
    // above: a space that fits is a fact about the hand, not about the cap.
    const space = choose(7, 3);
    expect(space).toBe(35);
    const decision = decisionOn(mulliganState(7, 3), 'mulligan', space + 1);
    if (decision.kind !== 'mulligan') throw new Error('not a mulligan');

    // The keeps plus CR 103.4's mulligan, which is why the width asked for is
    // one past the binomial.
    expect(asksInSteps(decision)).toBe(false);
    expect(decision.complete).toBe(true);
    const keeps = decision.options.filter((option) => option.type === 'keepHand');
    expect(keeps.length).toBe(subsetsOf(decision.hand, decision.count).length);
    for (const keep of keeps) {
      if (keep.type === 'keepHand') expect(keep.bottom.length).toBe(decision.count);
    }
    expect(decision.options[decision.options.length - 1]?.type).toBe('mulligan');
  });
});
