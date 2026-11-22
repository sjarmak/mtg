// @vitest-environment jsdom
/**
 * The third yield: an optional trigger answered once and then left alone.
 *
 * `mtg-bz2.7` asks for three yield modes — through the turn, until a stop, and
 * per recurring trigger — and for each of them to stop at the next configured
 * stop rather than running past it. The first two were already here and already
 * proved: `../../src/routes/play/yields.ts` names the two boundaries, `@mtg/kernel`'s
 * `yieldPriority` runs the passes, and `packages/kernel/test/autopass.test.ts`
 * pins the stopping rule at its lines 969 and 982 while `./autopass.test.ts`
 * pins the two buttons that reach it. The third existed nowhere: nothing in
 * `TurnStops.ts`, `yields.ts` or `use-session.ts` mentioned a trigger, so a
 * player who answered the same upkeep trigger seven turns running answered it
 * seven times.
 *
 * `../../src/routes/play/trigger-yields.ts` is that arm, and this file is the
 * evidence it works from the outside — the buttons pressed, the prompt counted,
 * the life total read off the board.
 *
 * Measured on a deck of forty Dawn Heralds, one cast on turn one, under the
 * default stops: the first ask lands at turn 2, and the drive presses on for
 * sixteen moves after whatever is done about it.
 *
 * ```
 *                     asked again   upkeeps taken   reached
 * answered by hand    4             4               turn 6
 * "Always take"       0             4               turn 7
 * "Always decline"    0             0               turn 7
 * ```
 *
 * The first row is the control and the second is the claim: the same four
 * upkeeps taken, and four questions fewer. The third is what keeps the second
 * from being satisfied by a yield that had quietly broken the ability, since
 * that would read as silence too.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { botSeat, choose, createSession, DEFAULT_AUTO_PASS, humanSeat, simpleAgent } from '@mtg/kernel';
import type { GameSession } from '@mtg/kernel';
import { PlayRoute } from '../../src/routes/PlayRoute';
import { dealConstructedGame } from '../../src/routes/play/deal';
import { PASS_LABEL, TRIGGER_YIELD_LABEL, TRIGGER_YIELDS_LABEL } from '../../src/routes/play/PlayView';
import { clearTriggerYieldLabel, triggerYieldRowText } from '../../src/routes/play/TurnStops';
import {
  NO_TRIGGER_YIELDS,
  settleTriggerYields,
  triggerYieldFor,
  withTriggerYield,
} from '../../src/routes/play/trigger-yields';

/**
 * Budgeted at 20s rather than left to vitest's 5s default. Measured with this
 * file alone, MTG_TEST_WORKERS=1, three runs at host load 9.4 to 11.1 on 16
 * cores: the five slowest tests took 2.4 to 3.9s each, so 20s is about 5x the
 * worst run.
 *
 * The default was too tight under load: tests in this file went past 5s at
 * load 28.9, so the default decided which lane went red.
 *
 * File-scoped on purpose: the global `testTimeout` stays at the default and
 * nothing retries (`mtg-tqwbq`).
 */
vi.setConfig({ testTimeout: 20_000 });

afterEach(cleanup);

/**
 * A free 1/1 that offers a life point every upkeep, both players' included.
 *
 * Free so that one click puts it on the table with no land in the deck, and
 * `beginningOfEachPlayersUpkeep` so the trigger recurs on the turn after it
 * lands rather than two turns later. `optional: true` is the whole point: a
 * mandatory trigger is never a question, so there is nothing to settle.
 */
const HERALD: Card = parseCard({
  kind: 'creature',
  id: 'xmp-dawn-herald',
  name: 'Dawn Herald',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 70 },
  manaCost: {},
  colors: [],
  power: 1,
  toughness: 1,
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfEachPlayersUpkeep',
      optional: true,
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
    },
  ],
});

/** Forty of them, so the library never runs out inside a test. */
const DECK: readonly Card[] = Array.from({ length: 40 }, () => HERALD);

function opened(): ReturnType<typeof render> {
  cast = 0;
  const dealt = dealConstructedGame(DECK, {
    seed: 'ui/trigger-yield',
    youName: 'You',
    opponentName: 'Bot',
  });
  return render(h(PlayRoute, { config: dealt.config }));
}

/**
 * The two DOM reads this file needs, cast structurally.
 *
 * The workspace tsconfig has no `lib: dom` (see `mount.ts`), so neither
 * `textContent` nor `getAttribute` is typed on what testing-library hands back;
 * `autopass.test.ts` reaches both the same way.
 */
function textOf(node: unknown): string {
  return (node as { readonly textContent?: string | null }).textContent ?? '';
}

function attr(node: unknown, name: string): string | null {
  return (node as { getAttribute(name: string): string | null }).getAttribute(name);
}

/** The pair of controls that settle this ability's answer, or null everywhere else. */
function yieldGroup(): ReturnType<typeof screen.queryByRole> {
  return screen.queryByRole('group', { name: TRIGGER_YIELD_LABEL });
}

/**
 * Presses the first live button with this name, or says there was none.
 *
 * First rather than only: a hand of seven Heralds offers seven identical Cast
 * buttons, and which of the seven is pressed is not something a test about
 * triggers should have an opinion on.
 *
 * Live rather than present, because the fixed pass is drawn disabled rather
 * than dropped when the kernel enumerated no pass (`../../src/routes/play/pass.ts`
 * argues why: a control whose promise is that it stays put cannot leave). A
 * driver that counted a disabled press as a move stood on a declare-attackers
 * decision clicking Pass thirty times.
 */
function press(name: string | RegExp): boolean {
  const button = screen
    .queryAllByRole('button', { name })
    .find((node) => (node as { readonly disabled?: boolean }).disabled !== true);
  if (button === undefined) return false;
  fireEvent.click(button);
  return true;
}

/**
 * The viewer's life total, read off the near pod rather than the far one.
 *
 * Both seats draw the same `life total` title, and the pod they sit in is a
 * plain div with an `aria-label` rather than a landmark, so the seat is settled
 * by asking each total's own pod who it belongs to. The label is the seat
 * possessive as `position.ts` writes it, which is lower case.
 */
function lifeTotal(): number {
  const mine = screen
    .getAllByTitle('life total')
    .find(
      (node) =>
        attr((node as { readonly parentElement: unknown }).parentElement, 'aria-label') === 'your status',
    );
  if (mine === undefined) throw new Error('no life total for the near seat');
  return Number(textOf(mine));
}

/**
 * What the turn badge says, or null once the game is over and it is gone.
 *
 * Null rather than a throw because these games end: forty 1/1s against forty
 * 1/1s is a race, and a driver that pressed on until it ran out of presses used
 * to run out of turns first.
 */
function turnNumber(): number | null {
  const badge = screen.queryByRole('button', { name: /^Turn \d/ });
  if (badge === null) return null;
  const found = /^Turn (\d+)/.exec(textOf(badge));
  return found === null ? null : Number(found[1]);
}

/** How many Heralds this game has put on the table. Reset by `opened`. */
let cast = 0;

/**
 * One press of whatever moves the game, in the order a player would.
 *
 * Keep the hand, put one Herald on the table, then pass everything. Exactly one
 * cast: seven Heralds is seven triggers at one upkeep, and a test that could
 * not tell "asked again next turn" from "asked seven times this turn" would
 * pass for the wrong reason.
 */
function step(): boolean {
  if (press('Keep this hand')) return true;
  if (cast === 0 && press(/^Cast Dawn Herald/)) {
    cast += 1;
    return true;
  }
  // A combat pause is not a decision; it is the surface holding still to show
  // what happened. Nothing is being answered, so it comes before the pass.
  if (press('Continue')) return true;
  if (press(PASS_LABEL)) return true;
  const group = screen.queryByRole('group', { name: 'Legal moves' });
  const first =
    group === null
      ? undefined
      : within(group)
          .queryAllByRole('button')
          .find((button) => attr(button, 'data-kind') !== 'concede');
  if (first === undefined) return false;
  fireEvent.click(first);
  return true;
}

/** Plays on until the trigger is being asked about, or says it never was. */
function playToTrigger(limit = 40): boolean {
  for (let taken = 0; taken < limit; taken += 1) {
    if (yieldGroup() !== null) return true;
    if (!step()) return false;
  }
  return false;
}

interface Played {
  /** How many times the pair was on screen, which is how many times it asked. */
  readonly asked: number;
  /** The last turn the badge showed, which the end of a game takes away. */
  readonly lastTurn: number;
  /**
   * How many presses the viewer's life went up over.
   *
   * On this deck the trigger is the only thing that can raise it, so this is
   * the count of times the ability actually resolved. The end total cannot say
   * that: both seats are attacking with Heralds the whole time, so a game that
   * gained four life still ends below twenty.
   */
  readonly gains: number;
}

/** Plays on for a while, counting what the trigger did while it was not asking. */
function playOn(presses: number): Played {
  let asked = 0;
  let gains = 0;
  let lastTurn = turnNumber() ?? 0;
  let life = lifeTotal();
  for (let taken = 0; taken < presses; taken += 1) {
    if (yieldGroup() !== null) asked += 1;
    lastTurn = turnNumber() ?? lastTurn;
    if (!step()) break;
    const now = lifeTotal();
    if (now > life) gains += 1;
    life = now;
  }
  return { asked, gains, lastTurn };
}

/** Opens the auto-pass panel, which is where a settled answer is listed. */
function expandStops(): void {
  const head = screen.getByRole('button', { name: /^Turn \d/ });
  if (attr(head, 'aria-expanded') === 'false') fireEvent.click(head);
}

describe('the pair that settles an optional trigger', () => {
  it('is drawn at the trigger and nowhere before it', () => {
    opened();
    expect(yieldGroup(), 'the opening hand is not an optional trigger').toBeNull();
    expect(playToTrigger(), 'the Herald asks about its upkeep trigger').toBe(true);
    const group = yieldGroup();
    expect(group).not.toBeNull();
    const names = within(group as Parameters<typeof within>[0])
      .queryAllByRole('button')
      .map((node) => attr(node, 'aria-label') ?? textOf(node));
    // Both answers, each naming the ability, because the headline scrolls and
    // a speech user asking for "always decline" needs to know what of.
    expect(names).toEqual(['Always take Dawn Herald', 'Always decline Dawn Herald']);
  });

  it('is not one of the legal moves', () => {
    opened();
    expect(playToTrigger()).toBe(true);
    const moves = within(screen.getByRole('group', { name: 'Legal moves' })).queryAllByRole('button');
    expect(moves).toHaveLength(3);
    expect(screen.getByText('3 legal')).toBeTruthy();
  });

  it('answers the trigger it is pressed at', () => {
    opened();
    expect(playToTrigger()).toBe(true);
    const before = lifeTotal();
    expect(press('Always take Dawn Herald')).toBe(true);
    // The press is the answer as well as the setting, so the ability resolved
    // rather than waiting for a second click on a button that is now gone. The
    // gain is `at least one` and not `exactly one` because the settle carries
    // on through every trigger the game reaches before it next asks the player
    // something, and on this deck the next upkeep can arrive first.
    expect(yieldGroup()).toBeNull();
    expect(lifeTotal()).toBeGreaterThan(before);
  });
});

describe('a settled answer', () => {
  it('is what stops the asking, which otherwise recurs', () => {
    opened();
    expect(playToTrigger()).toBe(true);
    // Answered by hand instead of settled: the same ability asks again, and
    // again. This is the control the two tests under it are measured against —
    // without it, a yield that had broken the trigger outright would read as a
    // success.
    expect(press(/^Take the trigger/)).toBe(true);
    expect(playOn(16).asked).toBeGreaterThanOrEqual(2);
  });

  it('takes the ability every upkeep without asking again', () => {
    opened();
    expect(playToTrigger()).toBe(true);
    const openingTurn = turnNumber() ?? 0;
    const before = lifeTotal();
    expect(press('Always take Dawn Herald')).toBe(true);
    expect(lifeTotal(), 'the press took the one it was pressed at').toBeGreaterThan(before);

    const played = playOn(16);
    expect(played.asked, 'the ability is never asked about again').toBe(0);
    expect(played.lastTurn, 'the game moved past several more upkeeps').toBeGreaterThan(openingTurn + 1);
    // Every upkeep since has taken it, which is the whole claim: a yield that
    // quietly stopped resolving the ability would also stop asking, and would
    // pass the two lines above on its own.
    expect(played.gains, 'and took it at each of them').toBeGreaterThanOrEqual(2);
  });

  it('declines it every upkeep without asking again', () => {
    opened();
    expect(playToTrigger()).toBe(true);
    const openingTurn = turnNumber() ?? 0;
    const before = lifeTotal();
    expect(press('Always decline Dawn Herald')).toBe(true);
    expect(lifeTotal(), 'the press declined the one it was pressed at').toBe(before);

    const played = playOn(16);
    expect(played.asked).toBe(0);
    expect(played.lastTurn).toBeGreaterThan(openingTurn + 1);
    // Nothing else on this board gains life, so declining every upkeep is a
    // life total that only ever falls.
    expect(played.gains, 'and declined it at each of them').toBe(0);
  });
});

describe('the way back out', () => {
  it('lists the settled answer on the auto-pass panel', () => {
    opened();
    expect(playToTrigger()).toBe(true);
    expandStops();
    expect(screen.queryByRole('list', { name: TRIGGER_YIELDS_LABEL }), 'nothing settled yet').toBeNull();
    expandStops();

    expect(press('Always decline Dawn Herald')).toBe(true);
    expandStops();
    const list = screen.getByRole('list', { name: TRIGGER_YIELDS_LABEL });
    expect(textOf(list)).toContain(
      triggerYieldRowText({ key: 'xmp-dawn-herald#0', accept: false, label: 'Dawn Herald' }),
    );
    expect(
      screen.getByRole('button', {
        name: clearTriggerYieldLabel({ key: 'xmp-dawn-herald#0', accept: false, label: 'Dawn Herald' }),
      }),
    ).toBeTruthy();
  });

  it('asks again once the answer is cleared', () => {
    opened();
    expect(playToTrigger()).toBe(true);
    expect(press('Always decline Dawn Herald')).toBe(true);
    expect(playOn(12).asked, 'settled, so nothing asks').toBe(0);

    expandStops();
    expect(
      press(clearTriggerYieldLabel({ key: 'xmp-dawn-herald#0', accept: false, label: 'Dawn Herald' })),
    ).toBe(true);
    expect(screen.queryByRole('list', { name: TRIGGER_YIELDS_LABEL }), 'the last row went').toBeNull();
    expandStops();

    // Clearing does not re-open a question about an ability that is not on the
    // stack, so the proof is the next upkeep rather than this render.
    expect(playToTrigger(), 'the next upkeep asks again').toBe(true);
  });
});

describe('taking it back', () => {
  it('asks about the ability again, and keeps the answer for next time', () => {
    opened();
    // Full control, so the game holds still while the trigger is on the stack
    // and the answer is still the last thing that happened. Under the default
    // stops there is nowhere to press take-back from that is still above the
    // trigger: `@mtg/kernel`'s `undo.ts` closes a boundary on every
    // `priorityPassed`, and resolving a trigger takes two of them, so by the
    // time the game next stops the answer is committed and undo refuses to
    // cross it. That is a fact about where this can be measured, not a second
    // rule — every stop setting reaches the same code.
    expandStops();
    expect(press('Full control')).toBe(true);

    // The first ask lands on the opponent's upkeep, and they hold priority
    // first, so their pass would close the boundary before this seat could
    // press anything. Answer that one by hand and settle the next, which is
    // this seat's own upkeep.
    expect(playToTrigger(120)).toBe(true);
    expect(press(/^Take the trigger/)).toBe(true);
    expect(playToTrigger(120)).toBe(true);
    const before = lifeTotal();
    expect(press('Always take Dawn Herald')).toBe(true);
    expect(lifeTotal(), 'settled, and taken at least once').toBeGreaterThan(before);
    expect(yieldGroup(), 'and not asking any more').toBeNull();

    // `use-session.ts` passes no yields down the undo path on purpose: undo
    // re-advances the position under the same options, so re-answering here
    // would make the one control a player reaches for after a mistake the one
    // control that hands them nothing back.
    expect(press('Take back')).toBe(true);
    expect(yieldGroup(), 'the question is on screen again').not.toBeNull();

    // The setting is not what was taken back. It is still listed, and it still
    // covers every occurrence after this one.
    expandStops();
    expect(textOf(screen.getByRole('list', { name: TRIGGER_YIELDS_LABEL }))).toContain(
      'Always take Dawn Herald',
    );
  });
});

describe('a yielded answer is the choice it is', () => {
  /** The same game the render drives, without the clicking. */
  function dealtSession(): GameSession {
    const deck = { name: 'Heralds', cards: DECK };
    return createSession({ seed: 'ui/trigger-yield', decks: [deck, deck] }, [
      humanSeat('You'),
      botSeat(simpleAgent('Bot')),
    ]);
  }

  it('is recorded, so the game replays without the setting', () => {
    const options = { autoPass: DEFAULT_AUTO_PASS };
    let session = dealtSession();
    let cast = 0;
    for (let taken = 0; taken < 40 && session.pending?.kind !== 'optionalTrigger'; taken += 1) {
      const decision = session.pending;
      if (decision === null) break;
      const castAt = decision.options.findIndex((action) => action.type === 'castSpell');
      const passAt = decision.options.findIndex((action) => action.type === 'passPriority');
      const pick = cast === 0 && castAt >= 0 ? castAt : passAt >= 0 ? passAt : 0;
      if (pick === castAt && castAt >= 0) cast += 1;
      session = choose(session, pick, options);
    }
    const decision = session.pending;
    expect(decision?.kind).toBe('optionalTrigger');
    if (decision === null || decision.kind !== 'optionalTrigger') throw new Error('no trigger');

    const settled = triggerYieldFor(session.state, decision, true);
    expect(settled).toEqual({ key: 'xmp-dawn-herald#0', accept: true, label: 'Dawn Herald' });
    if (settled === null) throw new Error('no key');

    const before = session.choices.length;
    const settledSession = settleTriggerYields(
      session,
      options,
      withTriggerYield(NO_TRIGGER_YIELDS, settled),
    );
    // The kernel's own action, appended to the recording. Nothing was skipped
    // and no state was written behind the log, which is what makes a recording
    // made under a yield replayable by somebody who has never set one.
    expect(settledSession.choices.length).toBeGreaterThan(before);
    expect(settledSession.choices).toContainEqual({
      type: 'answerOptionalTrigger',
      player: decision.player,
      oid: decision.oid,
      accept: true,
    });
  });

  it('settles nothing when no answer covers the ability', () => {
    const options = { autoPass: DEFAULT_AUTO_PASS };
    const session = dealtSession();
    expect(settleTriggerYields(session, options, NO_TRIGGER_YIELDS)).toBe(session);
  });
});
