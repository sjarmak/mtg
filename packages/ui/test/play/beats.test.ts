// @vitest-environment jsdom
/**
 * Seeing a combat happen.
 *
 * `mtg-0sn` in one sentence: choosing an attack ran the declaration, the
 * opponent's blocks and the whole damage step inside one click, and the only
 * record a player had was the log and a changed life total. The kernel half of
 * the fix is `@mtg/kernel`'s `beats.ts` and its own test file holds the trace.
 * What is held here is what the person actually gets — a panel naming what just
 * happened, the board still drawn behind it, and one button that picks the game
 * up.
 *
 * The load-bearing test is "the panels arrive in the order a combat happens",
 * driven through the rendered surface rather than through the session underneath
 * it. Everything else checks a property it would not notice: that the Continue
 * button is not pretending to be a legal move, that the phase bar stopped
 * claiming the damage step is somewhere the game runs straight through, and that
 * a pause does not move the board to a seat nobody handed the device to.
 *
 * **The driver takes the boldest option offered, and that is not a detail.**
 * `play.test.ts` takes the first, which for a subset enumeration is "attack with
 * nothing", so that game is played by somebody who never attacks. This bug is
 * about attacking.
 *
 * Boldest rather than last since `mtg-y1t`. At an ordinary decision the two are
 * the same thing and the last button is still what is pressed. At the two combat
 * declarations there is no longer a button per declaration to be last —
 * `routes/play/declare.ts` replaced 2^n of them with a roster and a confirm —
 * so the same intent is spelled out: declare every creature, then confirm.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { exampleCard } from '@mtg/dsl';
import type { GameSession, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import {
  advance,
  choose,
  createSession,
  DEFAULT_AUTO_PASS,
  DEFAULT_BEATS,
  pendingDecision,
  reduceAll,
  scenario,
} from '@mtg/kernel';
import { PlayRoute } from '../../src/routes/PlayRoute';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { declarationWords } from '../../src/routes/play/declare';
import { NO_PASS_NOTE } from '../../src/routes/play/pass-key';
import { CONTINUE_LABEL, LEGAL_MOVES_LABEL, PlayView } from '../../src/routes/play/PlayView';
import { nodeName } from '../../src/routes/play/PhaseBar';
import type { SeatNames } from '../../src/routes/play/position';
import { beatPanel } from '../../src/routes/play/rail';
import type { PlayConfig } from '../../src/routes/play/use-session';

afterEach(cleanup);

const NAMES: SeatNames = ['You', 'Bot'];

/**
 * The document, which is where `pass-key.ts` binds and therefore where a press
 * that means "get on with it" has to be fired from.
 */
function documentBody(): Parameters<typeof fireEvent.keyDown>[0] {
  const host = globalThis as { readonly document?: { readonly body?: unknown } };
  const body = host.document?.body;
  if (typeof body !== 'object' || body === null) throw new Error('expected a jsdom document');
  return body as Parameters<typeof fireEvent.keyDown>[0];
}

/** The pause control, wherever on the surface it is drawn. */
function continueButton(): ReturnType<typeof screen.queryByRole> {
  return screen.queryByRole('button', { name: CONTINUE_LABEL });
}

function choiceButtons(): readonly ReturnType<typeof screen.getByRole>[] {
  const group = screen.queryByRole('group', { name: LEGAL_MOVES_LABEL });
  return group === null ? [] : within(group).queryAllByRole('button');
}

/** The roster of creatures a combat declaration is being assembled from, or null. */
function roster(): ReturnType<typeof screen.queryByRole> {
  for (const kind of ['declareAttackers', 'declareBlockers'] as const) {
    const found = screen.queryByRole('group', { name: declarationWords(kind).roster });
    if (found !== null) return found;
  }
  return null;
}

/**
 * The most aggressive move the rail is offering, pressed.
 *
 * At an ordinary decision that is the last button on the list. At a combat
 * declaration it is every creature declared and then confirmed, which is the
 * same intent one mechanism along: each row is pressed until nothing is idle,
 * answering a creature's follow-up question with its first answer when it has
 * one, and the confirm is the rail's first button (`declare-panel.ts` says why
 * it is first).
 */
function pressBoldestMove(): boolean {
  if (roster() === null) {
    const target = choiceButtons().at(-1);
    if (target === undefined) return false;
    fireEvent.click(target);
    return true;
  }
  for (let presses = 0; presses < 40; presses += 1) {
    const open = roster();
    if (open === null) break;
    const idle = within(open)
      .queryAllByRole('button')
      .filter((row) => attributeOf(row, 'data-declared') === 'false');
    const next = idle[0];
    if (next === undefined) break;
    fireEvent.click(next);
  }
  const confirm = choiceButtons()[0];
  if (confirm === undefined) return false;
  fireEvent.click(confirm);
  return true;
}

/** Reads an attribute off a node the workspace tsconfig gives no DOM types for. */
function attributeOf(node: unknown, name: string): string | null {
  return (node as { getAttribute(name: string): string | null }).getAttribute(name);
}

/** The names the three combat panels go by, in the order a combat produces them. */
const BEAT_TITLES = ['Attackers declared', 'Blockers declared', 'Combat damage'] as const;

/** Which of them the rail is showing, or null when it is showing something else. */
function pausedTitle(): string | null {
  for (const title of BEAT_TITLES) {
    if (screen.queryByText(title) !== null) return title;
  }
  return null;
}

function dealt(): ReturnType<typeof dealMirrorGame> {
  return dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
}

const OPTIONS = { autoPass: DEFAULT_AUTO_PASS, watchBeats: DEFAULT_BEATS };

/**
 * The same game, opened one click short of the person's first real attack.
 *
 * Every test below wants a combat and none of them wants the eleven turns of
 * land-dropping in front of it. Those turns are played here in the kernel, where
 * a decision costs microseconds, rather than through jsdom, where each one costs
 * a full re-render: driving to the first combat on screen ran to about two
 * seconds a test, which is close enough to vitest's five-second default to be a
 * flake on a loaded machine rather than a measurement.
 *
 * `choices` is the surface's own resume path (`use-session.ts`), so the game
 * that opens is the game that was played here, byte for byte, rather than a
 * position fabricated beside it.
 */
function upToTheAttack(config: PlayConfig, attacker: PlayerId = 0): PlayConfig {
  let session = createSession(config.setup, config.seats, OPTIONS);
  for (let guard = 0; guard < 600; guard += 1) {
    if (session.beat !== null) {
      session = advance(session, OPTIONS);
      continue;
    }
    const decision = session.pending;
    if (decision === null) break;
    // More than one option means at least one creature can attack; the bare
    // "attack with nothing" declaration is not a combat.
    if (decision.kind === 'declareAttackers' && decision.player === attacker && decision.options.length > 1) {
      return { ...config, choices: session.choices };
    }
    session = choose(session, decision.options.length - 1, OPTIONS);
  }
  throw new Error(`upToTheAttack: the dealt game never offered player ${String(attacker)} an attack`);
}

/**
 * Clicks an aggressive game to its first combat and reports the panels that
 * combat put on screen, leaving the surface standing on the last of them.
 *
 * Where it stops is the fiddly part and it is stated rather than counted: a
 * fixed number of pauses runs off the end of one combat into the next, and the
 * next one starts over at the attack, so a run of three can legitimately read
 * attack, damage, attack. A combat is therefore "pauses whose panel does not go
 * backwards", and the first one that does ends the collection.
 */
function playToFirstCombat(): readonly string[] {
  const titles: string[] = [];
  for (let clicks = 0; clicks < 600; clicks += 1) {
    const paused = continueButton();
    if (paused !== null) {
      const title = pausedTitle();
      if (title === null) throw new Error('the surface paused without naming what it paused for');
      const last = titles.at(-1);
      if (last !== undefined && rankOf(title) <= rankOf(last)) return titles;
      titles.push(title);
      fireEvent.click(paused);
      continue;
    }
    if (titles.length > 0) return titles;
    if (!pressBoldestMove()) return titles;
  }
  return titles;
}

function rankOf(title: string): number {
  return BEAT_TITLES.indexOf(title as (typeof BEAT_TITLES)[number]);
}

/** Clicks until the game pauses, leaving the surface standing on that pause. */
function playToFirstPause(): string {
  for (let clicks = 0; clicks < 600; clicks += 1) {
    if (continueButton() !== null) {
      const title = pausedTitle();
      if (title === null) throw new Error('the surface paused without naming what it paused for');
      return title;
    }
    if (!pressBoldestMove()) break;
  }
  throw new Error('playToFirstPause: the game finished without ever pausing on a combat');
}

describe('the combat panels', () => {
  it('arrive one press apart, in the order a combat happens', () => {
    render(h(PlayRoute, { config: upToTheAttack(dealt().config) }));

    const titles = playToFirstCombat();

    // Which panels one combat shows depends on the game the seed deals: a combat
    // nobody can block skips the middle one. What does not depend on it is that
    // the attack is shown, the damage is shown, and they are a press apart in a
    // combat's own order, which is the whole of what the bead asked for.
    expect(titles.length, 'the surface never paused, so the combat was invisible').toBeGreaterThan(1);
    expect(titles[0]).toBe('Attackers declared');
    expect(titles.at(-1)).toBe('Combat damage');
    expect(new Set(titles).size, 'one panel was shown twice in one combat').toBe(titles.length);
  });

  it('leave the board drawn behind them rather than covering it', () => {
    // The reason this is a rail panel and not a window over the table, in the
    // words `mtg-hmy` used when it refused a priority prompt as the instrument
    // for this bead: a modal "covers the board the player is trying to watch".
    render(h(PlayRoute, { config: upToTheAttack(dealt().config) }));
    expect(playToFirstPause()).toBe('Attackers declared');

    expect(continueButton()).not.toBeNull();
    expect(screen.getByLabelText('your battlefield')).toBeTruthy();
    expect(screen.getByLabelText("Bot's battlefield")).toBeTruthy();
  });
});

describe('the Continue button', () => {
  it('is chrome rather than a legal move, so it stays out of the enumeration', () => {
    render(h(PlayRoute, { config: upToTheAttack(dealt().config) }));
    playToFirstPause();

    // The kernel asked nothing at a pause, so a control inside the group naming
    // the legal moves would be claiming a move that does not exist.
    expect(continueButton()).not.toBeNull();
    expect(screen.queryByRole('group', { name: LEGAL_MOVES_LABEL })).toBeNull();
  });

  it('reports the press once, under a panel that names the position', () => {
    const state = pausedSession().state;
    const onContinue = vi.fn();
    render(h('div', null, beatPanel({ kind: 'attackers' }, state, NAMES, onContinue)));

    expect(screen.getByText('Attackers declared')).toBeTruthy();
    // The verb is the seat's, so this asks for either agreement rather than one
    // of them; `the beat's verb agrees with the seat it names` below is what
    // pins which.
    expect(screen.getByText(/(is|are) attacking with \d+ creature/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: CONTINUE_LABEL }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  /**
   * The key it did not have (`mtg-rgc.2`, handed over by this bead's own lane).
   *
   * `pass-key.ts` binds Space and Enter to the pass, and a pause has no pass in
   * it: the kernel asked nothing, so the shortcut would refuse every press and
   * print a note about a decision that is not on screen. A player who wanted to
   * see the combat and then get on with it had to tab to a button. It is the
   * same gesture at the same moment, so it is the same key — and binding a
   * second key would have asked a player to know which of two silences they were
   * looking at before pressing anything.
   */
  it('takes the pass key, because a pause has no pass to take', () => {
    const paused = pausedSession();
    const onContinue = vi.fn();
    render(
      h(PlayView, {
        session: paused,
        viewer: 0,
        names: NAMES,
        onChoose: vi.fn(),
        beat: paused.beat,
        onContinue,
      }),
    );
    expect(continueButton(), 'the surface is not standing on a pause').not.toBeNull();

    fireEvent.keyDown(documentBody(), { key: ' ' });
    expect(onContinue).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(documentBody(), { key: 'Enter' });
    expect(onContinue).toHaveBeenCalledTimes(2);
    // And it does not print the refusal, which would be the surface reporting a
    // decision the player has not been given.
    expect(screen.queryByText(NO_PASS_NOTE)).toBeNull();
  });
});

/**
 * `mtg-1ih`. The hot-seat launcher names the near seat `You`, that seat attacks
 * first in a sealed game, and so the first sentence a player ever read on this
 * panel was `You is attacking with 4 creatures.`
 *
 * The two cases are the whole rule, and the second is why a flag would not do:
 * on a hotseat table `deal.ts` names both seats outright, neither of them is
 * second person, and every sentence takes the third-person verb. `log/narrate.ts`
 * reached the same answer for the log and `seatVerb` is that one rule.
 */
describe('the beat sentence', () => {
  /**
   * The whole sentence, read off the node rather than matched against a pattern,
   * because the defect is a word in the middle of it and a regex that already
   * knows the word would be asserting itself.
   *
   * `textContent` is reached through a runtime check for the reason `nearSide`
   * below states: the workspace tsconfig carries no `lib: dom`, so the node
   * members are untyped here.
   */
  const attacking = (names: SeatNames): string => {
    render(h('div', null, beatPanel({ kind: 'attackers' }, pausedSession().state, names, vi.fn())));
    const node = screen.getByText(/attacking with/) as { readonly textContent?: unknown };
    if (typeof node.textContent !== 'string') throw new Error('the panel drew no sentence');
    return node.textContent;
  };

  it('agrees its verb with the seat it names', () => {
    expect(attacking(['You', 'Bot'])).toMatch(/^You are attacking with \d+ creatures?\.$/);
  });

  it('takes the third person when neither seat is the reader, as on a shared screen', () => {
    cleanup();
    expect(attacking(['the playtester', 'Wren'])).toMatch(
      /^the playtester is attacking with \d+ creatures?\.$/,
    );
  });

  /**
   * The blockers sentence counts, and it counted wrong for the commonest combat.
   *
   * One attacker read `Nothing blocked. All 1 attackers are through.`, seen on
   * screen in a sealed game of the flagship. The sentence one line above it had
   * already switched its noun on the same count, so this is the plural rule
   * reaching the branch it had skipped rather than a new rule.
   *
   * Read off the node whole, for the reason `attacking` above states: the defect
   * is a word in the middle of the sentence, and a pattern that already knows
   * the word asserts itself.
   */
  const blocking = (state: GameState): string => {
    render(h('div', null, beatPanel({ kind: 'blockers' }, state, NAMES, vi.fn())));
    const node = screen.getByText(/blocked|through/) as { readonly textContent?: unknown };
    if (typeof node.textContent !== 'string') throw new Error('the panel drew no sentence');
    return node.textContent;
  };

  it('says one attacker in the singular, and several in the plural', () => {
    cleanup();
    const lone = attackingBoard(1);
    expect(lone.combat.attacks.length).toBe(1);
    expect(blocking(lone)).toBe('Nothing blocked. The attacker is through.');

    cleanup();
    const several = attackingBoard(3);
    expect(several.combat.attacks.length).toBe(3);
    expect(blocking(several)).toBe('Nothing blocked. All 3 attackers are through.');
  });
});

/**
 * The death panel, which is the frame `mtg-302` was filed for.
 *
 * The complaint was a creature cast and a graveyard in the next frame the player
 * saw, with no picture of the removal in between. What the panel has to say is
 * therefore *which* permanent, and as whose — a sentence that said "a creature
 * was destroyed" would be the log, which was never the thing that was missing.
 *
 * The sentence is read off the node whole rather than matched loosely, for the
 * same reason `attacking` above states: the plural verb and the possessive are
 * words in the middle of it.
 */
describe('the death sentence', () => {
  const destroyed = (state: GameState, oids: readonly ObjectId[], names: SeatNames = NAMES): string => {
    render(h('div', null, beatPanel({ kind: 'death', oids }, state, names, vi.fn())));
    const node = screen.getByText(/destroyed/) as { readonly textContent?: unknown };
    if (typeof node.textContent !== 'string') throw new Error('the panel drew no sentence');
    return node.textContent;
  };

  /** One permanent each side of a stated board, which is what a possessive needs. */
  function twoSides(): { readonly state: GameState; readonly mine: ObjectId; readonly theirs: ObjectId } {
    const state = scenario({
      seed: 'test/play/beats/death',
      battlefield: [
        { card: exampleCard('slc-emberflow-raider'), controller: 0 as PlayerId },
        { card: exampleCard('slc-emberflow-raider'), controller: 1 as PlayerId },
      ],
      hands: [[], []],
    }).state;
    const [mine, theirs] = state.battlefield;
    if (mine === undefined || theirs === undefined) throw new Error('twoSides: the board is short');
    return { state, mine, theirs };
  }

  it("names the one that died as its controller's, and puts the verb in the singular", () => {
    const { state, mine } = twoSides();
    expect(destroyed(state, [mine])).toBe('Your Emberflow Raider was destroyed.');
  });

  it('says a trade as both halves, in the plural', () => {
    cleanup();
    const { state, mine, theirs } = twoSides();
    // Both sides, because a destroyed permanent is public and a frame that
    // showed only the reader's own losses would leave the other half of the
    // trade to be inferred from a board that no longer has it on.
    expect(destroyed(state, [mine, theirs])).toBe(
      "Your Emberflow Raider and Bot's Emberflow Raider were destroyed.",
    );
  });

  it('says no second person at a hotseat table, where neither seat is the reader', () => {
    cleanup();
    const { state, mine, theirs } = twoSides();
    expect(destroyed(state, [mine, theirs], ['the playtester', 'Wren'])).toBe(
      "the playtester's Emberflow Raider and Wren's Emberflow Raider were destroyed.",
    );
  });

  it('heads the panel with what happened rather than with a step it has none of', () => {
    cleanup();
    const { state, mine } = twoSides();
    render(h('div', null, beatPanel({ kind: 'death', oids: [mine] }, state, NAMES, vi.fn())));
    expect(screen.getByText('Destroyed')).toBeTruthy();
    expect(screen.getByRole('button', { name: CONTINUE_LABEL })).toBeTruthy();
  });
});

/**
 * The departure panel, which is `mtg-j7kj`: the bot exiled a creature and, from
 * the far side of the screen, "it looks like it just instantly disappeared".
 *
 * What the panel has to say is which permanent *and where it went*, and the
 * second half is the whole reason this is not the death sentence with a
 * different verb. An exile is gone, a bounce is back in a hand and castable
 * again next turn, and a tuck is somewhere in a library; a player told only
 * that the creature left the battlefield has been told the least useful third
 * of it.
 */
describe('the departure sentence', () => {
  const left = (
    state: GameState,
    departures: readonly { readonly oid: ObjectId; readonly to: 'exile' | 'hand' | 'library' }[],
    names: SeatNames = NAMES,
  ): string => {
    render(h('div', null, beatPanel({ kind: 'departure', departures }, state, names, vi.fn())));
    const node = screen.getByRole('status') as { readonly textContent?: unknown };
    if (typeof node.textContent !== 'string') throw new Error('the panel drew no sentence');
    return node.textContent;
  };

  /** One permanent each side of a stated board, which is what a possessive needs. */
  function twoSides(): { readonly state: GameState; readonly mine: ObjectId; readonly theirs: ObjectId } {
    const state = scenario({
      seed: 'test/play/beats/departure',
      battlefield: [
        { card: exampleCard('slc-emberflow-raider'), controller: 0 as PlayerId },
        { card: exampleCard('slc-emberflow-raider'), controller: 1 as PlayerId },
      ],
      hands: [[], []],
    }).state;
    const [mine, theirs] = state.battlefield;
    if (mine === undefined || theirs === undefined) throw new Error('twoSides: the board is short');
    return { state, mine, theirs };
  }

  it('says an exile is an exile, in the singular', () => {
    const { state, mine } = twoSides();
    expect(left(state, [{ oid: mine, to: 'exile' }])).toBe('Your Emberflow Raider was exiled.');
  });

  it('says a bounce says where the card went, because that is the difference', () => {
    cleanup();
    const { state, theirs } = twoSides();
    expect(left(state, [{ oid: theirs, to: 'hand' }])).toBe(
      "Bot's Emberflow Raider was returned to its owner's hand.",
    );
  });

  it('says a tuck the same way, one zone further off', () => {
    cleanup();
    const { state, mine } = twoSides();
    expect(left(state, [{ oid: mine, to: 'library' }])).toBe(
      "Your Emberflow Raider was put into its owner's library.",
    );
  });

  it('joins one zone into one plural sentence', () => {
    cleanup();
    const { state, mine, theirs } = twoSides();
    expect(
      left(state, [
        { oid: mine, to: 'exile' },
        { oid: theirs, to: 'exile' },
      ]),
    ).toBe("Your Emberflow Raider and Bot's Emberflow Raider were exiled.");
  });

  it('splits two zones into two sentences rather than picking one verb', () => {
    cleanup();
    const { state, mine, theirs } = twoSides();
    // The case a single list would have to be wrong about half of. Each half
    // opens its own sentence, so each takes the leading possessive.
    expect(
      left(state, [
        { oid: mine, to: 'exile' },
        { oid: theirs, to: 'hand' },
      ]),
    ).toBe("Your Emberflow Raider was exiled. Bot's Emberflow Raider was returned to its owner's hand.");
  });

  it('says no second person at a hotseat table, where neither seat is the reader', () => {
    cleanup();
    const { state, mine } = twoSides();
    expect(left(state, [{ oid: mine, to: 'exile' }], ['the playtester', 'Wren'])).toBe(
      "the playtester's Emberflow Raider was exiled.",
    );
  });

  it('heads the panel with the battlefield rather than with one of the zones', () => {
    cleanup();
    const { state, mine } = twoSides();
    render(
      h(
        'div',
        null,
        beatPanel({ kind: 'departure', departures: [{ oid: mine, to: 'exile' }] }, state, NAMES, vi.fn()),
      ),
    );
    // A heading naming the exile zone would be a lie the moment one batch
    // bounced something too, which the two-zone sentence above is the case for.
    expect(screen.getByText('Left the battlefield')).toBeTruthy();
    expect(screen.getByRole('button', { name: CONTINUE_LABEL })).toBeTruthy();
  });
});

/**
 * A state standing on a declaration of exactly `count` attackers.
 *
 * The combat is declared through the kernel rather than written down, which is
 * the half `pausedSession`'s docblock insists on: a hand-built empty combat
 * would let the sentence say "0 creatures" and pass. What is arranged is only
 * the board — the mirror deal never offers a second attacker at any turn of a
 * played game, and this sentence is about how many.
 *
 * The width asked for is the fixture's own: CR 508.1a lets each untapped
 * creature attack or not, independently, so `count` creatures span `2 ** count`
 * declarations. Asking at that width rather than at `DEFAULT_ENUMERATION_CAP`
 * is what keeps the all-in declaration in the list — past the cap the kernel
 * narrows to one creature at a time, and a stepwise question has no option
 * naming every attacker at once.
 */
function attackingBoard(count: number): GameState {
  const space = 2 ** count;
  const creature = exampleCard('slc-emberflow-raider');
  let state = scenario({
    seed: `test/play/beats/attack-${String(count)}`,
    battlefield: Array.from({ length: count }, () => ({
      card: creature,
      controller: 0 as PlayerId,
      summoningSick: false,
    })),
    hands: [[], []],
    active: 0,
    turn: 4,
  }).state;
  for (let guard = 0; guard < 60; guard += 1) {
    const decision = pendingDecision(state, space);
    if (decision === null) break;
    if (decision.kind === 'declareAttackers' && decision.player === 0) {
      const wanted = decision.options.find(
        (option) => option.type === 'declareAttackers' && option.attackers.length === count,
      );
      if (wanted === undefined) throw new Error(`attackingBoard: no declaration of ${String(count)}`);
      return reduceAll(state, [wanted]).state;
    }
    const last = decision.options.at(-1);
    if (last === undefined) throw new Error('attackingBoard: a decision with no options');
    state = reduceAll(state, [last]).state;
  }
  throw new Error(`attackingBoard: the board never reached a declaration of ${String(count)}`);
}

describe('the phase bar', () => {
  it('says the damage node pauses, which is the half of the bead filed against it', () => {
    // The bead's own words: the bar "marks DAMAGE with a hollow circle (no stop)
    // by default", which reads as "the game runs straight through here" while
    // the game was in fact resolving the whole combat there.
    expect(nodeName('combatDamage', 'none', DEFAULT_BEATS)).toContain('pauses to show combat');
    expect(nodeName('declareAttackers', 'theirTurn', DEFAULT_BEATS)).toContain('pauses to show combat');
    expect(nodeName('declareBlockers', 'theirTurn', DEFAULT_BEATS)).toContain('pauses to show combat');

    // The stop word still leads, and nothing outside combat gained a sentence.
    expect(nodeName('combatDamage', 'none', DEFAULT_BEATS).startsWith('Damage, no stop')).toBe(true);
    expect(nodeName('upkeep', 'none', DEFAULT_BEATS)).toBe('Upkeep, no stop');
    expect(nodeName('end', 'both', DEFAULT_BEATS)).not.toContain('pauses');
  });
});

/**
 * The lane the board draws nearest, which is the viewer's own seat.
 *
 * Reached through `querySelector` and checked at runtime, because the workspace
 * tsconfig carries no `lib: dom` and the node members are untyped here;
 * `play.test.ts` declares its own shape for the same reason.
 */
interface NodeLike {
  readonly querySelector: (selector: string) => unknown;
}

function nearSide(container: unknown): ReturnType<typeof screen.getByRole> {
  const root = container as Partial<NodeLike> | null;
  if (root === null || typeof root.querySelector !== 'function') {
    throw new Error('nearSide: expected a rendered container');
  }
  // The lane, named as a lane. `data-seat` is the board's word for which seat a
  // block belongs to and the seat pods carry it too (`mtg-rgc.1`), so a bare
  // attribute selector now finds the pod first and reads a block that holds no
  // hand at all.
  const found = root.querySelector('.mtg-board__side[data-seat="you"]');
  if (found === null || found === undefined) throw new Error('nearSide: the board drew no near lane');
  return found as ReturnType<typeof screen.getByRole>;
}

describe('two people at one screen', () => {
  it('keeps the board on the seat that was already holding it while the game is paused', () => {
    // The one way a pause could leak hidden information. Nobody owes a decision
    // at a beat, so a viewer taken from "whoever is being asked" has no answer,
    // and the obvious fallback — the configured seat — would put player one's
    // hand on a screen player two is holding, every time a beat paused a combat
    // player two was in. `use-session.ts` holds the viewer across the pause
    // instead, and this is the position that tells the two apart: seat 1 is the
    // one attacking, and seat 0 is what a fallback would show.
    const hotseat = dealMirrorGame(EXAMPLE_CARDS, { opponent: 'human' });
    const view = render(h(PlayRoute, { config: upToTheAttack(hotseat.config, 1) }));

    // Both hands are always drawn; which of them is the near one, face up, is
    // what the viewer decides, so that is what this reads.
    expect(within(nearSide(view.container)).getByLabelText("Player two's hand")).toBeTruthy();
    if (!pressBoldestMove()) throw new Error('the attack was never offered');

    expect(pausedTitle(), 'the attack did not pause').toBe('Attackers declared');
    expect(within(nearSide(view.container)).getByLabelText("Player two's hand")).toBeTruthy();
    expect(within(nearSide(view.container)).queryByLabelText("Player one's hand")).toBeNull();
  });
});

/**
 * A session standing on a real combat pause, played rather than fabricated.
 *
 * The panel reads the attacker count off `state.combat`, so a hand-built empty
 * combat would let the sentence say "0 creatures" and pass.
 */
function pausedSession(): GameSession {
  const config = upToTheAttack(dealt().config);
  // Replayed at full control, which is what `use-session.ts` does with the same
  // list and for the reason `replaySession` states: an auto-passed priority is
  // already in the recording, so spending it under auto-pass again would land
  // every later choice one question late.
  let session = createSession(config.setup, config.seats);
  for (const index of config.choices ?? []) session = choose(session, index);
  session = advance(session, OPTIONS);
  const decision = session.pending;
  if (decision === null) throw new Error('pausedSession: the attack was never offered');
  const paused = choose(session, decision.options.length - 1, OPTIONS);
  if (paused.beat?.kind !== 'attackers') throw new Error('pausedSession: the attack did not pause');
  return paused;
}
