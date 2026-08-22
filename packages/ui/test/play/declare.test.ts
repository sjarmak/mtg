// @vitest-environment jsdom
/**
 * Declaring a combat, when the declaration space is bigger than the column.
 *
 * `mtg-y1t`. The kernel enumerates an attack as the subsets of the eligible
 * attackers and a block as the cartesian product of each blocker's choices, so
 * both counts are exponential in the creatures on the board: a real game reached
 * a blocker decision with 256 legal declarations, three of which were fully on
 * screen. `src/routes/play/declare.ts` replaced the flat list with a roster and
 * a confirm at those two decisions and nowhere else.
 *
 * **The load-bearing test is the completeness walk.** Narrowing the rail is only
 * honest if nothing was narrowed *away*, so this file takes a board whose whole
 * declaration space is 27 blocks, drives the panel to every one of them, and
 * checks that each submits its own index into `decision.options`. That is the
 * property the flat list had for free and the property the contract in
 * `src/routes/play/rail.ts` now rests on; the button count is what it bought.
 *
 * The other half is the half-built state. A creature with menace may not be
 * blocked by one creature (CR 702.110b), so a player assembling a legal
 * two-creature block passes through an assignment the kernel enumerated no
 * option for. That is a position rather than an error: the confirm is absent,
 * the reason is on screen, and every creature is still pressable.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card, Keyword } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { Decision, GameSession, GameState } from '@mtg/kernel';
import {
  asksInSteps,
  choose,
  DEFAULT_ENUMERATION_CAP,
  driveDeclaration,
  humanSeat,
  pendingDecision,
  reduce,
  scenario,
} from '@mtg/kernel';
import { LEGAL_MOVES_LABEL, PlayView } from '../../src/routes/play/PlayView';
import {
  assignmentKey,
  declarationChoice,
  declarationPlan,
  declarationWords,
  rosterPress,
  withAssignment,
} from '../../src/routes/play/declare';
import { DECLARE_BACK_LABEL, DECLARE_CLEAR_LABEL } from '../../src/routes/play/declare-panel';
import type { Assignment } from '../../src/routes/play/declare';
import { rosterName } from '../../src/routes/play/naming';
import type { SeatNames } from '../../src/routes/play/position';
import { buildPrompt } from '../../src/routes/play/prompt';

afterEach(cleanup);

const SEATS: SeatNames = ['You', 'Bot'];

let minted = 0;

/** A creature invented for this file, so no set's own card name is borrowed. */
function creature(name: string, keywords: readonly Keyword[] = []): Card {
  minted += 1;
  return parseCard({
    kind: 'creature',
    id: `slc-declare-${String(minted)}`,
    name,
    rarity: 'common',
    set: { code: 'SLC', collectorNumber: (minted % 900) + 1 },
    manaCost: { generic: 2 },
    colors: [],
    power: 2,
    toughness: 3,
    ...(keywords.length === 0 ? {} : { keywords }),
  });
}

/** A zero-ability walker is enough to exercise combat-defender identity. */
function planeswalker(name: string): Card {
  minted += 1;
  return parseCard({
    kind: 'planeswalker',
    id: `slc-declare-${String(minted)}`,
    name,
    rarity: 'rare',
    set: { code: 'SLC', collectorNumber: (minted % 900) + 1 },
    manaCost: { generic: 3 },
    colors: [],
    supertypes: ['legendary'],
    subtypes: ['Wayfinder'],
    startingLoyalty: 3,
  });
}

/**
 * A board with `attackers` creatures attacking and `blockers` untapped to answer
 * them, parked on the blocker declaration.
 *
 * Walked to the attack through the kernel's own turn machinery and then reduced
 * with the enumeration's own "attack with everything" option, so the position is
 * one the game could have reached rather than one fabricated beside it.
 */
function blockingState(attackers: readonly Card[], blockers: readonly Card[]): GameState {
  const built = scenario({
    seed: 'test/play/declare',
    battlefield: [
      ...attackers.map((card) => ({ card, controller: 0 as const, summoningSick: false })),
      ...blockers.map((card) => ({ card, controller: 1 as const, summoningSick: false })),
    ],
    active: 0,
    turn: 6,
    step: 'declareAttackers',
  });
  const decision = pendingDecision(built.state);
  if (decision === null || decision.kind !== 'declareAttackers') {
    throw new Error('the board never reached an attack declaration');
  }
  // Both players hold priority in the declare-attackers step before blockers are
  // declared (CR 508.2), so the position is walked forward by passing rather
  // than assumed to be one reduction away. Driving the attack declaration
  // itself is its own loop past the enumeration cap (`mtg-y16d`).
  let current = driveDeclaration(built.state, 'declareAttackers');
  for (let guard = 0; guard < 20; guard += 1) {
    const pending = pendingDecision(current);
    if (pending === null) throw new Error('the game ended before blockers were declared');
    if (pending.kind === 'declareBlockers') return current;
    if (pending.kind !== 'priority') throw new Error(`unexpected decision ${pending.kind}`);
    current = reduce(current, { type: 'passPriority', player: pending.player }).state;
  }
  throw new Error('the board never reached a blocker declaration');
}

function sessionOn(state: GameState, cap = DEFAULT_ENUMERATION_CAP): GameSession {
  const pending = pendingDecision(state, cap);
  if (pending === null) throw new Error('the board left nobody to ask');
  return {
    seats: [humanSeat(SEATS[0]), humanSeat(SEATS[1])],
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

function decisionOn(state: GameState, cap = DEFAULT_ENUMERATION_CAP): Decision {
  const decision = pendingDecision(state, cap);
  if (decision === null) throw new Error('the board left nobody to ask');
  return decision;
}

/**
 * Every legal block over this many attackers and blockers.
 *
 * CR 509.1a lets each blocker sit out or answer any one attacker, independently
 * of the others, so the space is `(attackers + 1) ** blockers`. The counts below
 * are asked for at this width rather than read off `DEFAULT_ENUMERATION_CAP`,
 * because the cap is one global constant over every enumeration in the kernel:
 * a test that pins the number the shipped cap happens to produce pins the
 * constant as well, and 256 is a fact about eight creatures, not about 512.
 */
function blockSpace(attackers: number, blockers: number): number {
  return (attackers + 1) ** blockers;
}

function rail(): ReturnType<typeof screen.getByRole> {
  return screen.getByRole('group', { name: LEGAL_MOVES_LABEL });
}

function roster(kind: 'declareAttackers' | 'declareBlockers'): ReturnType<typeof screen.getByRole> {
  return screen.getByRole('group', { name: declarationWords(kind).roster });
}

function attr(node: unknown, name: string): string | null {
  return (node as { getAttribute(name: string): string | null }).getAttribute(name);
}

function accessibleName(node: unknown): string {
  return attr(node, 'aria-label') ?? (node as { textContent?: string | null }).textContent ?? '';
}

/** Every row in the roster, keyed by the creature it is about. */
function rowsByName(kind: 'declareAttackers' | 'declareBlockers'): ReadonlyMap<string, unknown> {
  const rows = new Map<string, unknown>();
  for (const row of within(roster(kind)).getAllByRole('button')) {
    rows.set(accessibleName(row).split(',')[0] ?? '', row);
  }
  return rows;
}

const ONE = creature('Hollow Sentinel');
const TWO = creature('Ridgeline Courier');
const MENACING = creature('Bramble Stalker', ['menace']);

describe('the declaration model', () => {
  it('offers one row per eligible creature rather than one button per declaration', () => {
    // Eight untapped creatures against one attacker is the board `mtg-y1t` was
    // filed off: 2^8 legal blocks, every one of them distinct.
    const state = blockingState(
      [creature('Wandering Herald')],
      [...Array.from({ length: 8 }, (_unused, at) => creature(`Guard ${String(at + 1)}`))],
    );
    const space = blockSpace(1, 8);
    const decision = decisionOn(state, space);
    expect(decision.kind).toBe('declareBlockers');
    expect(decision.options.length).toBe(space);

    const plan = declarationPlan(state, SEATS, decision);
    if (plan === null) throw new Error('the blocker decision produced no plan');
    expect(plan.subjects).toHaveLength(8);
    // One candidate each, because there is one attacker: pressing a row is the
    // whole decision for that creature.
    for (const subject of plan.subjects) expect(subject.candidates).toHaveLength(1);

    render(h(PlayView, { session: sessionOn(state, space), viewer: 1, names: SEATS, onChoose: vi.fn() }));
    // The confirm and the eight rows. Linear in the board where the flat list
    // was exponential in it, which is the whole of the bead.
    expect(within(rail()).getAllByRole('button')).toHaveLength(9);
  });

  it('leaves every other decision listing one button per option', () => {
    // The narrowing is scoped to the two exponential decisions and nothing else,
    // which is what keeps `rail-contract.test.ts`'s count assertions about a
    // priority true.
    const state = blockingState([ONE], [TWO]);
    const priority = scenario({ seed: 'test/play/declare/priority', active: 0, turn: 3 }).state;
    const decision = pendingDecision(priority);
    if (decision === null) throw new Error('the priority board left nobody to ask');
    expect(declarationPlan(priority, SEATS, decision)).toBeNull();
    // And the blocker board does produce one, so the negative above is a
    // statement about the decision kind rather than about the fixture.
    expect(declarationPlan(state, SEATS, decisionOn(state))).not.toBeNull();
  });

  it('spells one assignment one way however it was pressed', () => {
    // Two orders of the same two answers are one declaration, so the key that
    // finds its index cannot depend on which creature was pressed first.
    const forwards: Assignment = new Map([
      ['o1', 'o9'],
      ['o2', 'o8'],
    ]);
    const backwards: Assignment = new Map([
      ['o2', 'o8'],
      ['o1', 'o9'],
    ]);
    expect(assignmentKey(forwards)).toBe(assignmentKey(backwards));
    expect(assignmentKey(new Map())).toBe('');
  });
});

/**
 * Presses the roster until `assignment` is what the panel holds.
 *
 * Every press is a real click on a rendered button found by its accessible name,
 * so what this walks is the surface rather than the model under it.
 */
function drive(assignment: Assignment, names: ReadonlyMap<string, string>): void {
  for (const [oid, attacker] of assignment) {
    const creatureName = names.get(oid);
    const attackerName = names.get(attacker);
    if (creatureName === undefined || attackerName === undefined) {
      throw new Error('the assignment named an object the board does not hold');
    }
    const row = rowsByName('declareBlockers').get(creatureName);
    if (row === undefined) throw new Error(`no roster row for ${creatureName}`);
    fireEvent.click(row as Parameters<typeof fireEvent.click>[0]);
    // Two attackers, so every creature is asked which one it blocks.
    const answers = screen.getByRole('group', {
      name: declarationWords('declareBlockers').ask(creatureName),
    });
    const answer = within(answers)
      .getAllByRole('button')
      .find((button) => accessibleName(button).includes(attackerName));
    if (answer === undefined) throw new Error(`no answer naming ${attackerName}`);
    fireEvent.click(answer);
  }
}

/**
 * `mtg-rf12`. Measured in a real game with two copies of one creature token,
 * both 2/2, both untapped, no damage on either: the roster drew two rows
 * reading exactly the same sentence, naming the token and the attacker it
 * blocks, and before either was assigned, two more reading the token's name
 * and `not blocking`. Two identical buttons and no way for a keyboard player
 * to know which creature each held.
 *
 * `move-names.test.ts`'s `twins([0, 0])` proves the opposite case still
 * holds: two indistinguishable permanents offered as a *target* keep reading
 * alike, because the choice between them is genuinely free. A roster row is
 * not that choice — each row is a button over one specific creature — so the
 * two rules have to disagree here on purpose.
 */
describe('two indistinguishable creatures on the roster', () => {
  it('gives two roster subjects their own name so pressing one is not pressing the other', () => {
    const attacker = creature('Lone Raider');
    const twin = creature('Twin Sentinel');
    const state = blockingState([attacker], [twin, twin]);
    const decision = decisionOn(state);
    if (decision.kind !== 'declareBlockers') throw new Error('the board is not declaring blockers');
    const plan = declarationPlan(state, SEATS, decision);
    if (plan === null) throw new Error('the blocker decision produced no plan');
    expect(plan.subjects).toHaveLength(2);
    const names = plan.subjects.map((subject) => subject.name);
    expect(new Set(names).size).toBe(2);
    for (const name of names) expect(name).toContain('Twin Sentinel');
  });

  it('carries the distinction onto the rendered roster before either is assigned', () => {
    const attacker = creature('Lone Raider');
    const twin = creature('Twin Sentinel');
    const state = blockingState([attacker], [twin, twin]);
    render(h(PlayView, { session: sessionOn(state), viewer: 1, names: SEATS, onChoose: vi.fn() }));
    const rows = within(roster('declareBlockers')).getAllByRole('button');
    const twinRows = rows.filter((row) => accessibleName(row).startsWith('Twin Sentinel'));
    expect(twinRows).toHaveLength(2);
    const labels = twinRows.map(accessibleName);
    // Both said "not blocking" in the bug this is filed off, and only the
    // subject half of the sentence had anything to disambiguate with.
    for (const label of labels) expect(label.endsWith(', not blocking')).toBe(true);
    expect(new Set(labels).size).toBe(2);
  });

  it('stays distinct once both are assigned to the one attacker', () => {
    const attacker = creature('Lone Raider');
    const twin = creature('Twin Sentinel');
    const state = blockingState([attacker], [twin, twin]);
    render(h(PlayView, { session: sessionOn(state), viewer: 1, names: SEATS, onChoose: vi.fn() }));
    for (const row of within(roster('declareBlockers')).getAllByRole('button')) {
      if (accessibleName(row).startsWith('Twin Sentinel')) fireEvent.click(row);
    }
    const labels = within(roster('declareBlockers'))
      .getAllByRole('button')
      .map(accessibleName)
      .filter((label) => label.startsWith('Twin Sentinel'));
    expect(labels).toHaveLength(2);
    for (const label of labels) expect(label).toContain('Lone Raider');
    expect(new Set(labels).size).toBe(2);
  });

  /**
   * The separator has to be a fact about the object, not about where it sits
   * in the list the roster happens to be handed this render. A qualifier
   * built from a render-order index reads right until the roster reorders —
   * a creature leaving the board, or the decision re-enumerating the
   * eligible list in a different order — and then two rows silently swap
   * which creature they name. Creation order (`art-copies.ts`'s
   * `artCopies`) is fixed the moment the object comes into existence and
   * cannot drift with the list around it.
   */
  it('names a subject the same way whatever order the roster lists the siblings in', () => {
    const attacker = creature('Lone Raider');
    const twin = creature('Twin Sentinel');
    const state = blockingState([attacker], [twin, twin]);
    const decision = decisionOn(state);
    if (decision.kind !== 'declareBlockers') throw new Error('the board is not declaring blockers');
    const [first] = decision.eligible;
    if (first === undefined) throw new Error('the board has no eligible blocker');
    const forward = rosterName(state, first, decision.eligible);
    const reversed = rosterName(state, first, [...decision.eligible].reverse());
    expect(forward).toBe(reversed);
  });
});

describe('the completeness walk', () => {
  it('reaches every enumerated declaration through the panel, each submitting its own index', () => {
    const attackers = [creature('Ember Courser'), creature('Salt Marsh Drover')];
    const blockers = [creature('Quarry Hound'), creature('Tin Lantern')];
    const state = blockingState(attackers, blockers);
    // Two blockers, three choices each (neither attacker, or one of two). Small
    // on purpose: every iteration is a real click into a rendered React tree,
    // and a 27-way version of this spent 81% of its budget on a loaded box,
    // which `packages/slice/tools/test-load/` names as the population that times
    // out next. The bigger boards are walked in the test below, where nothing is
    // rendered and the cost is arithmetic.
    const space = blockSpace(attackers.length, blockers.length);
    expect(space).toBe(9);
    const decision = decisionOn(state, space);
    if (decision.kind !== 'declareBlockers') throw new Error('the board is not declaring blockers');
    expect(decision.options).toHaveLength(space);

    const names = new Map<string, string>();
    for (const oid of state.battlefield) {
      const object = state.objects[oid];
      if (object !== undefined) names.set(oid, object.card.name);
    }

    // One render for all nine, because a render of this surface is the expensive
    // part. Clear is what makes the loop safe: it is the panel's own control, it
    // drops every assignment, and nothing here has reached the kernel, so the
    // position between iterations is the one the panel opened on.
    const onChoose = vi.fn();
    render(h(PlayView, { session: sessionOn(state, space), viewer: 1, names: SEATS, onChoose }));

    const submitted = new Map<string, number>();
    for (const [index, option] of decision.options.entries()) {
      if (option.type !== 'declareBlockers') throw new Error('a non-declaration was enumerated');
      const assignment: Assignment = new Map(option.blocks.map((block) => [block.blocker, block.attacker]));
      const clear = screen.queryByRole('button', { name: DECLARE_CLEAR_LABEL });
      if (clear !== null) fireEvent.click(clear);
      onChoose.mockClear();
      drive(assignment, names);
      const confirm = within(rail()).getAllByRole('button')[0];
      if (confirm === undefined) throw new Error('the panel offered nothing to confirm');
      fireEvent.click(confirm);
      expect(onChoose, `assignment ${assignmentKey(assignment)} submitted nothing`).toHaveBeenCalledTimes(1);
      submitted.set(assignmentKey(assignment), onChoose.mock.calls[0]?.[0] as number);
      expect(submitted.get(assignmentKey(assignment))).toBe(index);
    }

    // Every one of the nine, and no index twice: the narrowing removed no
    // declaration and invented none.
    expect(submitted.size).toBe(space);
    expect(new Set(submitted.values()).size).toBe(space);
  });

  it('reaches every enumerated block on the board the bead was filed off, through the model', () => {
    // The same property on the board that produced the bug, walked over the
    // model rather than the DOM. What the panel adds over this is the pressing,
    // and that is what the nine-way walk above covers; what this adds is the
    // scale nothing rendered could reach inside a test budget.
    const state = blockingState(
      [creature('Verge Harrier')],
      Array.from({ length: 8 }, (_unused, at) => creature(`Sentry ${String(at + 1)}`)),
    );
    const space = blockSpace(1, 8);
    const decision = decisionOn(state, space);
    if (decision.kind !== 'declareBlockers') throw new Error('the board is not declaring blockers');
    expect(decision.options).toHaveLength(space);

    const plan = declarationPlan(state, SEATS, decision);
    if (plan === null) throw new Error('the blocker decision produced no plan');

    const reached = new Set<number>();
    for (const [index, option] of decision.options.entries()) {
      if (option.type !== 'declareBlockers') throw new Error('a non-declaration was enumerated');
      // Assembled the way the panel assembles it: every creature starts idle and
      // is pressed once if the declaration wants it, through the one function
      // that decides what a press means.
      let assignment: Assignment = new Map();
      const wanted = new Set(option.blocks.map((block) => block.blocker));
      for (const subject of plan.subjects) {
        if (!wanted.has(subject.oid)) continue;
        const press = rosterPress(subject, assignment);
        if (press.kind !== 'assign') throw new Error('a lone attacker should never open a question');
        assignment = withAssignment(assignment, press.oid, press.to);
      }
      const found = declarationChoice(state, plan, assignment);
      // The index rather than the declaration: this board's whole space is
      // enumerated, so every assignment on it names an option and records the
      // integer it always did.
      expect(found, `assignment ${assignmentKey(assignment)} names no option`).toBe(index);
      if (typeof found === 'number') reached.add(found);
    }
    expect(reached.size).toBe(space);
  });
});

describe('a question that is opened and left', () => {
  it('takes nothing back and nothing forward, because nothing reached the kernel', () => {
    // Two attackers, so a creature is asked which one it blocks rather than
    // toggled. Back is `cast-panel.ts`'s Back one route over and means the same
    // thing: the question is closed and the assignment is exactly what it was.
    const state = blockingState(
      [creature('Fen Outrider'), creature('Gale Skirmisher')],
      [creature('Warren Picket')],
    );
    const onChoose = vi.fn();
    render(h(PlayView, { session: sessionOn(state), viewer: 1, names: SEATS, onChoose }));

    const row = rowsByName('declareBlockers').get('Warren Picket');
    if (row === undefined) throw new Error('the roster is missing the creature');
    fireEvent.click(row as Parameters<typeof fireEvent.click>[0]);
    // Two attackers and declining, so three answers rather than a toggle.
    const answers = screen.getByRole('group', {
      name: declarationWords('declareBlockers').ask('Warren Picket'),
    });
    expect(within(answers).getAllByRole('button')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: DECLARE_BACK_LABEL }));
    expect(accessibleName(rowsByName('declareBlockers').get('Warren Picket'))).toBe(
      `Warren Picket, ${declarationWords('declareBlockers').idle}`,
    );
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe('an assignment the rules do not allow yet', () => {
  it('offers no confirm, says why, and leaves every creature pressable', () => {
    // Menace: the lone blocker is illegal and the pair is legal, so a player
    // building the pair stands on an unenumerated assignment on the way there.
    const state = blockingState([MENACING], [creature('Coil Sentry'), creature('Pier Watchman')]);
    const decision = decisionOn(state);
    // No blocks, or both of them. One blocker alone is not on the list.
    expect(decision.options).toHaveLength(2);

    const onChoose = vi.fn();
    render(h(PlayView, { session: sessionOn(state), viewer: 1, names: SEATS, onChoose }));
    const rows = rowsByName('declareBlockers');
    const first = rows.get('Coil Sentry');
    const second = rows.get('Pier Watchman');
    if (first === undefined || second === undefined) throw new Error('the roster is missing a creature');

    fireEvent.click(first as Parameters<typeof fireEvent.click>[0]);
    expect(screen.queryByRole('note')).not.toBeNull();
    // The rows are still there and still pressable, which is what makes the
    // illegal state escapable rather than a dead end.
    expect(within(roster('declareBlockers')).getAllByRole('button')).toHaveLength(2);
    expect(onChoose).not.toHaveBeenCalled();

    fireEvent.click(
      rowsByName('declareBlockers').get('Pier Watchman') as Parameters<typeof fireEvent.click>[0],
    );
    expect(screen.queryByRole('note')).toBeNull();
    const confirm = within(rail()).getAllByRole('button')[0];
    if (confirm === undefined) throw new Error('the legal pair offered nothing to confirm');
    fireEvent.click(confirm);
    expect(onChoose).toHaveBeenCalledTimes(1);
  });
});

describe('the attack declaration', () => {
  it('is the same roster, with the defending player as the one candidate', () => {
    const state = scenario({
      seed: 'test/play/declare/attack',
      battlefield: [
        { card: creature('Dune Runner'), controller: 0, summoningSick: false },
        { card: creature('Stone Piper'), controller: 0, summoningSick: false },
      ],
      active: 0,
      turn: 6,
      step: 'declareAttackers',
    }).state;
    const decision = decisionOn(state);
    expect(decision.kind).toBe('declareAttackers');
    expect(decision.options).toHaveLength(4);

    const onChoose = vi.fn();
    render(h(PlayView, { session: sessionOn(state), viewer: 0, names: SEATS, onChoose }));
    // The confirm, and one row per creature.
    expect(within(rail()).getAllByRole('button')).toHaveLength(3);
    // The empty declaration is what the confirm submits before anything is
    // pressed, and it is first: `declare-panel.ts` argues that order, and
    // `play.test.ts` drives a whole game by pressing the first button.
    expect(accessibleName(within(rail()).getAllByRole('button')[0])).toBe('Attack with nothing');

    const row = rowsByName('declareAttackers').get('Dune Runner');
    if (row === undefined) throw new Error('the roster is missing a creature');
    fireEvent.click(row as Parameters<typeof fireEvent.click>[0]);
    // One candidate, so the press declared it outright rather than asking.
    expect(accessibleName(rowsByName('declareAttackers').get('Dune Runner'))).toBe(
      `Dune Runner, ${declarationWords('declareAttackers').busy('Bot')}`,
    );
    // Pressing it again takes it back, which is the whole of the cancel path for
    // a creature with one candidate.
    fireEvent.click(
      rowsByName('declareAttackers').get('Dune Runner') as Parameters<typeof fireEvent.click>[0],
    );
    expect(accessibleName(rowsByName('declareAttackers').get('Dune Runner'))).toBe(
      `Dune Runner, ${declarationWords('declareAttackers').idle}`,
    );
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('names, stages, and submits an attack at an opposing planeswalker', () => {
    const walker = planeswalker('Boundary Seer');
    const state = scenario({
      seed: 'test/play/declare/planeswalker',
      battlefield: [
        { card: creature('Cloud Runner'), controller: 0, summoningSick: false },
        { card: walker, controller: 1 },
      ],
      active: 0,
      turn: 6,
      step: 'declareAttackers',
    }).state;
    const decision = decisionOn(state);
    if (decision.kind !== 'declareAttackers') throw new Error('the board is not declaring attackers');
    const walkerOid = state.battlefield.find((oid) => state.objects[oid]?.card.name === walker.name);
    if (walkerOid === undefined) throw new Error('the walker did not enter');

    const plan = declarationPlan(state, SEATS, decision);
    if (plan === null) throw new Error('the attacker decision produced no plan');
    expect(plan.subjects[0]?.candidates).toEqual([
      { key: 'player:1', label: 'Bot' },
      { key: `planeswalker:${walkerOid}`, label: "Bot's Boundary Seer" },
    ]);
    const attackerOid = plan.subjects[0]?.oid;
    if (attackerOid === undefined) throw new Error('the attacker did not enter');
    const choice = declarationChoice(state, plan, new Map([[attackerOid, `planeswalker:${walkerOid}`]]));
    expect(choice).not.toBeNull();
    const action = typeof choice === 'number' ? decision.options[choice] : choice;
    expect(action).toEqual({
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: attackerOid, defender: { kind: 'planeswalker', oid: walkerOid } }],
    });
    expect(buildPrompt(state, decision, SEATS).explain).toContain("Bot's Boundary Seer");

    const onChoose = vi.fn();
    render(h(PlayView, { session: sessionOn(state), viewer: 0, names: SEATS, onChoose }));
    const row = rowsByName('declareAttackers').get('Cloud Runner');
    if (row === undefined) throw new Error('the roster is missing the attacker');
    fireEvent.click(row as Parameters<typeof fireEvent.click>[0]);
    const targets = screen.getByRole('group', {
      name: declarationWords('declareAttackers').ask('Cloud Runner'),
    });
    fireEvent.click(within(targets).getByRole('button', { name: "Bot's Boundary Seer" }));
    fireEvent.click(
      within(rail()).getByRole('button', {
        name: "Attack with Cloud Runner — Cloud Runner attacks Bot's Boundary Seer. 1 attacking",
      }),
    );
    expect(onChoose).toHaveBeenCalledWith(expect.any(Number));
    const submitted = decision.options[onChoose.mock.calls[0]?.[0] as number];
    expect(submitted).toEqual(action);
  });
});

/**
 * `mtg-y1t.2`. The roster used to read its candidates off `decision.options`
 * and submit an index into it, so a truncated enumeration was a truncated
 * roster: measured on this checkout, a three-attacker eight-blocker board lists
 * 512 of 65,536 declarations, and those 512 mention three of the eight blockers
 * in no option at all. Both halves are asserted, because either one alone leaves
 * a legal block unreachable.
 */
describe('a board bigger than the enumeration cap', () => {
  function crowdedBoard(attackers: number, blockers: number): GameState {
    return blockingState(
      Array.from({ length: attackers }, (_unused, at) => creature(`Raider ${String(at + 1)}`)),
      Array.from({ length: blockers }, (_unused, at) => creature(`Picket ${String(at + 1)}`)),
    );
  }

  it('puts every creature on the roster, however far the option list fell short', () => {
    const state = crowdedBoard(3, 8);
    const decision = decisionOn(state);
    if (decision.kind !== 'declareBlockers') throw new Error('the board is not declaring blockers');
    // `mtg-tb7v` stage 2: the board is past the cap, so the kernel asks one
    // blocker at a time rather than truncating. The option list is now that one
    // creature's answers (decline plus the three attackers) and still mentions
    // nothing about the other seven, which is what the roster has to survive.
    expect(asksInSteps(decision)).toBe(true);
    expect(decision.options).toHaveLength(4);

    const mentioned = new Set<string>();
    for (const option of decision.options) {
      if (option.type !== 'declareBlockers') continue;
      for (const block of option.blocks) mentioned.add(block.blocker);
    }
    // The defect: the list the roster used to be built from is missing whole
    // creatures.
    expect(mentioned.size).toBeLessThan(8);

    const plan = declarationPlan(state, SEATS, decision);
    if (plan === null) throw new Error('the blocker decision produced no plan');
    expect(plan.subjects).toHaveLength(8);
    for (const subject of plan.subjects) expect(subject.candidates).toHaveLength(3);

    render(h(PlayView, { session: sessionOn(state), viewer: 1, names: SEATS, onChoose: vi.fn() }));
    // The confirm and eight rows, on a board whose flat list was 512 buttons
    // and whose whole space is 65,536.
    expect(within(rail()).getAllByRole('button')).toHaveLength(9);
  });

  it('submits a block the enumeration never listed, as the declaration itself', () => {
    const state = crowdedBoard(3, 8);
    const decision = decisionOn(state);
    if (decision.kind !== 'declareBlockers') throw new Error('the board is not declaring blockers');
    const plan = declarationPlan(state, SEATS, decision);
    if (plan === null) throw new Error('the blocker decision produced no plan');

    // Every creature onto the last attacker, which is always past the point the
    // lexicographic truncation reached.
    const last = decision.attackers[decision.attackers.length - 1];
    if (last === undefined) throw new Error('nothing is attacking');
    let assignment: Assignment = new Map();
    for (const subject of plan.subjects) assignment = withAssignment(assignment, subject.oid, last);

    expect(plan.byAssignment.get(assignmentKey(assignment))).toBeUndefined();
    const submitted = declarationChoice(state, plan, assignment);
    expect(typeof submitted).not.toBe('number');
    expect(submitted).toEqual({
      type: 'declareBlockers',
      player: 1,
      blocks: plan.subjects.map((subject) => ({ blocker: subject.oid, attacker: last })),
    });

    // And the same declaration through the surface: eight rows pressed, each
    // answered with the third attacker, then the confirm.
    const onChoose = vi.fn();
    render(h(PlayView, { session: sessionOn(state), viewer: 1, names: SEATS, onChoose }));
    const lastName = state.objects[last]?.card.name ?? '';
    for (const subject of plan.subjects) {
      const name = state.objects[subject.oid]?.card.name ?? '';
      const row = rowsByName('declareBlockers').get(name);
      if (row === undefined) throw new Error(`no roster row for ${name}`);
      fireEvent.click(row as Parameters<typeof fireEvent.click>[0]);
      const answers = screen.getByRole('group', {
        name: declarationWords('declareBlockers').ask(name),
      });
      const answer = within(answers)
        .getAllByRole('button')
        .find((button) => accessibleName(button).includes(lastName));
      if (answer === undefined) throw new Error(`no answer naming ${lastName}`);
      fireEvent.click(answer);
    }
    const confirm = within(rail()).getAllByRole('button')[0];
    if (confirm === undefined) throw new Error('the panel offered nothing to confirm');
    fireEvent.click(confirm);

    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0]?.[0]).toEqual(submitted);
  });

  it('is applied by the kernel, so the block reaches the board', () => {
    const state = crowdedBoard(3, 8);
    const decision = decisionOn(state);
    if (decision.kind !== 'declareBlockers') throw new Error('the board is not declaring blockers');
    const plan = declarationPlan(state, SEATS, decision);
    if (plan === null) throw new Error('the blocker decision produced no plan');
    const last = decision.attackers[decision.attackers.length - 1];
    if (last === undefined) throw new Error('nothing is attacking');
    let assignment: Assignment = new Map();
    for (const subject of plan.subjects) assignment = withAssignment(assignment, subject.oid, last);
    const submitted = declarationChoice(state, plan, assignment);
    if (submitted === null) throw new Error('the assignment named nothing to submit');

    const applied = choose(sessionOn(state), submitted);

    expect(applied.state.combat.blocks).toHaveLength(1);
    expect(applied.state.combat.blocks[0]?.blockers).toHaveLength(8);
    expect(applied.choices).toEqual([submitted]);
  });
});
