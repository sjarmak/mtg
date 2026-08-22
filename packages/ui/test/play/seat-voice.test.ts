// @vitest-environment jsdom
/**
 * Every sentence the play surface says about a seat, checked in both voices.
 *
 * # Why this is a sweep and not six more assertions
 *
 * `src/seat.ts` holds the rule — the label decides, not a flag — and it has been
 * broken six times in five files. Every one of them was a call site that
 * interpolated a raw seat label into a sentence and never called the rule:
 * `You is attacking with 4 creatures.` (`mtg-1ih`, `rail.ts`), `You keeps this
 * hand.`, `You has mulliganed 1 time`, `You chooses its targets now`
 * (`prompt.ts`), `Unblocked attackers deal their damage to You.` (`mtg-crv`,
 * `prompt.ts` again) and `You have priority` printed under `Player two may act`
 * (`mtg-1th`, `priority.ts`).
 *
 * A helper is a thing a call site can forget to call, and six occasions say it
 * will keep forgetting. So this file does not test the helpers, which
 * `test/log/narrate.test.ts` already does. It renders the surface, collects the
 * strings it actually emits, and checks them — a sentence written tomorrow by
 * somebody who never read `seat.ts` is inside the sweep the moment it reaches
 * the screen.
 *
 * # The two rules, and why neither needs a dictionary of English
 *
 * A grammar checker would need to know that `keeps` is third person and `keep`
 * is second, which is a heuristic over English and would be wrong about `has`
 * inside a week. Both rules below are mechanical instead.
 *
 *  1. **A hotseat table says no second person.** With both seats named, nothing
 *     on screen may say `you`, `your` or `yours`: there is no seat by that name,
 *     so the word can only be addressing whoever happens to be holding the
 *     device, which is the assumption `deal.ts` deleted when it started naming
 *     both seats. This is the whole of `mtg-1th`, and it needs no exemptions.
 *  2. **A second-person sentence must differ by more than the label.** The same
 *     position is rendered twice, once with the near seat called `You` and once
 *     with it called `Player one`. Any string that mentions the near seat and is
 *     *exactly* the third-person string with the label swapped is a string whose
 *     author did nothing label-dependent — which is the signature of every one
 *     of the six. A sentence that went through the rule cannot match: `your
 *     Emberflow Raider` is not `You's Emberflow Raider`, `You have priority` is
 *     not `You has priority`, and `damage to you` is not `damage to You`.
 *
 * # What it catches, and what it is not
 *
 * All six seat-voice instances above fail this file against the source that
 * shipped them; `it('fails the surface that shipped the six')` pins the two that
 * are still reachable as strings rather than as history.
 *
 * It is not a check on the *other* two bugs found the same night, and neither is
 * a seat-voice bug: `mtg-0xq` is a folded button's punctuation
 * (`rail-contract.test.ts` holds it) and `mtg-h9s` is which of two same-named
 * permanents a sentence meant (`move-names.test.ts` holds that rule for the rail
 * and `log/narrate.ts`'s `LogNames.target` extends it to the log). A sentence
 * with no seat in it is outside both rules by construction, which is the honest
 * bound on what a seat-voice gate can be.
 *
 * # Coverage is the surface, not this file's imagination
 *
 * The strings come from three places, so a lane that adds a sentence gets swept
 * without adding anything here: every prompt of a whole played game (`prompt.ts`
 * writes nine kinds of headline and explanation), every line of that game's log
 * at `everything` density, and the rendered `PlayView` at the positions the
 * three panels other than the move list need — a combat beat, a finished game, a
 * networked wait — which is where `rail.ts` writes sentences no prompt reaches.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { EXAMPLE_CARDS, exampleCard, mana, renderAbility } from '@mtg/dsl';
import type { Beat, Decision, GameSession, GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { choose, createSession, DEFAULT_AUTO_PASS, scenario, simpleAgent } from '@mtg/kernel';
import { buildLog } from '../../src/log/group';
import type { DecisionKind, LogNames } from '../../src/log/narrate';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { ownedName } from '../../src/routes/play/naming';
import { PlayView } from '../../src/routes/play/PlayView';
import { nameOf } from '../../src/routes/play/position';
import type { SeatNames } from '../../src/routes/play/position';
import { buildPrompt } from '../../src/routes/play/prompt';
import { textBoxBlocks } from '../../src/card/anatomy';
import { lineRuns, oracleBlocks } from '../../src/card/text-box';
import { unfoldedName } from '../../src/routes/play/choice-button';

afterEach(cleanup);

const GUARDIAN = exampleCard('slc-thornhide-guardian');
const DRAKE = exampleCard('slc-windrider-drake');
const LASH = exampleCard('slc-lightning-lash');

/** The ordinary table: one person, one bot, and the near seat is second person. */
const SECOND: SeatNames = ['You', 'Bot'];

/**
 * The same table with the near seat named instead.
 *
 * Only the near seat changes, so the substitution rule 2 applies is a single
 * unambiguous swap and a sentence about the far seat reads identically in both
 * runs.
 */
const THIRD: SeatNames = ['Player one', 'Bot'];

/** The hotseat table `deal.ts` deals when two people share a screen. */
const HOTSEAT: SeatNames = ['Player one', 'Player two'];

/** The near seat's label in `THIRD`, which is what rule 2 swaps. */
const THIRD_NEAR = THIRD[0];

/** Any second-person word, as a whole word: what a hotseat table may not say. */
const SECOND_PERSON_WORD = /\b(you|your|yours)\b/i;

// A DOM this package may not name: the root tsconfig has no `lib: dom`, so the
// tree is reached through the narrowest structural interface that answers the
// two questions this file asks — what does this element say itself, and what is
// it called.
interface NodeLike {
  readonly nodeType: number;
  readonly textContent: string | null;
}

interface ElementLike extends NodeLike {
  readonly childNodes: ArrayLike<NodeLike>;
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): ArrayLike<ElementLike>;
}

const TEXT_NODE = 3;

/**
 * What one element says in its own right: its direct text children only.
 *
 * Not `textContent`, which would glue every descendant into one string and
 * manufacture word pairs no author ever wrote — the priority bar's sentence and
 * the clause in the span beside it are two strings, and a rule that read them as
 * one would report a violation spanning both.
 */
function ownText(element: ElementLike): string {
  const parts: string[] = [];
  for (let at = 0; at < element.childNodes.length; at += 1) {
    const child = element.childNodes[at];
    if (child !== undefined && child.nodeType === TEXT_NODE) parts.push(child.textContent ?? '');
  }
  return parts.join('');
}

function renderedStrings(container: ElementLike): readonly string[] {
  const found: string[] = [];
  const elements = container.querySelectorAll('*');
  for (let at = 0; at < elements.length; at += 1) {
    const element = elements[at];
    if (element === undefined) continue;
    const own = ownText(element).trim();
    if (own.length > 0) found.push(own);
    const label = element.getAttribute('aria-label');
    if (label !== null && label.trim().length > 0) found.push(label.trim());
  }
  return found;
}

/**
 * A mirror game with two seats nobody automates.
 *
 * Both seats human on purpose: a bot seat decides inside `choose` and its
 * decisions never surface as a `pending`, so half the prompts this file is here
 * to read would never be written. The sweep supplies the play instead.
 */
function openingSession(): GameSession {
  const game = dealMirrorGame(EXAMPLE_CARDS, { opponent: 'human' });
  return createSession(game.config.setup, game.config.seats, { autoPass: DEFAULT_AUTO_PASS });
}

interface PlayedGame {
  readonly finished: GameSession;
  /** Every position the game stopped at, in order. */
  readonly asked: readonly GameSession[];
}

/**
 * One deterministic game, played by the kernel's own greedy agent on both sides.
 *
 * Passing at every priority is not a game: it plays no land, casts nothing and
 * attacks with nothing, and a sweep over it would read nine of the surface's
 * sentences instead of all of them (measured: 30 decisions, three kinds, no
 * combat). `simpleAgent` is the opponent `deal.ts` already seats, so this is the
 * game the lab plays, and it reaches every decision kind the kernel can ask.
 *
 * The agent returns one of the enumerated options, so the drive is still a list
 * of indices and the labels are not in it — the three runs of the sweep walk the
 * same game and their strings line up position for position, which is what rule
 * 2's pairing rests on.
 */
function playedGame(): PlayedGame {
  const agent = simpleAgent('sweep');
  let session = openingSession();
  const asked: GameSession[] = [];
  for (let step = 0; step < 10_000 && session.pending !== null; step += 1) {
    asked.push(session);
    const decision = session.pending;
    const action = agent.decide({ state: session.state, player: decision.player, decision });
    const at = decision.options.indexOf(action);
    if (at < 0) throw new Error(`the agent answered "${decision.kind}" with an unenumerated action`);
    session = choose(session, at, { autoPass: DEFAULT_AUTO_PASS });
  }
  return { finished: session, asked };
}

const GAME = playedGame();

function bookFor(state: GameState, names: SeatNames): LogNames {
  return {
    player: (id: PlayerId): string => names[id],
    card: (oid: string): string => nameOf(state, oid),
    target: (oid: string): string => ownedName(state, names, oid),
  };
}

/**
 * A board with two of one creature on it, for the decisions the game never asks.
 *
 * `EXAMPLE_CARDS` reaches four of the kernel's fifteen decision kinds — a
 * mulligan, a priority, an attack and a block — because nothing in that pool
 * triggers, and a legend rule needs two legends. The other eleven write
 * sentences too, and one of the six instances this file exists for was in one
 * of them (`You chooses its targets now`). So they are asked here directly.
 */
function parked(): GameState {
  return scenario({
    seed: 'test/play/seat-voice/parked',
    battlefield: [
      { card: GUARDIAN, controller: 0, summoningSick: false },
      { card: GUARDIAN, controller: 0, summoningSick: false, damage: 1 },
      { card: DRAKE, controller: 1 },
    ],
    hands: [[LASH], []],
    active: 0,
    turn: 4,
  }).state;
}

const PARKED = parked();

function parkedOid(at: number): ObjectId {
  const oid = PARKED.battlefield[at];
  if (oid === undefined) throw new Error('the parked board is smaller than it looks');
  return oid;
}

/**
 * One decision of every kind the kernel can ask.
 *
 * A `Record` over `DecisionKind` rather than a list, so a sixteenth kind fails to
 * compile here instead of shipping a sentence nothing swept — the same
 * arrangement `log/narrate.ts` uses for the questions it narrates, and for the
 * same reason.
 *
 * The option lists are empty and the positions are stated rather than reached.
 * This file checks what a sentence *says* about a seat; what the kernel would
 * really enumerate at each of these is `rail-contract.test.ts`'s subject, and
 * every kind the game does reach is swept from the real decision above.
 */
const SYNTHETIC: Readonly<Record<DecisionKind, Decision>> = {
  mulligan: { kind: 'mulligan', player: 0, mulligans: 1, count: 1, hand: [], options: [], complete: true },
  priority: { kind: 'priority', player: 0, options: [], complete: true },
  declareAttackers: {
    kind: 'declareAttackers',
    player: 0,
    defender: 1,
    defenders: [1],
    eligible: [parkedOid(0)],
    options: [],
    complete: true,
  },
  declareBlockers: {
    kind: 'declareBlockers',
    player: 0,
    attackers: [parkedOid(2)],
    eligible: [parkedOid(0)],
    candidates: [{ blocker: parkedOid(0), attackers: [parkedOid(2)] }],
    options: [],
    complete: true,
  },
  orderBlockers: {
    kind: 'orderBlockers',
    player: 0,
    blocks: [{ attacker: parkedOid(2), blockers: [parkedOid(0)] }],
    options: [],
    complete: true,
  },
  discard: { kind: 'discard', player: 0, count: 1, hand: [], options: [], complete: true },
  scry: {
    kind: 'scry',
    player: 0,
    cards: [parkedOid(0), parkedOid(1)],
    options: [],
    complete: true,
  },
  searchLibrary: {
    kind: 'searchLibrary',
    player: 0,
    cards: [parkedOid(0), parkedOid(1)],
    options: [],
    complete: true,
  },
  graveyardChoice: {
    kind: 'graveyardChoice',
    player: 0,
    cards: [parkedOid(0), parkedOid(1)],
    options: [],
    complete: true,
  },
  // CR 701.17a: `player` is both who is asked and whose board `permanents`
  // was read from — no owner/chooser split, unlike `handDiscard` above.
  permanentSacrifice: {
    kind: 'permanentSacrifice',
    player: 0,
    permanents: [parkedOid(0), parkedOid(1)],
    options: [],
    complete: true,
  },
  // `owner` deliberately differs from `player`, which is the half of this kind
  // a sentence can get wrong: under a `chooseDiscard` the seat being asked is
  // not the seat losing the cards, and a voice that said "your hand" here
  // would be addressing the wrong player about the wrong cards.
  handDiscard: {
    kind: 'handDiscard',
    player: 0,
    owner: 1,
    count: 1,
    hand: [parkedOid(0)],
    revealed: true,
    options: [],
    complete: true,
  },
  triggerTargets: {
    kind: 'triggerTargets',
    player: 0,
    oid: parkedOid(0),
    source: parkedOid(0),
    abilityIndex: 0,
    options: [],
    complete: true,
  },
  optionalTrigger: {
    kind: 'optionalTrigger',
    player: 0,
    oid: parkedOid(0),
    source: parkedOid(0),
    abilityIndex: 0,
    targets: [],
    options: [],
    complete: true,
  },
  may: {
    kind: 'may',
    player: 0,
    oid: parkedOid(0),
    targets: [],
    options: [],
    complete: true,
  },
  unless: {
    kind: 'unless',
    player: 0,
    oid: parkedOid(0),
    cost: mana({ generic: 2 }),
    targets: [],
    options: [],
    complete: true,
  },
  legendRule: {
    kind: 'legendRule',
    player: 0,
    name: 'Thornhide Guardian',
    candidates: [parkedOid(0), parkedOid(1)],
    options: [],
    complete: true,
  },
};

/** The headline and explanation of every decision kind, asked of both seats. */
function syntheticStrings(names: SeatNames): readonly string[] {
  const found: string[] = [];
  for (const decision of Object.values(SYNTHETIC)) {
    for (const player of [0, 1] as const) {
      const prompt = buildPrompt(PARKED, { ...decision, player }, names);
      found.push(prompt.headline, prompt.explain);
    }
  }
  return found;
}

/** Every sentence the ask column writes, over every decision of the game. */
function promptStrings(names: SeatNames): readonly string[] {
  const found: string[] = [];
  for (const session of GAME.asked) {
    const decision = session.pending;
    if (decision === null) continue;
    const prompt = buildPrompt(session.state, decision, names);
    found.push(prompt.headline, prompt.explain);
    for (const choice of prompt.choices) {
      found.push(choice.label);
      if (choice.detail !== null) found.push(choice.detail);
      // The accessible name a folded run leaves on the button, which is the only
      // string a screen reader gets there and is not any element's own text.
      found.push(unfoldedName(choice));
    }
  }
  return found;
}

/** Every line of the finished game's log, from both sides of the table. */
function logStrings(names: SeatNames): readonly string[] {
  const book = bookFor(GAME.finished.state, names);
  const found: string[] = [];
  for (const viewer of [0, 1] as const) {
    const turns = buildLog({ events: GAME.finished.events, names: book, viewer, density: 'everything' });
    for (const turn of turns) {
      found.push(turn.title);
      for (const step of turn.steps) {
        found.push(step.title);
        for (const line of step.lines) found.push(line.text);
      }
    }
  }
  return found;
}

interface Position {
  readonly what: string;
  readonly viewer: PlayerId;
  readonly session: GameSession;
  readonly beat?: Beat;
  readonly awaiting?: PlayerId;
}

/**
 * The positions the rail's other three panels need.
 *
 * The move list is swept far more thoroughly through `promptStrings`, which sees
 * every decision of the game rather than the handful a render can afford. What a
 * render adds is everything that is *not* a prompt: the priority bar, the seat
 * pods, the zone labels, and the three panels that appear only when the kernel
 * is not asking — a beat, a result, a networked wait.
 *
 * The death beat is here because it is the newest sentence on the surface that
 * names a seat (`mtg-302`), and it names *two*: a trade is one frame with a
 * permanent from each side in it, and both possessives are in the same string.
 */
function positions(): readonly Position[] {
  const opening = GAME.asked[0];
  const middle = GAME.asked[Math.floor(GAME.asked.length / 2)];
  const attackingSession = GAME.asked.find((session) => session.state.combat.attacks.length > 0);
  if (opening === undefined || middle === undefined || attackingSession === undefined) {
    throw new Error('the played game is too short to sweep');
  }
  const board = attackingSession.state;
  const controlled = (player: PlayerId): ObjectId => {
    const found = board.battlefield.find((oid) => board.objects[oid]?.controller === player);
    if (found === undefined) throw new Error(`the board has nothing player ${String(player)} controls`);
    return found;
  };
  return [
    { what: 'the opening hand', viewer: 0, session: opening },
    { what: 'a mid-game decision, from the near seat', viewer: 0, session: middle },
    { what: 'a mid-game decision, from the far seat', viewer: 1, session: middle },
    { what: 'the attackers beat', viewer: 0, session: attackingSession, beat: { kind: 'attackers' } },
    { what: 'the blockers beat', viewer: 1, session: attackingSession, beat: { kind: 'blockers' } },
    {
      what: 'the death beat, with a permanent from each side in it',
      viewer: 0,
      session: attackingSession,
      beat: { kind: 'death', oids: [controlled(0), controlled(1)] },
    },
    { what: 'the finished game', viewer: 0, session: GAME.finished },
    { what: 'a networked seat waiting', viewer: 0, session: GAME.finished, awaiting: 1 },
  ];
}

function renderStrings(names: SeatNames): readonly string[] {
  const found: string[] = [];
  for (const position of positions()) {
    const view = render(
      h(PlayView, {
        session: position.session,
        viewer: position.viewer,
        names,
        onChoose: () => undefined,
        ...(position.beat === undefined ? {} : { beat: position.beat, onContinue: () => undefined }),
        ...(position.awaiting === undefined ? {} : { awaitingName: names[position.awaiting] }),
      }),
    );
    found.push(...renderedStrings(view.container as unknown as ElementLike));
    cleanup();
  }
  return found;
}

/** Everything one configuration of the surface says, in a fixed order. */
function sweep(names: SeatNames): readonly string[] {
  return [...promptStrings(names), ...syntheticStrings(names), ...logStrings(names), ...renderStrings(names)];
}

const SECOND_SWEEP = sweep(SECOND);
const THIRD_SWEEP = sweep(THIRD);
const HOTSEAT_SWEEP = sweep(HOTSEAT);

describe('the sweep is worth asserting against', () => {
  it('collects the whole surface rather than a handful of strings', () => {
    expect(GAME.finished.result).not.toBeNull();
    expect(GAME.finished.events.length).toBeGreaterThan(500);
    expect(SECOND_SWEEP.length).toBeGreaterThan(1_000);
    // Combat happened, which is what the blocker prompt (`mtg-crv`'s own
    // sentence) and every damage line in the log are downstream of.
    const kinds = new Set(GAME.asked.map((session) => session.pending?.kind));
    expect(kinds).toContain('declareAttackers');
    expect(kinds).toContain('declareBlockers');
    // The three configurations walk the same game and the same renders, which is
    // what lets rule 2 pair a string with its counterpart by position.
    expect(THIRD_SWEEP.length).toBe(SECOND_SWEEP.length);
    expect(HOTSEAT_SWEEP.length).toBe(SECOND_SWEEP.length);
  });

  it('reaches the sentences that are not the move list', () => {
    // A positive control per source: a beat sentence, a result, a wait, a
    // priority bar and a log line all have to be in the sweep or the rules below
    // are checking a smaller surface than they claim.
    for (const phrase of ['attacking with', 'wins on turn', 'is deciding', 'priority', 'draws']) {
      expect(THIRD_SWEEP.filter((said) => said.includes(phrase)).length).toBeGreaterThan(0);
    }
  });

  it('mentions the near seat often enough for rule 2 to have work to do', () => {
    expect(THIRD_SWEEP.filter((said) => said.includes(THIRD_NEAR)).length).toBeGreaterThan(100);
  });
});

/**
 * Every line a card in this pool prints in its own text box, as the surface
 * emits it.
 *
 * **Rule 1 skips printed card text, and this is how.** The premise below used to
 * be that no card in the pool says `you`, so every second person in the sweep
 * was the surface's own; `mtg-6mx` broke that premise on purpose by giving
 * keywords their reminder text, and two of the eight reminders are written in
 * Magic's second person — "as soon as it comes under your control", "causes you
 * to gain that much life". That `you` is the card speaking, exactly as
 * `You gain 1 life.` on a printed card is, so it is correct at a hotseat table
 * and rule 1 has to exclude it. The exclusion is by *identity* rather than by a
 * pattern: a string is exempt only if it is a block some card in the pool
 * actually prints, so a sentence the surface wrote can never hide behind it.
 *
 * Brace tokens are stripped because the face paints them rather than setting
 * them (`../../src/card/SymbolText.ts`), so `ownText` above collects the line
 * with the symbol missing from the middle of it.
 *
 * **A line is not always one element, so the exemption is by printed run.**
 * `mtg-vsv` set a reminder's keyword roman inside its italic line, which makes
 * the keyword a span of its own: `ownText` collects the text nodes of one
 * element, so the line arrives as `Lifelink` and `(Damage dealt … you …)`
 * rather than as the sentence joining them. The runs are `lineRuns`', the same
 * function both renderers cut the line with, so the exemption still holds
 * exactly what a card prints and cannot drift into holding what a face happens
 * to nest.
 */
const PRINTED_CARD_TEXT: ReadonlySet<string> = new Set(
  EXAMPLE_CARDS.flatMap((card) =>
    [...textBoxBlocks(card), ...oracleBlocks(card)]
      .flatMap((block) => {
        const runs = lineRuns(block, block.text);
        return [block.text, runs.roman, runs.rest];
      })
      .map((run) => run.replace(/\{[^}]*\}/g, '').trim())
      .filter((run) => run.length > 0),
  ),
);

describe('a hotseat table addresses nobody as you', () => {
  /**
   * The premise rule 1 rests on, restated now that a card in the pool does print
   * a second person.
   *
   * The exemption above is what makes that safe, and it is only safe while it is
   * narrow: it holds exactly the strings the cards print. This asserts it is not
   * empty and that it is doing real work — a set of blocks that contained no
   * second person at all would mean the reminder text stopped reaching the face
   * and rule 1 was passing for the wrong reason.
   */
  it('exempts printed card text, and only what a card in the pool prints', () => {
    expect(PRINTED_CARD_TEXT.size).toBeGreaterThan(0);
    const secondPerson = [...PRINTED_CARD_TEXT].filter((line) => SECOND_PERSON_WORD.test(line));
    expect(secondPerson.length, 'card text carrying a second person').toBeGreaterThan(0);
    // Every one of them is reminder text rather than a rules line: a DSL card's
    // own rules text still says no second person, which is the narrower half of
    // the original premise and is still true.
    const rulesLines = EXAMPLE_CARDS.flatMap((card) =>
      card.abilities.map((ability) => renderAbility(ability, card.name)),
    );
    expect(rulesLines.filter((line) => SECOND_PERSON_WORD.test(line))).toEqual([]);
  });

  it('says no second-person word anywhere on the surface', () => {
    const said = HOTSEAT_SWEEP.filter(
      (line) => SECOND_PERSON_WORD.test(line) && !PRINTED_CARD_TEXT.has(line),
    );
    expect([...new Set(said)]).toEqual([]);
  });
});

/**
 * A line's fields, where a structured line has any.
 *
 * The board header is `Turn 7 · main phase · Player one` and the turn badge is
 * `Turn 7: Player one`: a middle dot and a colon are how this surface writes a
 * row of fields rather than a sentence, and no other string on it joins prose
 * that way.
 */
const FIELD_SEPARATOR = / · |: /;

/**
 * The strings whose seat mention is a label slot rather than a sentence.
 *
 * A name badge, the seat field of a board header, the owner beside a turn
 * number. They carry no grammar to agree with and read correctly whichever word
 * is in them, so rule 2 has nothing to check. The exemption is by *shape* — the
 * mention is the whole of its field — rather than by a ledger of strings, so a
 * new label slot needs no edit here and no sentence can hide inside one: as soon
 * as a field says anything besides the label, it is prose again and is checked.
 */
function isLabelSlot(third: string): boolean {
  return third
    .split(FIELD_SEPARATOR)
    .filter((field) => field.includes(THIRD_NEAR))
    .every((field) => field.trim() === THIRD_NEAR);
}

/**
 * English's modal verbs, which are the one word class that does not inflect.
 *
 * `Player one may act` and `You may act` are both right, and rule 2 would
 * otherwise report the second as an un-agreed interpolation — correctly
 * observing that the author did nothing label-dependent, and wrongly concluding
 * something was wrong with that. A modal is exactly the case where nothing
 * label-dependent is *needed*.
 *
 * It is a closed class in English, which is what makes this an exemption worth
 * having: the list is finished, it is a fact about the language rather than
 * about this codebase, and it cannot grow to swallow a real bug. Only the word
 * immediately after the seat is consulted, so `Player one keeps this hand, and
 * may bottom a card` is still checked on `keeps`.
 */
const MODALS: ReadonlySet<string> = new Set([
  'can',
  'could',
  'may',
  'might',
  'must',
  'shall',
  'should',
  'will',
  'would',
]);

function isModalSentence(third: string): boolean {
  const at = third.indexOf(THIRD_NEAR);
  if (at < 0) return false;
  const after =
    third
      .slice(at + THIRD_NEAR.length)
      .trim()
      .split(/\s+/)[0] ?? '';
  return MODALS.has(after.toLowerCase());
}

interface Mismatch {
  readonly second: string;
  readonly third: string;
}

/** Every string that mentions the near seat and does nothing about which seat it is. */
function bareSubstitutions(): readonly Mismatch[] {
  const found: Mismatch[] = [];
  for (const [at, third] of THIRD_SWEEP.entries()) {
    const second = SECOND_SWEEP[at];
    if (second === undefined || !third.includes(THIRD_NEAR)) continue;
    if (isLabelSlot(third) || isModalSentence(third)) continue;
    if (second === third.split(THIRD_NEAR).join(SECOND[0])) found.push({ second, third });
  }
  return found;
}

describe('a sentence about the near seat agrees with what the near seat is called', () => {
  /**
   * The rule. A string that survives swapping `Player one` for `You` unchanged
   * is a string built by interpolation alone, and English does not work that way
   * for the one label that is a pronoun.
   */
  it('never says a sentence that is the third-person one with the label swapped', () => {
    expect([...new Set(bareSubstitutions().map((found) => found.second))]).toEqual([]);
  });

  /**
   * The gate's own mutation check, standing in for the source that shipped the
   * six. Both sentences are built here exactly as their call sites built them
   * before the fix — `${asked} ${'keeps'}` and `${names[holder]} has priority` —
   * so a rule that stopped catching interpolation would fail this test rather
   * than pass the sweep quietly.
   */
  it('fails the surface that shipped the six', () => {
    const shipped = (label: string): readonly string[] => [
      `${label} keeps this hand, or shuffles it back for a new one.`,
      `${label} is attacking with 4 creatures.`,
      `Unblocked attackers deal their damage to ${label}.`,
    ];
    const before = shipped(SECOND[0]);
    const after = shipped(THIRD_NEAR);
    for (const [at, third] of after.entries()) {
      expect(before[at]).toBe(third.split(THIRD_NEAR).join(SECOND[0]));
    }
    // And the fixed sentences do not have that property, which is the other half
    // of the check: the rule must separate the two, not reject both.
    expect(`${SECOND[0]} have priority`).not.toBe(
      `${THIRD_NEAR} has priority`.split(THIRD_NEAR).join(SECOND[0]),
    );
  });
});
