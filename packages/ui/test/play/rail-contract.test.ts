// @vitest-environment jsdom
/**
 * The legal-move rail is a contract, and this is the contract.
 *
 * `mtg-bz2` rebuilds the play surface around direct manipulation, and any of its
 * fourteen lanes could plausibly delete the flat move list on the way — several
 * of them describe clicking objects as the replacement for it. The rail survives
 * the rebuild, demoted from the only path to the accessible one, and this file
 * is what makes that statement testable instead of a paragraph nobody runs.
 *
 * It is deliberately separate from `play.test.ts`, which drives a whole game
 * through the same group and would also go red. That test failing says "the
 * click-through broke"; this one says which rule was broken and why it exists.
 * Every lane runs in a worktree of its own, so a rule that is only implied by a
 * 698-line click-through is a rule that gets discovered at merge.
 *
 * What is asserted is the accessible handle and the keyboard path, not the
 * layout. Narrowing the rail, reordering it, restyling it or moving it are all
 * in scope for those lanes. Removing the labeled group, renaming it, or turning
 * its entries into something that is not a focusable button is not.
 * `src/routes/play/rail.ts` carries the same contract in prose, at the file a
 * lane would open to do any of it.
 *
 * # The mirror game cannot fold, so it cannot check the fold (`mtg-ebb`)
 *
 * `mtg-46g` gave the rail a fold: a run of neighboring moves sharing an act
 * prints the act once and gives each button the tail. The invariant that fold
 * could break is the one asserted here — one button per option, each carrying
 * its own index — and until now it was asserted only against a rail that never
 * folds. Driving the `EXAMPLE_CARDS` mirror game through `buildPrompt` at every
 * decision produces **zero** labels containing `TARGET_ARROW`: the opening
 * priority offers seven choices with no arrow among them, and the longest
 * foldable run over the whole game is zero. Every count and index invariant in
 * this file was therefore true of the unfolded rail and unmeasured on the folded
 * one.
 *
 * So the second half of this file parks a board that does fold, and checks the
 * same three things there. It also catches one latent defect nothing else does:
 * `rail.ts` places by kind and marks placed on `choice.index`, so a kind listed
 * in two `GROUP_ORDER` entries would render its options twice — two controls
 * carrying one index. Pressing every button and reading back the multiset of
 * indices fails on that whatever caused it.
 *
 * # One button per option, except at a combat declaration (`mtg-y1t`)
 *
 * # The one move that is not in the list (`mtg-li0o`)
 *
 * `passPriority` left the enumeration on 2026-08-20 for a fixed home in the
 * priority foot, on the playtester's ruling: "get rid of the list entry". The
 * contract this file asserts is unchanged in the property it is about — every
 * enumerated move is reachable, and each control submits its own index — and
 * changed in what it counts against. `listed` below is the filter, applied to
 * the expectation rather than to the render, so a *second* kind quietly leaving
 * the list still fails every count in here. `pass.test.ts` is where the
 * exception itself is pinned, in both directions.
 *
 * The third block is the one narrowing of that rule, asserted rather than
 * assumed. `declareAttackers` and `declareBlockers` are the two decisions whose
 * option count is exponential in the creatures on the board — eight untapped
 * creatures are 256 legal blocks, and a real game put three of them on screen —
 * so at those two the rail draws a roster and a confirm instead of a button per
 * declaration. What is checked here is that the narrowing is scoped to them and
 * that everything the contract above is actually about survives it: the labeled
 * group, its name, real focusable buttons, and an index out of the pending
 * enumeration when one is pressed. That every declaration is still *reachable*
 * is the harder claim and is walked exhaustively in `declare.test.ts`.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AbilityInput, Card } from '@mtg/dsl';
import { EXAMPLE_CARDS, exampleCard, parseCard } from '@mtg/dsl';
import type { GameSession, GameState } from '@mtg/kernel';
import {
  choose,
  createSession,
  DEFAULT_AUTO_PASS,
  DEFAULT_ENUMERATION_CAP,
  driveDeclaration,
  humanSeat,
  pendingDecision,
  reduce,
  scenario,
} from '@mtg/kernel';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { LEGAL_MOVES_LABEL, PlayView } from '../../src/routes/play/PlayView';
import { buildPrompt, TARGET_ARROW } from '../../src/routes/play/prompt';
import { unfoldedName } from '../../src/routes/play/choice-button';
import type { PlayChoice } from '../../src/routes/play/prompt';
import type { SeatNames } from '../../src/routes/play/position';

afterEach(cleanup);

const NAMES = ['You', 'Bot'] as const;

function openingSession(): GameSession {
  const game = dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
  return createSession(game.config.setup, game.config.seats, { autoPass: DEFAULT_AUTO_PASS });
}

/** The opening position with the hand kept, which is an ordinary priority. */
function prioritySession(): GameSession {
  const opened = openingSession();
  return opened.pending?.kind === 'mulligan' ? choose(opened, 0, { autoPass: DEFAULT_AUTO_PASS }) : opened;
}

/** The group, found the way a screen reader finds it and the way every test does. */
function rail(): ReturnType<typeof screen.getByRole> {
  return screen.getByRole('group', { name: LEGAL_MOVES_LABEL });
}

function tag(node: unknown): string {
  return (node as { tagName: string }).tagName;
}

function attr(node: unknown, name: string): string | null {
  return (node as { getAttribute(name: string): string | null }).getAttribute(name);
}

function text(node: unknown): string {
  return (node as { readonly textContent?: string | null }).textContent ?? '';
}

/**
 * The enumeration less the one move with a home of its own.
 *
 * Named for `src/routes/play/rail.ts`'s `UNLISTED`, and deliberately not
 * importing it: what this file checks is that the list matches the enumeration,
 * and reading the exception off the module under test would make the count agree
 * with itself whatever the module did.
 */
function listed(choices: readonly PlayChoice[]): readonly PlayChoice[] {
  return choices.filter((choice) => choice.kind !== 'passPriority');
}

describe('the legal-move rail survives the rebuild', () => {
  it('keeps the accessible name every caller finds it by', () => {
    // Pinned rather than compared to itself. The constant is what the tests
    // import, so a change to its value would slip past them; the string is what
    // a person using a screen reader hears.
    expect(LEGAL_MOVES_LABEL).toBe('Legal moves');
  });

  it('renders one labeled group while the kernel is asking anything', () => {
    render(h(PlayView, { session: openingSession(), viewer: 0, names: NAMES, onChoose: vi.fn() }));
    expect(screen.queryAllByRole('group', { name: LEGAL_MOVES_LABEL }).length).toBe(1);
  });

  it('holds one entry per enumerated move, so it is the complete list', () => {
    const session = prioritySession();
    const decision = session.pending;
    if (decision === null) throw new Error('the priority position has no pending decision');
    const prompt = buildPrompt(session.state, decision, NAMES);
    render(h(PlayView, { session, viewer: 0, names: NAMES, onChoose: vi.fn() }));

    const entries = within(rail()).getAllByRole('button');
    expect(entries.length).toBe(listed(prompt.choices).length);
    expect(entries.length).toBeGreaterThan(1);
    // And the pass really was the only thing missing, rather than the filter
    // covering for a second kind that also stopped being drawn.
    expect(entries.length).toBe(prompt.choices.length - 1);
  });

  it('draws every entry as a real button, which is what puts it in the tab order', () => {
    render(h(PlayView, { session: prioritySession(), viewer: 0, names: NAMES, onChoose: vi.fn() }));
    for (const entry of within(rail()).getAllByRole('button')) {
      expect(tag(entry)).toBe('BUTTON');
      // A click handler on a div would answer `getAllByRole('button')` through
      // an explicit role and still be unreachable from the keyboard.
      expect(attr(entry, 'type')).toBe('button');
      expect(attr(entry, 'aria-hidden')).toBeNull();
    }
  });

  it('submits an index out of the pending enumeration when an entry is pressed', () => {
    const session = prioritySession();
    const decision = session.pending;
    if (decision === null) throw new Error('the priority position has no pending decision');
    const onChoose = vi.fn();
    render(h(PlayView, { session, viewer: 0, names: NAMES, onChoose }));

    const entries = within(rail()).getAllByRole('button');
    const first = entries[0];
    if (first === undefined) throw new Error('the rail is empty at a priority');
    fireEvent.click(first);

    expect(onChoose).toHaveBeenCalledTimes(1);
    const index: unknown = onChoose.mock.calls[0]?.[0];
    expect(typeof index).toBe('number');
    expect(index as number).toBeGreaterThanOrEqual(0);
    expect(index as number).toBeLessThan(decision.options.length);
  });

  /**
   * The other half of the contract: the group is the *pending* enumeration, so
   * it is absent once nothing is pending. `play.test.ts` relies on that to read
   * an empty move list at the end of the game rather than a stale one.
   */
  it('is absent once the kernel has stopped asking', () => {
    let session = openingSession();
    for (let step = 0; step < 10_000 && session.pending !== null; step += 1) {
      session = choose(session, 0, { autoPass: DEFAULT_AUTO_PASS });
    }
    expect(session.result).not.toBeNull();
    render(h(PlayView, { session, viewer: 0, names: NAMES, onChoose: vi.fn() }));
    expect(screen.queryByRole('group', { name: LEGAL_MOVES_LABEL })).toBeNull();
  });
});

/** `{1}, {T}: Target creature gets +2/+2 until end of turn.` */
const PUMP: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 1 }, tapSelf: true },
  effects: [{ kind: 'pumpUntilEndOfTurn', power: 2, toughness: 2, target: { kind: 'targetCreature' } }],
};

/**
 * A creature printing an ability whose text never says its own name.
 *
 * Two of these on one board is the fold at its hardest: the act is identical on
 * every option, so what separates one run from the next is the detail, and the
 * detail is the source permanent. `EXAMPLE_CARDS` prints no activated ability at
 * all, which is half of why the mirror game cannot fold.
 */
const WARDEN: Card = parseCard({
  kind: 'creature',
  id: 'slc-lab-warden',
  name: 'Lab Warden',
  rarity: 'uncommon',
  set: { code: 'SLC', collectorNumber: 92 },
  manaCost: { generic: 2, R: 1 },
  colors: ['R'],
  power: 2,
  toughness: 2,
  abilities: [PUMP],
});

const MOUNTAIN = exampleCard('slc-mountain');
const LASH = exampleCard('slc-lightning-lash');
const GUARDIAN = exampleCard('slc-thornhide-guardian');

const SEATS: SeatNames = ['You', 'Bot'];

/**
 * A priority the rail folds twice over: a spell with several aims, and two
 * permanents printing one ability.
 *
 * Three runs of more than one, in two groups, which is what makes the ordering
 * and the index invariants say something — a single run would leave "the fold
 * never moves a member" true by having nothing to move.
 */
function foldingState(): GameState {
  return scenario({
    seed: 'test/play/rail-contract/folding',
    battlefield: [
      { card: MOUNTAIN, controller: 0 },
      { card: MOUNTAIN, controller: 0 },
      { card: WARDEN, controller: 0, summoningSick: false },
      { card: WARDEN, controller: 0, summoningSick: false, damage: 1 },
      { card: GUARDIAN, controller: 1 },
    ],
    hands: [[LASH], []],
    active: 0,
    turn: 4,
  }).state;
}

function foldingSession(): GameSession {
  const state = foldingState();
  const pending = pendingDecision(state);
  if (pending === null) throw new Error('the folding board left nobody to ask');
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

function foldingChoices(): readonly PlayChoice[] {
  const state = foldingState();
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('the folding board left nobody to ask');
  return buildPrompt(state, decision, SEATS).choices;
}

/** Every rail button pressed once, in the order they are drawn. */
function pressEveryEntry(): { readonly kinds: readonly string[]; readonly indices: readonly number[] } {
  const onChoose = vi.fn();
  render(h(PlayView, { session: foldingSession(), viewer: 0, names: SEATS, onChoose }));
  const entries = within(rail()).getAllByRole('button');
  const kinds = entries.map((entry) => attr(entry, 'data-kind') ?? '');
  for (const entry of entries) fireEvent.click(entry);
  const indices = onChoose.mock.calls.map((call) => call[0] as number);
  return { kinds, indices };
}

describe('the fold keeps the enumeration whole', () => {
  it('is measured on a rail that folds, which the mirror game never gives it', () => {
    // The premise, asserted rather than assumed. Every count and index rule
    // below is about folded output, so a fixture that quietly stopped folding
    // would leave them all passing and unverified — which is the state
    // `mtg-ebb` was filed about.
    const folded = foldingChoices().filter((choice) => choice.label.includes(TARGET_ARROW));
    expect(folded.length).toBeGreaterThan(3);
    const acts = folded.map(
      (choice) => `${choice.label.slice(0, choice.label.indexOf(TARGET_ARROW))}\n${choice.detail ?? ''}`,
    );
    // At least two distinct runs, each holding more than one option.
    const runs = new Map<string, number>();
    for (const act of acts) runs.set(act, (runs.get(act) ?? 0) + 1);
    expect([...runs.values()].filter((count) => count > 1).length).toBeGreaterThan(1);
    // And the mirror game this file's other fixtures use offers none of it.
    const opening = prioritySession();
    const decision = opening.pending;
    if (decision === null) throw new Error('the priority position has no pending decision');
    const mirror = buildPrompt(opening.state, decision, NAMES).choices;
    expect(mirror.filter((choice) => choice.label.includes(TARGET_ARROW))).toHaveLength(0);
  });

  it('holds one entry per enumerated move once the rail is folded', () => {
    render(h(PlayView, { session: foldingSession(), viewer: 0, names: SEATS, onChoose: vi.fn() }));
    expect(within(rail()).getAllByRole('button')).toHaveLength(listed(foldingChoices()).length);
  });

  it('gives every entry its own index, so no option is dropped and none is drawn twice', () => {
    const choices = listed(foldingChoices());
    const { indices } = pressEveryEntry();
    // Sorted rather than in order, because the groups reorder the enumeration.
    // What must hold is that every index arrives and each arrives once — a kind
    // listed under two group titles would deliver one of them twice.
    expect([...indices].sort((a, b) => a - b)).toEqual(choices.map((choice) => choice.index));
  });

  it('never moves a member of a run, so a press lands on the move it was aimed at', () => {
    const { kinds, indices } = pressEveryEntry();
    const seen = new Map<string, number>();
    for (const [at, kind] of kinds.entries()) {
      const index = indices[at];
      if (index === undefined) throw new Error('an entry submitted nothing');
      const previous = seen.get(kind);
      // Groups are cut on kind, so ascending within a kind is ascending within
      // a group. The fold reorders nothing inside one.
      if (previous !== undefined) expect(index).toBeGreaterThan(previous);
      seen.set(kind, index);
    }
  });

  it('keeps the whole unfolded sentence as every entry accessible name', () => {
    const choices = listed(foldingChoices());
    render(h(PlayView, { session: foldingSession(), viewer: 0, names: SEATS, onChoose: vi.fn() }));
    const names = within(rail())
      .getAllByRole('button')
      .map((entry) => attr(entry, 'aria-label') ?? text(entry));
    // Through `unfoldedName` rather than a second copy of the join: what this
    // asserts is that nothing of the folded button's sentence is lost, and the
    // punctuation between its two halves is pinned as a literal below, where a
    // person can read what a screen reader would say.
    for (const choice of choices) expect(names).toContain(unfoldedName(choice));
  });

  /**
   * `mtg-0xq`. Both shared spans above a run are `aria-hidden`, so this string is
   * the whole of the screen-reader path through a folded rail — and it was joined
   * with a bare space, which ran the target's last word into the detail's first:
   * `… → your Lab Warden Lab Warden (2/2)` is heard as one name. The board it was
   * measured on offered twelve buttons that differed only in that half.
   *
   * Pinned as literals, because the bug is what the string *sounds* like and a
   * comparison against the function that builds it would have passed on the day
   * it shipped.
   */
  it('punctuates the two halves of that name as the two sentences they are', () => {
    render(h(PlayView, { session: foldingSession(), viewer: 0, names: SEATS, onChoose: vi.fn() }));
    const names = within(rail())
      .getAllByRole('button')
      .map((entry) => attr(entry, 'aria-label') ?? text(entry));
    const act = 'Activate {1}, {T}: Target creature gets +2/+2 until end of turn.';
    expect(names).toContain(`${act} → your Lab Warden (2/2). Lab Warden (2/2)`);
    expect(names).toContain(`${act} → Bot's Thornhide Guardian. Lab Warden (2/2 · 1 damage marked)`);
    // The shipped join, named so the failure says which bug came back: the
    // target's last word and the source's first with nothing between them.
    expect(names.filter((name) => name.includes(') Lab Warden'))).toEqual([]);
    expect(names.filter((name) => name.includes('Guardian Lab Warden'))).toEqual([]);
  });

  /**
   * The stop is added and never doubled.
   *
   * An ability that names no target keeps `renderAbility`'s own closing period,
   * so a label can arrive already punctuated; `until end of turn.. Lab Warden`
   * is the doubled stop this branch exists to avoid, and no board in this file
   * produces one — the fold only ever runs on labels that end in a target.
   */
  it('adds one sentence stop to a label that has none, and none to a label that has one', () => {
    const detail = 'Lab Warden (2/2)';
    const choice = (label: string): PlayChoice => ({
      index: 0,
      label,
      detail,
      kind: 'activateAbility',
      oids: [],
    });
    expect(unfoldedName(choice('Activate {T}: Draw a card.'))).toBe(`Activate {T}: Draw a card. ${detail}`);
    expect(unfoldedName(choice('Equip {1} → your Lab Warden'))).toBe(
      `Equip {1} → your Lab Warden. ${detail}`,
    );
    expect(unfoldedName({ ...choice('Pass'), detail: null })).toBe('Pass');
  });

  /**
   * `mtg-1or`. A folded button prints neither the act nor the detail, so both
   * have to be above it. For an activation the detail is the source permanent —
   * the one thing that tells one Lab Warden's ability from the other's — and it
   * was on the accessible name and nowhere a sighted player could reach.
   */
  it('prints the shared act, its arrow and the shared detail above the run', () => {
    render(h(PlayView, { session: foldingSession(), viewer: 0, names: SEATS, onChoose: vi.fn() }));
    const group = rail();
    const act = 'Activate {1}, {T}: Target creature gets +2/+2 until end of turn. →';
    // One shared line per Warden, not one per option: two runs, two headings.
    expect(within(group).queryAllByText(act)).toHaveLength(2);
    // And the source under each of them, which is the whole of what separates
    // the two runs from one another.
    expect(within(group).queryAllByText('Lab Warden (2/2)')).toHaveLength(1);
    expect(within(group).queryAllByText('Lab Warden (2/2 · 1 damage marked)')).toHaveLength(1);
    // The arrow survives on the shared line rather than being deleted from both
    // halves: `Cast Lightning Lash` over a bare `Bot` is a verb phrase and a
    // noun with the relation between them gone.
    expect(within(group).queryAllByText('Cast Lightning Lash →')).toHaveLength(1);
  });
});

/** The blockers on the board `blockingSession` builds, against one attacker. */
const BLOCKERS = 6;

/**
 * Every legal block over `BLOCKERS` creatures answering one attacker.
 *
 * CR 509.1a lets each of them sit out or take the attacker, independently, so
 * the space is 2 to the board — the shape `mtg-y1t` measured at 256 and one
 * third the run time to walk. Asked for at this width rather than read off
 * `DEFAULT_ENUMERATION_CAP`, which is one global constant over every
 * enumeration in the kernel: 64 is a fact about six creatures, not about 512.
 */
const BLOCK_SPACE = 2 ** BLOCKERS;

function blockingSession(cap = DEFAULT_ENUMERATION_CAP): GameSession {
  let minted = 0;
  const mint = (name: string): Card =>
    parseCard({
      kind: 'creature',
      id: `slc-rail-${String((minted += 1))}`,
      name,
      rarity: 'common',
      set: { code: 'SLC', collectorNumber: minted },
      manaCost: { generic: 2 },
      colors: [],
      power: 2,
      toughness: 3,
    });
  const built = scenario({
    seed: 'test/play/rail-contract/blocking',
    battlefield: [
      { card: mint('Field Marshal'), controller: 0, summoningSick: false },
      ...Array.from({ length: BLOCKERS }, (_unused, at) => ({
        card: mint(`Picket ${String(at + 1)}`),
        controller: 1 as const,
        summoningSick: false,
      })),
    ],
    active: 0,
    turn: 6,
    step: 'declareAttackers',
  });
  // Driven to the end of the attack declaration rather than reduced once: past
  // the enumeration cap the kernel asks about one creature at a time
  // (`mtg-tb7v`, `mtg-y16d`).
  let state = driveDeclaration(built.state, 'declareAttackers');
  for (let guard = 0; guard < 20; guard += 1) {
    const decision = pendingDecision(state, cap);
    if (decision === null) throw new Error('the blocking board left nobody to ask');
    if (decision.kind === 'declareBlockers') {
      return {
        seats: [humanSeat(SEATS[0]), humanSeat(SEATS[1])],
        state,
        events: [],
        result: null,
        pending: decision,
        choices: [],
        decisions: 0,
        beat: null,
        committed: null,
      };
    }
    const option = decision.options[decision.options.length - 1];
    if (option === undefined) throw new Error('a decision on the way to blockers was empty');
    state = reduce(state, option).state;
  }
  throw new Error('the blocking board never reached a blocker declaration');
}

describe('the rail narrows at a combat declaration, and only there', () => {
  it('keeps the labeled group it is found by', () => {
    render(h(PlayView, { session: blockingSession(), viewer: 1, names: SEATS, onChoose: vi.fn() }));
    expect(screen.queryAllByRole('group', { name: LEGAL_MOVES_LABEL })).toHaveLength(1);
  });

  it('holds a control per creature rather than one per declaration', () => {
    const session = blockingSession(BLOCK_SPACE);
    const decision = session.pending;
    if (decision === null) throw new Error('the blocking board has no pending decision');
    // The premise: this is the exponential enumeration the narrowing is for. A
    // fixture that stopped being exponential would leave the count below true
    // and meaningless.
    expect(BLOCK_SPACE).toBe(64);
    expect(decision.options).toHaveLength(BLOCK_SPACE);

    render(h(PlayView, { session, viewer: 1, names: SEATS, onChoose: vi.fn() }));
    // Six creatures and one confirm. Linear in the board, where the list it
    // replaced was 2 to the power of it.
    expect(within(rail()).getAllByRole('button')).toHaveLength(BLOCKERS + 1);
  });

  it('draws every entry as a real button, exactly as the flat list does', () => {
    render(h(PlayView, { session: blockingSession(), viewer: 1, names: SEATS, onChoose: vi.fn() }));
    for (const entry of within(rail()).getAllByRole('button')) {
      expect(tag(entry)).toBe('BUTTON');
      expect(attr(entry, 'type')).toBe('button');
      expect(attr(entry, 'aria-hidden')).toBeNull();
    }
  });

  it('keeps the enumerated sentence on the confirm while its visible text stays one clause', () => {
    const session = blockingSession(BLOCK_SPACE);
    const decision = session.pending;
    if (decision === null) throw new Error('the blocking board has no pending decision');
    const onChoose = vi.fn();
    render(h(PlayView, { session, viewer: 1, names: SEATS, onChoose }));

    // Three creatures onto the one attacker, which is where the enumerated
    // label grows a clause per blocker. Measured in a real game, two of them
    // took the panel from 449px of content to 583px and put three of its six
    // controls under the fold.
    for (const at of [0, 1, 2]) {
      const row = within(screen.getByRole('group', { name: 'Creatures that can block' })).getAllByRole(
        'button',
      )[at];
      if (row === undefined) throw new Error('the roster is shorter than the board');
      fireEvent.click(row);
    }

    const confirm = within(rail()).getAllByRole('button')[0];
    if (confirm === undefined) throw new Error('the rail lost its confirm');
    // The fold's own contract: the visible text does not name the creatures,
    // and the accessible name is the whole of what the enumeration called this
    // declaration — the same rule `choice-button.ts` keeps for a folded move.
    expect(text(confirm)).toBe('Block with 3 creatures');
    const spoken = attr(confirm, 'aria-label');
    expect(spoken).not.toBe(text(confirm));
    for (const at of [1, 2, 3]) expect(spoken).toContain(`Picket ${String(at)}`);

    // And it is the sentence of the option it submits, not a sentence of its own.
    fireEvent.click(confirm);
    const index = onChoose.mock.calls[0]?.[0] as number | undefined;
    if (index === undefined) throw new Error('the confirm submitted nothing');
    const chosen = decision.options[index];
    if (chosen === undefined) throw new Error('the confirm names no enumerated option');
    if (chosen.type !== 'declareBlockers') throw new Error('the confirm submitted something else');
    expect(chosen.blocks).toHaveLength(3);
  });

  it('submits an index out of the pending enumeration when the confirm is pressed', () => {
    const session = blockingSession();
    const decision = session.pending;
    if (decision === null) throw new Error('the blocking board has no pending decision');
    const onChoose = vi.fn();
    render(h(PlayView, { session, viewer: 1, names: SEATS, onChoose }));

    const first = within(rail()).getAllByRole('button')[0];
    if (first === undefined) throw new Error('the rail is empty at a blocker declaration');
    fireEvent.click(first);

    expect(onChoose).toHaveBeenCalledTimes(1);
    const index: unknown = onChoose.mock.calls[0]?.[0];
    expect(typeof index).toBe('number');
    expect(index as number).toBeGreaterThanOrEqual(0);
    expect(index as number).toBeLessThan(decision.options.length);
  });
});
