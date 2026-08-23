// @vitest-environment jsdom
/**
 * The playable board.
 *
 * The load-bearing test is the click-through: a whole game clicked from opening
 * hand to a result, against a bot, through the rendered surface rather than
 * through the kernel API underneath it. Everything else here checks a property
 * that test would not notice if it broke, chiefly that the opponent's hand stays
 * hidden and that the buttons on screen are the kernel's enumeration rather
 * than a second opinion about legality.
 *
 * The hotseat block at the end is the same board with a second person in the
 * other seat, and it exists because that is where the hiding gets hard: the seat
 * being asked changes every decision, so the board has to change with it, and it
 * must not change while the losing side of that swap is still holding the
 * screen. That last part is the handoff card, tested here by clicking it.
 */
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EXAMPLE_CARDS, basicLand, exampleCard, parseCard } from '@mtg/dsl';
import type { Choice, Decision, GameSession, GameState, PlayerId } from '@mtg/kernel';
import {
  botSeat,
  choose,
  createSession,
  DEFAULT_AUTO_PASS,
  FULL_CONTROL,
  humanSeat,
  legalActions,
  pendingDecision,
  reduceAll,
  scenario,
  simpleAgent,
} from '@mtg/kernel';
import { Board } from '../../src/board/Board';
import { seatPossessive } from '../../src/seat';
import { PlayRoute } from '../../src/routes/PlayRoute';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { boardPosition, handSlots, nameOf } from '../../src/routes/play/position';
import type { SeatNames } from '../../src/routes/play/position';
import {
  CONTINUE_LABEL,
  LEGAL_MOVES_LABEL,
  PASS_LABEL,
  PRIORITY_LABEL,
  PlayView,
} from '../../src/routes/play/PlayView';
import { PHASE_BAR_LABEL } from '../../src/routes/play/PhaseBar';
import { buildPrompt, describeStep, playableFromHand } from '../../src/routes/play/prompt';
import type { PlayConfig } from '../../src/routes/play/use-session';

afterEach(cleanup);

const NAMES = ['You', 'Bot'] as const;

/** What a hotseat game calls its seats, and what the copy assertions read against. */
const HOTSEAT: SeatNames = ['Player one', 'Player two'];

/**
 * Second person in surface copy.
 *
 * Banned on this surface for the same reason the seat names stopped being
 * relative: "you" resolves against whoever is being asked, and that changes
 * hands mid-turn now that the board follows the question. Only checked against
 * hotseat names, since a one-person game legitimately calls its seat "You".
 */
const SECOND_PERSON = /\byou(r|rs)?\b/i;

/**
 * The buttons that submit a choice, found the way a screen reader would: inside
 * the labeled group of legal moves. Empty once the game is over, because the
 * group is only rendered while the kernel is waiting for something.
 *
 * Queried by role rather than by class because the workspace tsconfig has no
 * `lib: dom`, so `getAttribute` is not typed here (see `card.test.ts`).
 */
function choiceButtons(): readonly ReturnType<typeof screen.getByRole>[] {
  const group = screen.queryByRole('group', { name: LEGAL_MOVES_LABEL });
  return group === null ? [] : within(group).queryAllByRole('button');
}

/**
 * The Continue button, drawn while the game is paused to show a combat beat.
 *
 * Deliberately outside the legal-moves group: the kernel enumerated nothing at a
 * pause, so a control inside the group naming the legal moves would be claiming
 * a move that does not exist (`mtg-0sn`, `rail.ts`). Which is exactly why the
 * click-through has to reach for it separately — a driver that only knew about
 * the group would stall at the first combat, and did.
 */
function continueButton(): ReturnType<typeof screen.queryByRole> {
  return screen.queryByRole('button', { name: CONTINUE_LABEL });
}

function dealt(): ReturnType<typeof dealMirrorGame> {
  return dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
}

/**
 * The two node members one test below needs, checked at runtime because the
 * workspace tsconfig has no `lib: dom` and `HTMLElement` here carries neither.
 */
interface NodeLike {
  readonly querySelector: (selector: string) => NodeLike | null;
  readonly isConnected: boolean;
}

function nodeOf(value: unknown): NodeLike {
  const candidate = value as Partial<NodeLike> | null | undefined;
  if (
    candidate === null ||
    candidate === undefined ||
    typeof candidate.querySelector !== 'function' ||
    typeof candidate.isConnected !== 'boolean'
  ) {
    throw new Error('expected a node in the document');
  }
  return candidate as NodeLike;
}

/**
 * The position the surface actually opens on.
 *
 * Settled under the default auto-pass settings (`mtg-bc2.140`), because that is
 * what `usePlaySession` gives a config that asks for nothing, and a fixture that
 * settled differently from the render would make every comparison below a
 * comparison of two different positions. Auto-pass changes which priority the
 * player is asked about and nothing else: the opening hand, the hidden opponent
 * hand and the object ids are the same either way.
 */
function dealtSession(): GameSession {
  const game = dealt();
  return createSession(game.config.setup, game.config.seats, { autoPass: DEFAULT_AUTO_PASS });
}

/**
 * The same position with the opening hands settled.
 *
 * The surface opens on CR 103.4's mulligan now, and every assertion below this
 * one is about the board behind that question, so the person's seat keeps what
 * it was dealt — index 0 is the keep — and the bot answers its own inside
 * `advance`. The opening-hand prompt itself is tested in its own block.
 */
function freshSession(): GameSession {
  const opened = dealtSession();
  if (opened.pending?.kind !== 'mulligan') return opened;
  return choose(opened, 0, { autoPass: DEFAULT_AUTO_PASS });
}

/**
 * A blocker assignment with the near seat defending.
 *
 * Stated as a position and then walked forward through the real machinery: the
 * attack is an enumerated action and the priorities are passed, so the decision
 * this returns is one the kernel raised rather than one a test wrote.
 */
function blockersDecision(): { readonly state: GameState; readonly decision: Decision } {
  const parked = scenario({
    seed: 'test/play/blockers-sentence',
    battlefield: [
      { card: exampleCard('slc-emberflow-raider'), controller: 1, summoningSick: false },
      { card: exampleCard('slc-thornhide-guardian'), controller: 0, summoningSick: false },
    ],
    active: 1,
    turn: 4,
    step: 'declareAttackers',
  }).state;
  const attack = legalActions(parked).find(
    (action) => action.type === 'declareAttackers' && action.attackers.length > 0,
  );
  if (attack === undefined) throw new Error('the parked board enumerated no attack');
  let state = reduceAll(parked, [attack]).state;
  for (let step = 0; step < 8 && pendingDecision(state)?.kind !== 'declareBlockers'; step += 1) {
    const priority = state.turn.priority;
    if (priority === null) break;
    state = reduceAll(state, [{ type: 'passPriority', player: priority }]).state;
  }
  const decision = pendingDecision(state);
  if (decision === null || decision.kind !== 'declareBlockers') {
    throw new Error('the parked board never reached a blocker assignment');
  }
  return { state, decision };
}

describe('dealing a game', () => {
  it('builds a real deck and seats a person opposite a bot', () => {
    const game = dealt();
    expect(game.deck.cards.length).toBeGreaterThan(20);
    expect(game.config.seats[0].kind).toBe('human');
    expect(game.config.seats[1].kind).toBe('bot');
  });

  it('starts already waiting on the person', () => {
    const session = freshSession();
    expect(session.pending).not.toBeNull();
    expect(session.pending?.player).toBe(0);
  });
});

describe('the opening hand', () => {
  it('is the first thing the surface asks about', () => {
    const session = dealtSession();
    expect(session.pending?.kind).toBe('mulligan');
    expect(session.pending?.player).toBe(0);
    expect(session.state.turn.number).toBe(0);
  });

  it('names the question and both answers, in words a person can act on', () => {
    const session = dealtSession();
    const decision = session.pending;
    if (decision === null) throw new Error('expected a pending decision');
    const prompt = buildPrompt(session.state, decision, HOTSEAT);

    expect(prompt.headline).toBe('Opening hand');
    expect(prompt.explain).toContain('shuffles it back');
    expect(prompt.choices.map((choice) => choice.label)).toEqual(['Keep this hand', 'Mulligan']);
  });

  /**
   * The verb agrees with the seat, and this is the first sentence of every game.
   *
   * `prompt.ts` named the seat and left the verb in the third person, so an
   * ordinary table — whose seat is called `You` — opened on `You keeps this
   * hand, or shuffles it back for a new one.` and, after one mulligan, `You has
   * mulliganed 1 time`. Both voices are asserted here because a fix that only
   * ever conjugated one way would pass a test written in one voice: `mtg-1ih`
   * was exactly that shape one route over.
   */
  it('conjugates the opening question for the seat it is asking', () => {
    const session = dealtSession();
    const decision = session.pending;
    if (decision === null) throw new Error('expected a pending decision');

    expect(buildPrompt(session.state, decision, NAMES).explain).toBe(
      'You keep this hand, or shuffle it back for a new one.',
    );
    expect(buildPrompt(session.state, decision, HOTSEAT).explain).toBe(
      'Player one keeps this hand, or shuffles it back for a new one.',
    );
  });

  it('conjugates the sentence that counts the mulligans taken so far', () => {
    const session = dealtSession();
    const first = session.pending;
    if (first === null) throw new Error('expected a pending decision');
    const mulligan = first.options.findIndex((option) => option.type === 'mulligan');
    if (mulligan < 0) throw new Error('the opening question offered no mulligan');
    const after = choose(session, mulligan);
    const decision = after.pending;
    if (decision === null) throw new Error('expected a second opening question');

    expect(buildPrompt(after.state, decision, NAMES).explain).toContain('You have mulliganed 1 time');
    expect(buildPrompt(after.state, decision, HOTSEAT).explain).toContain('Player one has mulliganed 1 time');
  });

  it('offers both answers as buttons a screen reader can name', () => {
    const game = dealt();
    render(h(PlayRoute, { config: game.config }));

    const group = screen.getByRole('group', { name: LEGAL_MOVES_LABEL });
    expect(within(group).getByRole('button', { name: 'Keep this hand' })).toBeDefined();
    expect(within(group).getByRole('button', { name: 'Mulligan' })).toBeDefined();
  });

  it('deals a new hand when the mulligan is clicked, and asks again', () => {
    const game = dealt();
    render(h(PlayRoute, { config: game.config }));
    const before = screen.getByRole('group', { name: LEGAL_MOVES_LABEL });
    fireEvent.click(within(before).getByRole('button', { name: 'Mulligan' }));

    // Asked again, and keeping now costs the card the mulligan was bought with:
    // one keep per card that could go to the bottom, plus the mulligan.
    const after = screen.getByRole('group', { name: LEGAL_MOVES_LABEL });
    expect(within(after).getAllByRole('button', { name: /^Keep, bottoming / })).toHaveLength(7);
    expect(within(after).getByRole('button', { name: 'Mulligan' })).toBeDefined();
  });
});

describe('the position drawn from live state', () => {
  it('lays a cross-controlled Aura with the opposing creature it enchants', () => {
    const pacifism = parseCard({
      kind: 'enchantment',
      id: 'm11-pacifism',
      name: 'Pacifism',
      rarity: 'common',
      set: { code: 'M11', collectorNumber: 24 },
      manaCost: { generic: 1, W: 1 },
      colors: ['W'],
      subtypes: ['Aura'],
      aura: {
        enchant: 'creature',
        modifications: [{ kind: 'cantAttack' }, { kind: 'cantBlock' }],
      },
    });
    const lion = exampleCard('slc-thornhide-guardian');
    const plains = basicLand('Plains', 'M11', 231);
    const start = scenario({
      battlefield: [
        { card: lion, controller: 1 },
        { card: plains, controller: 0 },
        { card: plains, controller: 0 },
      ],
      hands: [[pacifism], []],
    }).state;
    const host = start.battlefield.find((oid) => start.objects[oid]?.card.id === lion.id);
    const aura = start.players[0].hand[0];
    if (host === undefined || aura === undefined) throw new Error('the fixture omitted its Aura or host');
    const attached = reduceAll(start, [
      {
        type: 'castSpell',
        player: 0,
        oid: aura,
        targets: [{ kind: 'permanent', oid: host }],
      },
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]).state;

    const position = boardPosition(attached, 0, NAMES);
    expect(position.you.battlefield.permanents.map((permanent) => permanent.card.name)).not.toContain(
      'Pacifism',
    );
    expect(position.opponent.battlefield.permanents.map((permanent) => permanent.card.name)).toEqual([
      lion.name,
      'Pacifism',
    ]);
    expect(position.opponent.battlefield.count).toBe(1);

    render(h(Board, position));
    expect(
      screen.getByRole('group', { name: `${lion.name}, enchanted by Pacifism, controlled by you` }),
    ).toBeTruthy();
  });

  it('never draws a duplicate opponent-hand rail when the seat pod already carries its count', () => {
    const session = freshSession();
    const position = boardPosition(session.state, 0, NAMES);

    expect(position.opponent.hand).toBeUndefined();
    expect(position.opponent.status.handCount).toBe(session.state.players[1].hand.length);
    expect(position.opponent.status.handCount).toBeGreaterThan(0);
  });

  it('reveals the viewer own hand', () => {
    const session = freshSession();
    const position = boardPosition(session.state, 0, NAMES);

    expect(position.you.hand?.cards.length).toBe(session.state.players[0].hand.length);
    expect(position.you.hand?.hiddenCount).toBeUndefined();
  });

  it('draws the viewer nearest whichever seat they are in', () => {
    const session = freshSession();
    const asSeatOne = boardPosition(session.state, 1, NAMES);
    expect(asSeatOne.you.hand?.cards.length).toBe(session.state.players[1].hand.length);
    expect(asSeatOne.opponent.hand).toBeUndefined();
  });

  it('keys cards by object id so a rendered card maps back to a kernel object', () => {
    const session = freshSession();
    const position = boardPosition(session.state, 0, NAMES);
    const keys = position.you.hand?.cards.map((card) => card.key) ?? [];
    expect(keys).toEqual([...session.state.players[0].hand]);
  });

  it('takes the rail width from the game being played rather than from a typed seven', () => {
    // Every fixture in this file deals the default seven, so a literal 7 in
    // `handSlots` is indistinguishable from the derivation on any of them. A
    // scenario that deals five is what tells them apart, and the kernel already
    // accepts one: the rail is meant to match the hand the game was set up to
    // deal, not the hand this fixture happens to deal.
    const game = dealt();
    const short = createSession({ ...game.config.setup, openingHandSize: 5 }, game.config.seats);
    expect(short.state.players[0].hand).toHaveLength(5);
    expect(handSlots(short.state)).toBe(5);
    expect(handSlots(freshSession().state)).toBe(7);
  });
});

describe('the prompt', () => {
  it('states what the game is waiting for', () => {
    const session = freshSession();
    const decision = session.pending;
    if (decision === null) throw new Error('expected a pending decision');
    const prompt = buildPrompt(session.state, decision, NAMES);

    expect(prompt.headline.length).toBeGreaterThan(0);
    expect(prompt.explain.length).toBeGreaterThan(0);
    expect(prompt.choices.length).toBe(decision.options.length);
  });

  it('gives every choice an index into the kernel enumeration and nothing else', () => {
    const session = freshSession();
    const decision = session.pending;
    if (decision === null) throw new Error('expected a pending decision');
    const prompt = buildPrompt(session.state, decision, NAMES);

    expect(prompt.choices.map((choice) => choice.index)).toEqual(
      decision.options.map((_option, index) => index),
    );
    for (const choice of prompt.choices) {
      expect(choice.label.length).toBeGreaterThan(0);
    }
  });

  it('derives playable hand cards from the enumeration rather than from its own rules', () => {
    const session = freshSession();
    const decision = session.pending;
    if (decision === null) throw new Error('expected a pending decision');
    const prompt = buildPrompt(session.state, decision, NAMES);
    const playable = playableFromHand(prompt);

    const castable = decision.options
      .filter((option) => option.type === 'playLand' || option.type === 'castSpell')
      .map((option) => (option.type === 'playLand' || option.type === 'castSpell' ? option.oid : ''));
    expect([...playable].sort()).toEqual([...new Set(castable)].sort());
  });

  it('names the turn, the step, and the seat whose turn it is', () => {
    const session = freshSession();
    expect(describeStep(session.state, NAMES)).toMatch(/^Turn 1 · /);
    // The active seat by name. "Your turn" was accurate for one viewer and
    // useless on a shared screen: the viewer changes hands mid-turn, so the
    // header reworded itself while the turn it describes stayed put.
    expect(describeStep(session.state, HOTSEAT)).toContain('Player one');
    expect(describeStep(session.state, HOTSEAT)).not.toMatch(SECOND_PERSON);
  });

  it('names the seat it is asking instead of calling a shared screen "you"', () => {
    const session = freshSession();
    const decision = session.pending;
    if (decision === null) throw new Error('expected a pending decision');
    const prompt = buildPrompt(session.state, decision, HOTSEAT);

    expect(prompt.explain).toContain(HOTSEAT[decision.player]);
    expect(prompt.headline).not.toMatch(SECOND_PERSON);
    expect(prompt.explain).not.toMatch(SECOND_PERSON);
  });

  /**
   * `mtg-crv`. The seat is named in the *middle* of this one, which is a slot
   * the three sentences above never occupy: a label keeps its capital anywhere
   * and the pronoun does not, so `Unblocked attackers deal their damage to You.`
   * read as a player called You rather than as the person holding the screen.
   * The log had already found and named this (`seat.ts`'s `seatMention`), and
   * the prompt was written without it.
   *
   * Both voices, for the reason the mulligan sentence is asserted in both: a fix
   * that lowercased everything would print `deal their damage to player one`.
   */
  it('says the seat mid-sentence as a pronoun, and a named seat as its name', () => {
    const blocking = blockersDecision();
    expect(buildPrompt(blocking.state, blocking.decision, NAMES).explain).toBe(
      'Assign blockers to the 1 attacking creature. Unblocked attackers deal their damage to you.',
    );
    expect(buildPrompt(blocking.state, blocking.decision, HOTSEAT).explain).toBe(
      'Assign blockers to the 1 attacking creature. Unblocked attackers deal their damage to Player one.',
    );
  });
});

describe('the rendered board', () => {
  it('shows the prompt and one button per legal option', () => {
    const game = dealt();
    render(h(PlayRoute, { config: game.config }));

    // The dealt position rather than the settled one: what a rendered board
    // opens on is the opening hand, and the count has to be the count of the
    // question actually on screen.
    const session = dealtSession();
    const optionCount = session.pending?.options.length ?? 0;
    expect(optionCount).toBeGreaterThan(0);
    // Exactly the enumeration, not a superset: a surface that invented an extra
    // affordance would be a surface that can ask for something illegal.
    expect(choiceButtons().length).toBe(optionCount);
    expect(screen.getByText(`${String(optionCount)} legal`)).toBeTruthy();
  });

  it('starts each move list at the top instead of where the last one was left', () => {
    // The rail's body scrolls internally, and a scroll container keeps its
    // offset across a re-render. Driving a 260-step game at 1280x800 hit the
    // consequence at step 248: the list arrived already scrolled and the point
    // at the center of the first legal move hit-tested to the panel head. The
    // body carries a key that changes with the decision, so it remounts and the
    // browser gives the new container scrollTop 0.
    //
    // jsdom lays nothing out, so scrollTop here is 0 whatever happens and
    // asserting it would prove nothing. What jsdom does show is the remount:
    // the old body leaves the document and the head beside it does not, which
    // is exactly the difference between "keyed" and "the whole rail rebuilt".
    const game = dealt();
    const view = render(h(PlayRoute, { config: game.config }));
    const root = nodeOf(view.container);
    const bodyBefore = nodeOf(root.querySelector('.mtg-prompt .mtg-panel__body'));
    const headBefore = nodeOf(root.querySelector('.mtg-prompt .mtg-panel__head'));
    expect(bodyBefore.isConnected).toBe(true);

    const first = choiceButtons()[0];
    expect(first, 'the game is waiting on a move').toBeTruthy();
    if (first !== undefined) fireEvent.click(first);

    expect(bodyBefore.isConnected, 'the list container is a new one').toBe(false);
    expect(headBefore.isConnected, 'and only the list container').toBe(true);
    expect(nodeOf(root.querySelector('.mtg-prompt .mtg-panel__body')).isConnected).toBe(true);
  });

  it('holds the hand rail at its width as the hand empties', () => {
    // The rail is as wide as an opening hand and stays there, so casting a card
    // leaves a drawn slot rather than shrinking the surface under the player's
    // cursor. Counted off the rendered markup, because the property is about
    // what is on screen and not about what the mapping returned.
    const game = dealt();
    const opening = freshSession().state.config.openingHandSize;

    // Casting where a cast is on offer, because taking the first option forever
    // is mostly passing priority and leaves the hand at seven all game.
    let session = createSession(game.config.setup, game.config.seats);
    let played = 0;
    while (session.pending !== null && session.state.players[0].hand.length >= opening && played < 200) {
      const options = session.pending.options;
      const spend = options.findIndex((option) => option.type === 'castSpell' || option.type === 'playLand');
      session = choose(session, spend === -1 ? 0 : spend);
      played += 1;
    }
    const held = session.state.players[0].hand.length;
    // A hand that never got smaller would make the assertion below vacuous.
    expect(held).toBeLessThan(opening);

    // The session that was measured, rather than a route that replays its
    // choices and settles on past it. **That distinction is what this assertion
    // was missing.** It used to render `PlayRoute` and count every
    // `data-empty` on the mat against `opening - held`, and the mat carried
    // eight of them from the two battlefield rows' placeholders — so the count
    // passed on the battlefield while claiming to measure the hand, and the
    // rendered hand was full at the moment it was checked. With the
    // placeholders gone (`../../src/board/Battlefield.ts`) the count went to
    // zero and said so.
    const markup = renderToStaticMarkup(
      h(PlayView, { session, viewer: 0 as PlayerId, names: NAMES, onChoose: () => undefined }),
    );
    expect(markup.match(/data-slot="hand"/g)).toHaveLength(opening);
    expect(markup.match(/data-slot="hand" data-empty="true" aria-hidden="true"/g) ?? []).toHaveLength(
      opening - held,
    );
  });

  it('draws no battlefield place that has no permanent in it', () => {
    // The row used to pad itself out to a stated count of places with dashed
    // markers, and the count was a design number rather than a rule of the game.
    // The playtester, 2026-08-14: "not sure why there are dashed line card boxes on
    // the battlefield, no reason for them". A hand rail still draws its own,
    // because there the number of places *is* a fact of the game — the kernel's
    // opening hand size — and the rail test above is what holds that.
    const game = dealt();
    const markup = renderToStaticMarkup(h(PlayRoute, { config: game.config }));
    expect(markup).not.toContain('class="mtg-page-title">Play</h1>');
    // Nothing is in play on turn one, so neither row draws a card slot at all.
    expect(markup.match(/data-slot="play"/g) ?? []).toHaveLength(0);
    expect(markup.match(/data-slot="play"[^>]*data-empty/g) ?? []).toHaveLength(0);
    // And both rows say so rather than going blank.
    expect(markup.match(/no permanents/g) ?? []).toHaveLength(2);
  });

  it('explains itself when there is no game to play', () => {
    render(h(PlayRoute, { config: null, sourceHint: 'deal one first' }));
    expect(screen.getByText('No game loaded')).toBeTruthy();
    expect(screen.getByText('deal one first')).toBeTruthy();
  });
});

/**
 * The click-through drives a whole game of kernel decisions through a jsdom
 * re-render each, which makes it the one test in this package that is CPU-bound
 * rather than instant: ~1.4s, where the next slowest here is 94ms. Against
 * vitest's 5s default that is 3.5x headroom, and `npm test` spends it running
 * the balance sweep on the same cores (see vitest.config.ts). Three agents hit
 * the 5s timeout here in one wave, and a full run taken while fixing it clocked
 * this test at 7.1s (mtg-bc2.55).
 *
 * Every other CPU-bound test in the repo already carries its own budget this
 * way — 30s in packages/setgen, 60s in packages/sim, 120s in packages/slice,
 * 180s in sim/closing — so this is the one that was missed rather than a new
 * idea. It stays scoped instead of raised in vitest.config.ts because the 5s
 * ceiling on every other test is what turns a genuine hang into a fast failure.
 * The loop below is bounded at 4,000 clicks, so what this buys is tolerance for
 * a busy machine, not tolerance for a test that never finishes.
 */
const CLICK_THROUGH_BUDGET_MS = 30_000;

/** Vitest's own default, which every other test in the suite must keep. */
const DEFAULT_BUDGET_MS = 5_000;

describe('playing a whole game by clicking', () => {
  it(
    'reaches a result without the surface ever producing an action the kernel rejects',
    { timeout: CLICK_THROUGH_BUDGET_MS },
    ({ task }) => {
      // Reads back the budget the runner actually applied: drop the option above
      // and this is 5000, so the docblock cannot outlive what it describes.
      // Changing the constant itself is a deliberate act and still passes.
      expect(task.timeout, 'the click-through needs its own budget under load').toBe(CLICK_THROUGH_BUDGET_MS);

      const game = dealt();
      render(h(PlayRoute, { config: game.config }));

      let clicks = 0;
      let beats = 0;
      for (; clicks < 4000; clicks += 1) {
        // A paused game offers no legal moves and is not over, so the driver
        // presses on the way a person does. Counted separately because the two
        // presses mean different things: one is a decision, one is a look.
        const paused = continueButton();
        if (paused !== null) {
          fireEvent.click(paused);
          beats += 1;
          expect(screen.queryByRole('alert')).toBeNull();
          continue;
        }
        const buttons = choiceButtons();
        if (buttons.length === 0) break;
        const target = buttons[0];
        if (target === undefined) break;
        fireEvent.click(target);
        // A rejected action surfaces as an alert instead of a new position, so
        // this is the assertion that the buttons and the kernel agree.
        expect(screen.queryByRole('alert')).toBeNull();
      }

      // A real game rather than a handful of passes into a stall. Thirty rather
      // than fifty since `mtg-hmy`: this driver clicks the first button it is
      // offered, so it plays a whole game without ever spending a card, and the
      // clicks it used to burn on windows where the pass was the only offer are
      // not put in front of it any more. The game underneath is as long as it
      // was; the clicking is a third shorter.
      expect(clicks).toBeGreaterThan(30);
      // And it saw the combats. This driver takes the first option it is
      // offered, which at a declaration is "attack with nothing", so the beats
      // it counts are the bot's attacks — which is the half of `mtg-0sn` a
      // player is least able to reconstruct afterwards.
      //
      // Unconverted on purpose (`mtg-4nkq`): this is the one claim in the two
      // suites that a lowered `DEFAULT_ENUMERATION_CAP` takes away and no
      // rewrite here can give back. A session enumerates at that constant —
      // `createSession` and `advance` take no width, unlike `pendingDecision`
      // and `legalActions` — so a test driving the whole surface cannot state
      // the width its game needs. Narrow every declaration and the bot attacks
      // with nothing all game, so the panel this counts never opens. What is
      // being asserted is still a real property of the shipped configuration
      // and not a measured constant, so it stays as it is.
      expect(beats, 'a whole game went by without one combat being shown').toBeGreaterThan(0);
      expect(screen.getByText('Game over')).toBeTruthy();
    },
  );

  it('leaves every other test on the default budget, so a hang still fails fast', ({ task }) => {
    // The other half of the decision. Answering the flake with a `testTimeout`
    // on the unit project or at the root of vitest.config.ts would have masked
    // hangs across the whole suite; this fails if anyone does.
    expect(task.timeout, 'only the click-through above may carry its own budget').toBe(DEFAULT_BUDGET_MS);
  });

  it('the same clicks replay into the same game, so a played game is recordable', () => {
    const game = dealt();
    let session = createSession(game.config.setup, game.config.seats);
    while (session.pending !== null) session = choose(session, 0);

    let replayed = createSession(game.config.setup, game.config.seats);
    for (const index of session.choices) replayed = choose(replayed, index);

    expect(replayed.choices).toEqual(session.choices);
    expect(replayed.result).toEqual(session.result);
  });
});

/**
 * `mtg-a1d6`. `session.state` is the last state the game reached, which is a
 * real turn with a real active player and a real step — nothing is wrong with
 * it, but three regions drew it unconditionally: the seat pods' Active badge,
 * the priority group with the fixed Pass inside it, and the stepped phase bar.
 * A finished game offered none of the three a decision to answer, so all three
 * are gone once `session.result` is set, and `resultPanel`'s own sentence is
 * what a player reads in their place.
 */
describe('a finished game', () => {
  it('draws no live-table chrome once the kernel has settled a result', () => {
    const game = dealt();
    let session = createSession(game.config.setup, game.config.seats);
    while (session.pending !== null) session = choose(session, 0);
    expect(session.result).not.toBeNull();

    render(h(PlayView, { session, viewer: 0 as PlayerId, names: NAMES, onChoose: () => undefined }));

    expect(screen.queryByText('Active')).toBeNull();
    expect(screen.queryByRole('group', { name: PRIORITY_LABEL })).toBeNull();
    expect(screen.queryByRole('group', { name: PHASE_BAR_LABEL })).toBeNull();
    expect(screen.queryByRole('button', { name: PASS_LABEL })).toBeNull();
    // What is left in that space instead: the result, stated plainly.
    expect(screen.getByText('Game over')).toBeTruthy();
  });

  it('still shows the pass and the phase bar for a live game', () => {
    // The negative assertions above are only a fix if a game in progress still
    // gets its live chrome — otherwise `gameOver` could be wired backwards and
    // every assertion above would pass for the wrong reason.
    const session = freshSession();
    expect(session.result).toBeNull();

    render(
      h(PlayView, {
        session,
        viewer: 0 as PlayerId,
        names: NAMES,
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
      }),
    );

    expect(screen.queryByRole('group', { name: PHASE_BAR_LABEL })).not.toBeNull();
    // Scoped to the priority group: a fresh session's own prompt panel also
    // offers "Pass" as a legal move to click, which is a second button with the
    // same accessible name and not the one this test is about.
    const priority = screen.getByRole('group', { name: PRIORITY_LABEL });
    expect(within(priority).queryByRole('button', { name: PASS_LABEL })).not.toBeNull();
  });
});

describe('the opponent seat', () => {
  it('plays itself, so the person is only ever asked their own decisions', () => {
    const game = dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
    let session = createSession(game.config.setup, game.config.seats);
    let asked = 0;
    while (session.pending !== null && asked < 2000) {
      expect(session.pending.player).toBe(0);
      session = choose(session, 0);
      asked += 1;
    }
    expect(session.result).not.toBeNull();
    // The bot answered the rest; every decision beyond the person's own is one
    // the session played without asking.
    expect(session.decisions).toBeGreaterThan(session.choices.length);
  });

  it('is the kernel agent rather than a sim bot, so no Node built-in reaches the bundle', () => {
    const game = dealt();
    const seat = game.config.seats[1];
    expect(seat.kind).toBe('bot');
    if (seat.kind !== 'bot') throw new Error('seat 1 should be a bot');
    expect(seat.agent.name).toBe('Bot');
    expect(simpleAgent('probe').name).toBe('probe');
    expect(humanSeat('x').kind).toBe('human');
    expect(botSeat(simpleAgent('y')).kind).toBe('bot');
  });
});

/**
 * Two people, one screen.
 *
 * Hiding the other hand is the whole job here and it fails quietly: a board
 * drawn from the wrong seat shows one player the other's cards with nothing on
 * screen saying so. So the assertion runs against real positions from a real
 * game, once per seat, and checks the negative as well as the positive — the
 * hand that should be hidden is face-down cards and none of its card names
 * reach the page.
 */
describe('two people at one screen', () => {
  function hotseatGame(): ReturnType<typeof dealMirrorGame> {
    return dealMirrorGame(EXAMPLE_CARDS, { opponent: 'human' });
  }

  interface Beat {
    /** The seat the kernel is waiting on in this position. */
    readonly asked: PlayerId;
    /** The choices that reach it, which is how the surface is replayed to it. */
    readonly choices: readonly Choice[];
    /** Both hands as card names, so a leak has something concrete to be caught by. */
    readonly hands: readonly [readonly string[], readonly string[]];
  }

  function handNames(session: GameSession, seat: PlayerId): readonly string[] {
    return session.state.players[seat].hand.map((oid) => nameOf(session.state, oid));
  }

  /** Plays a whole game by always taking the first option, recording every position. */
  function play(config: PlayConfig): { readonly beats: readonly Beat[]; readonly final: GameSession } {
    let session = createSession(config.setup, config.seats);
    const beats: Beat[] = [];
    while (session.pending !== null && beats.length < 2000) {
      beats.push({
        asked: session.pending.player,
        choices: [...session.choices],
        hands: [handNames(session, 0), handNames(session, 1)],
      });
      session = choose(session, 0);
    }
    return { beats, final: session };
  }

  /** Positions worth rendering: per seat, the first few and the last, both hands holding something. */
  function samples(beats: readonly Beat[]): readonly Beat[] {
    const usable = beats.filter((beat) => beat.hands[0].length > 0 && beat.hands[1].length > 0);
    const forSeat = (seat: PlayerId): readonly Beat[] => {
      const seen = usable.filter((beat) => beat.asked === seat);
      const last = seen.at(-1);
      return last === undefined ? [] : [...seen.slice(0, 3), last];
    };
    return [...forSeat(0), ...forSeat(1)];
  }

  function handZone(name: string): ReturnType<typeof screen.getByLabelText> {
    // Said as the seat's, which is how every zone on this board is named
    // (`position.ts`): a region called `Player one hand` is what a screen reader
    // reads out, and it is a possessive slot rather than a label slot.
    return screen.getByLabelText(`${seatPossessive(name)} hand`);
  }

  /** The handoff card's button, when the table is waiting to change hands. */
  function passButton(): ReturnType<typeof screen.queryByRole> {
    return screen.queryByRole('button', { name: /^I am Player/ });
  }

  it('seats two people, and leaves a bot the default', () => {
    expect(hotseatGame().config.seats.map((seat) => seat.kind)).toEqual(['human', 'human']);
    expect(dealt().config.seats.map((seat) => seat.kind)).toEqual(['human', 'bot']);
  });

  it('names seats rather than the viewer, so a label holds still while the question moves', () => {
    expect(hotseatGame().config.names).toEqual(['Player one', 'Player two']);
    expect(dealMirrorGame(EXAMPLE_CARDS, { viewer: 1 }).config.names).toEqual(['Bot', 'You']);
    expect(dealMirrorGame(EXAMPLE_CARDS, { opponent: 'human', viewer: 1 }).config.names).toEqual([
      'Player two',
      'Player one',
    ]);
  });

  it('shows the hand of whoever is being asked and hides the other, in both directions', () => {
    const game = hotseatGame();
    const positions = samples(play(game.config).beats);
    // Both directions, or the loop below proves nothing: a viewer pinned to one
    // seat passes every assertion made about that seat.
    expect(new Set(positions.map((beat) => beat.asked))).toEqual(new Set([0, 1]));

    for (const beat of positions) {
      cleanup();
      const other: PlayerId = beat.asked === 0 ? 1 : 0;
      // Rendered at full control because the walk above is: `play` answers every
      // priority, so its prefixes name positions auto-pass would have taken, and
      // a render that settled past one would be checking a different beat's
      // hands against this beat's names. The hiding rule is what is under test
      // and it holds at every position either way; keeping the walk exhaustive
      // is what gives it the most positions to hold at.
      render(h(PlayRoute, { config: { ...game.config, choices: beat.choices, autoPass: FULL_CONTROL } }));

      const shown = handZone(HOTSEAT[beat.asked]);
      expect(within(shown).queryAllByLabelText('face-down card')).toHaveLength(0);
      for (const card of beat.hands[beat.asked]) {
        expect(within(shown).queryAllByText(card).length).toBeGreaterThan(0);
      }

      expect(screen.queryByLabelText(`${seatPossessive(HOTSEAT[other])} hand`)).toBeNull();
      const hiddenStatus = screen.getByLabelText(`${HOTSEAT[other]}'s status`);
      expect(
        within(hiddenStatus).getByText(String(beat.hands[other].length), {
          selector: '[title="hand"]',
        }),
      ).toBeTruthy();
    }
  });

  it('is clickable from the same route, with exactly one revealed hand at every step', () => {
    const game = hotseatGame();
    render(h(PlayRoute, { config: game.config }));

    let clicks = 0;
    let handoffs = 0;
    for (; clicks < 20; clicks += 1) {
      const pass = passButton();
      if (pass !== null) {
        handoffs += 1;
        fireEvent.click(pass);
      }
      const target = choiceButtons()[0];
      if (target === undefined) break;
      const shownHands = HOTSEAT.map((name) =>
        screen.queryByLabelText(`${seatPossessive(name)} hand`),
      ).filter((zone) => zone !== null);
      // One hand is playable. Rendering both is a leak; rendering neither is a
      // board nobody can play from.
      expect(shownHands).toHaveLength(1);
      expect(within(shownHands[0]!).queryAllByLabelText('face-down card')).toHaveLength(0);
      fireEvent.click(target);
      expect(screen.queryByRole('alert')).toBeNull();
    }
    // A board that stopped offering moves would have made every assertion above
    // vacuous by never running it.
    expect(clicks).toBe(20);
    // And the question really did cross the table inside those twenty clicks,
    // which is what makes the alternating assertion mean anything.
    expect(handoffs).toBeGreaterThan(0);
  });

  /**
   * The board follows the question, so the moment one player passes priority the
   * other player's hand would be on a screen the first player is still holding.
   * The handoff card is what stands between those two facts, and it fails the
   * same silent way everything else here does.
   */
  it('covers the table while the device changes hands, then opens it on the new seat', () => {
    const game = hotseatGame();
    render(h(PlayRoute, { config: game.config }));
    // Seat 0 is asked first and is holding the screen, so nothing is in the way.
    expect(passButton()).toBeNull();

    let clicks = 0;
    for (; clicks < 200 && passButton() === null; clicks += 1) {
      const target = choiceButtons()[0];
      if (target === undefined) break;
      fireEvent.click(target);
    }

    const pass = passButton();
    if (pass === null) throw new Error('expected the question to cross the table');
    // Neither hand and no move on offer: the player still holding the screen has
    // nothing of the other player's to read.
    expect(screen.queryByLabelText("Player one's hand")).toBeNull();
    expect(screen.queryByLabelText("Player two's hand")).toBeNull();
    expect(choiceButtons()).toHaveLength(0);
    expect(screen.getByText('Pass the device to Player two')).toBeTruthy();

    fireEvent.click(pass);
    expect(within(handZone('Player two')).queryAllByLabelText('face-down card')).toHaveLength(0);
    expect(screen.queryByLabelText("Player one's hand")).toBeNull();
    expect(choiceButtons().length).toBeGreaterThan(0);
  });

  it('never says "you" to a shared screen, at any decision in a whole game', () => {
    const game = hotseatGame();
    let session = createSession(game.config.setup, game.config.seats);
    let asked = 0;
    while (session.pending !== null && asked < 2000) {
      const prompt = buildPrompt(session.state, session.pending, HOTSEAT);
      expect(prompt.headline).not.toMatch(SECOND_PERSON);
      expect(prompt.explain).not.toMatch(SECOND_PERSON);
      expect(describeStep(session.state, HOTSEAT)).not.toMatch(SECOND_PERSON);
      session = choose(session, 0);
      asked += 1;
    }
    // A whole game of them, not the opening priority: the second person survived
    // in the combat and discard prompts, which the first few decisions miss.
    expect(asked).toBeGreaterThan(50);
  });

  it('replays the same choices into the same game, whichever seat made them', () => {
    const game = hotseatGame();
    const played = play(game.config);
    expect(played.final.result).not.toBeNull();
    expect(played.final.choices.length).toBeGreaterThan(50);
    // Both people really answered: a hotseat game that quietly ran one seat as a
    // bot would replay just as well and mean nothing.
    expect(new Set(played.beats.map((beat) => beat.asked))).toEqual(new Set([0, 1]));

    let replayed = createSession(game.config.setup, game.config.seats);
    for (const index of played.final.choices) replayed = choose(replayed, index);

    expect(replayed.choices).toEqual(played.final.choices);
    expect(replayed.state).toEqual(played.final.state);
    expect(replayed.result).toEqual(played.final.result);
  });
});
