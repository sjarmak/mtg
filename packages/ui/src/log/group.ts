/**
 * The event stream as history a person can read: grouped by turn and step,
 * narrated once, and redacted for the seat that is looking at it.
 *
 * `GameSession.events` is a flat array that reaches four figures in a long game,
 * and a flat list of a thousand sentences is not history — it is a transcript
 * nobody scrolls. The kernel already emits the structure: `turnBegan` carries the
 * turn and who is active, `stepBegan` carries the step. So the same three events
 * that would be the three most useless lines in the log become the headings the
 * rest of it hangs under, and no grouping is invented.
 *
 * # Every event has exactly one role, and the switch is the proof
 *
 * `eventRole` is total over the union and closed with `assertNever`. Four roles:
 *
 *  - `heading` — `turnBegan`, `stepBegan`, `stepEnded`. Rendered as the group's
 *    own title rather than as a line inside it. Nothing is lost: the turn number,
 *    the active player and the step name are all in the heading.
 *  - `story` — the game, as the playtester listed it. Spells, abilities, targets,
 *    triggers, damage, life, zone movement, and every choice the kernel recorded
 *    as an event (attack and block declarations, a declined trigger, a mulligan,
 *    a discard).
 *  - `detail` — the rules doing their work. Mana produced and paid and emptied,
 *    taps and untaps, summoning sickness, layer effects arriving and expiring,
 *    the replacement trace, the damage-clear sweep, the shuffle. Every one is
 *    something the board already shows or a step the rules take without anybody
 *    deciding anything, and a player reaches for them when a play did not go the
 *    way they expected.
 *  - `priority` — the pass-and-pass-back round. Two events per player per round,
 *    written whether or not anybody did anything, and on a real game they are
 *    two thirds of the whole stream by themselves.
 *
 * # Three levels, because two were everything or nothing
 *
 * `mtg-zwk`. A finished 16-turn game is 1252 events. The old control had two
 * settings, `story` and `everything`, so a reader who wanted to know where their
 * mana went had to take 589 lines of priority with it, and the log went from 179
 * lines to 905 in one press. The levels are named for what a player is asking:
 *
 *  - **Story** (the default) — what happened. 107 lines on that game.
 *  - **Detail** — how it happened: the mana, the taps, the sweeps. 316 lines.
 *  - **Every event** — the stream itself, priority included. 905 lines.
 *
 * The middle one is the whole point, and its boundary is drawn at priority rather
 * than at "bookkeeping" because priority is the only tier whose size is a
 * function of how long the game ran rather than of how much was done in it.
 *
 * **What a level hides it does not drop, and the control says how much.**
 * That distinction is the whole of the log's claim to be authoritative: an event
 * silently missing makes it a summary. At `everything` density every event in the
 * array is a line or a heading and the count is asserted
 * (`test/log/game-log.test.ts`), so the control is the only thing between a
 * reader and the raw stream.
 *
 * # A line the log already wrote is not written twice
 *
 * The kernel emits `zoneChanged` for every movement and a second, specific event
 * for the reason it moved, so one land drop arrived as three sentences — the
 * move, the arrival and the play — and every draw arrived as two. Both halves are
 * true and only one of them is news.
 *
 * `impliedEvents` demotes the half that repeats: a `zoneChanged` whose exact move
 * is already claimed by another event in the stream, and a `permanentEntered`
 * that a `landPlayed` already reported. It is a *demotion* to `detail`, never a
 * drop, and it is keyed on the move rather than on the kind of zone, so the
 * movements nothing else reports — a bounce, an exile from a graveyard — stay in
 * the story where the playtester's list puts them. On the same game it takes 179 story
 * lines to 107 without removing a fact from any of them.
 *
 * # Ordering
 *
 * Chronological, oldest first, inside groups and between them, and nothing
 * re-sorts. `board/Graveyard.ts` states the house rule this follows and
 * `board/ZoneBrowser.ts` cites the case behind it (Arena Patch Notes 2022.13:
 * one zone with three orders across three browsers). The rule is that a zone's
 * order is one order, written down, and never re-derived per view; the
 * *direction* is the reader's to choose, and a graveyard's and a log's readers
 * want opposite ones. A graveyard has no internal narrative, so newest-first
 * costs nothing and answers "what just died" in one glance. A log does: reversed,
 * "Grizzly Bears deals 2 damage to Bot" prints above the attack that caused it,
 * and every causal pair in the history reads backwards. So the log is
 * chronological and the *panel* is anchored at its newest end instead
 * (`./GameLog.ts`), which is where newest-visible is paid for.
 */
import { assertNever } from '@mtg/dsl';
import type { GameEvent, ObjectId, PlayerId, ZoneId } from '@mtg/kernel';
import { withAbilityNames } from './ability-names';
import { describeEvent, stepWords } from './narrate';
import type { LogNames } from './narrate';
import { namesFor } from './visibility';

/** How much of the stream is drawn. Every level draws the same groups. */
export type LogDensity = 'story' | 'detail' | 'everything';

/** What a single event becomes on screen. */
export type EventRole = 'heading' | 'story' | 'detail' | 'priority';

/**
 * The tiers in the order a reader turns them on, which is the only place their
 * order is written down. `drawnAt` is the whole of the density rule.
 */
const TIERS: readonly EventRole[] = ['story', 'detail', 'priority'];

const DENSITY_DEPTH: Readonly<Record<LogDensity, number>> = { story: 1, detail: 2, everything: 3 };

/** Whether a line of this role is drawn at this level. Headings are not lines. */
export function drawnAt(role: EventRole, density: LogDensity): boolean {
  const tier = TIERS.indexOf(role);
  return tier >= 0 && tier < DENSITY_DEPTH[density];
}

export interface LogLine {
  readonly key: string;
  /** Where this line sits in `session.events`, so a reader can be pointed at it. */
  readonly index: number;
  readonly text: string;
  /** The tier it was drawn at, which is what a lower level would have left out. */
  readonly role: EventRole;
}

export interface LogStep {
  readonly key: string;
  /** The step in words, or how the group came to exist when no step had begun. */
  readonly title: string;
  readonly lines: readonly LogLine[];
}

export interface LogTurn {
  readonly key: string;
  /** `Turn 4`, or `Before the game` for everything ahead of the first turn. */
  readonly title: string;
  /** The active player's name, absent before the first turn begins. */
  readonly owner: string | null;
  readonly steps: readonly LogStep[];
}

/**
 * One role per event, exhaustively.
 *
 * A new kernel event fails to compile here rather than defaulting into a
 * tier, which is the point: the failure mode this whole file is guarding against
 * is an event that is in the log's source of truth and not on its screen.
 */
export function eventRole(event: GameEvent): EventRole {
  switch (event.type) {
    // Headings. The group carries what they say.
    case 'turnBegan':
    case 'stepBegan':
    case 'stepEnded':
      return 'heading';

    // The round of passes, which is most of the stream and none of the game.
    case 'priorityGained':
    case 'priorityPassed':
      return 'priority';

    // Bookkeeping. Visible on the board, or a rules step nobody chose.
    case 'libraryShuffled':
    case 'permanentUntapped':
    case 'permanentTapped':
    case 'summoningSicknessCleared':
    case 'manaProduced':
    case 'manaPoolEmptied':
    case 'manaPaid':
    case 'replacementApplied':
    case 'continuousEffectAdded':
    case 'keywordGranted':
    case 'continuousEffectsExpired':
    case 'combatDamageStep':
    case 'damageCleared':
      return 'detail';

    // The game.
    case 'gameStarted':
    case 'cardDrawn':
    case 'drawFromEmptyLibrary':
    case 'landPlayed':
    case 'spellCast':
    case 'spellCopied':
    case 'abilityActivated':
    case 'abilityTriggered':
    case 'triggerTargetsChosen':
    case 'triggerDeclined':
    case 'triggerRemoved':
    case 'spellCountered':
    case 'spellFizzled':
    case 'spellDeclined':
    case 'unlessPaid':
    case 'resolutionBegan':
    case 'effectSkipped':
    case 'zoneChanged':
    case 'permanentEntered':
    case 'tokenCreated':
    case 'damageDealt':
    case 'damagePrevented':
    case 'countersChanged':
    case 'lifeChanged':
    case 'permanentDestroyed':
    case 'permanentSacrificed':
    case 'permanentRegenerated':
    case 'attackersDeclared':
    case 'blockersDeclared':
    case 'blockerOrderChosen':
    case 'cardsMilled':
    case 'cardsScried':
    case 'cardsDiscarded':
    case 'handRevealed':
    case 'libraryTopRevealed':
    case 'librarySearched':
    case 'librarySearchRevealed':
    case 'handMulliganed':
    case 'handKept':
    case 'playerLost':
    case 'gameEnded':
    case 'untapSkipped':
      // `untapSkipped` is story where `permanentUntapped` beside it is detail.
      // An untap is visible on the board and the line is a caption for it; a
      // skipped untap changes nothing anyone can see, so at the detail tier the
      // one turn a Sleep bought would pass with no record of it anywhere.
      return 'story';

    default:
      return assertNever(event, 'eventRole');
  }
}

/** A movement, as the key the two halves of a doubled report share. */
function moveKey(oid: ObjectId, from: ZoneId | '*', to: ZoneId): string {
  return `${oid}|${from}|${to}`;
}

/**
 * Every movement some event other than `zoneChanged` already reports.
 *
 * Counted rather than collected into a set, because a card can make the same
 * move twice in one game — drawn, put back, drawn again — and a single claim may
 * only cover a single movement. `permanentEntered` claims with a wildcard origin
 * because a permanent arrives from wherever it was and the arrival is the news.
 */
function claimedMoves(events: readonly GameEvent[]): Map<string, number> {
  const claims = new Map<string, number>();
  const claim = (key: string): void => {
    claims.set(key, (claims.get(key) ?? 0) + 1);
  };
  for (const event of events) {
    switch (event.type) {
      case 'cardDrawn':
        claim(moveKey(event.oid, 'library', 'hand'));
        break;
      case 'landPlayed':
        claim(moveKey(event.oid, 'hand', 'battlefield'));
        break;
      case 'spellCast':
        claim(moveKey(event.oid, 'hand', 'stack'));
        break;
      case 'cardsDiscarded':
        for (const oid of event.oids) claim(moveKey(oid, 'hand', 'graveyard'));
        break;
      case 'cardsMilled':
        for (const oid of event.oids) claim(moveKey(oid, 'library', 'graveyard'));
        break;
      case 'handKept':
        for (const oid of event.bottomed) claim(moveKey(oid, 'hand', 'library'));
        break;
      case 'permanentEntered':
        claim(moveKey(event.oid, '*', 'battlefield'));
        break;
      case 'permanentDestroyed':
      case 'permanentSacrificed':
        claim(moveKey(event.oid, 'battlefield', 'graveyard'));
        break;
      // A spell that resolved, was countered, fizzled or was declined (CR
      // 601.2c's "you may", answered "no") ends in its owner's graveyard by the
      // same rule that put it on the stack, and each of the four has already
      // said so in its own words.
      case 'resolutionBegan':
      case 'spellFizzled':
      case 'spellCountered':
      case 'spellDeclined':
      case 'unlessPaid':
        claim(moveKey(event.oid, 'stack', 'graveyard'));
        break;
      default:
        break;
    }
  }
  return claims;
}

/**
 * The indices of the events another line already reports, to be demoted.
 *
 * Two shapes, both found by asking whether the same fact is stated twice rather
 * than by listing the pairs that happen to occur:
 *
 *  - a `zoneChanged` whose movement some other event has claimed. A claim is
 *    spent when it is used, so the second of two identical draws is only implied
 *    if the stream really holds two draws.
 *  - a `permanentEntered` for a land that was just played. A land drop uses no
 *    stack and asks nobody anything, so "plays a land" and "the land arrives" are
 *    one moment; a creature spell's cast, resolution and arrival are three, and
 *    those keep their three lines.
 */
export function impliedEvents(events: readonly GameEvent[]): ReadonlySet<number> {
  const claims = claimedMoves(events);
  const landed = new Set<ObjectId>();
  for (const event of events) if (event.type === 'landPlayed') landed.add(event.oid);

  const implied = new Set<number>();
  for (const [index, event] of events.entries()) {
    if (event.type === 'permanentEntered') {
      if (landed.has(event.oid)) implied.add(index);
      continue;
    }
    if (event.type !== 'zoneChanged') continue;
    const exact = moveKey(event.oid, event.from, event.to);
    const wild = moveKey(event.oid, '*', event.to);
    const key = (claims.get(exact) ?? 0) > 0 ? exact : (claims.get(wild) ?? 0) > 0 ? wild : null;
    if (key === null) continue;
    claims.set(key, (claims.get(key) ?? 0) - 1);
    implied.add(index);
  }
  return implied;
}

/**
 * The role every event is drawn at, demotions applied, in stream order.
 *
 * One derivation for the tree and the strip both. `summarizeLog` reports how big
 * the log is without building it, and a second copy of the demotion rule is a
 * second chance for the two numbers to disagree.
 */
export function logRoles(events: readonly GameEvent[]): readonly EventRole[] {
  const implied = impliedEvents(events);
  return events.map((event, index): EventRole => (implied.has(index) ? 'detail' : eventRole(event)));
}

/** What a group is called when events arrive before any step has begun. */
const PREGAME_STEP = 'opening hands';
const PRESTEP = 'turn begins';
const PREGAME_TURN = 'Before the game';

export interface LogInput {
  readonly events: readonly GameEvent[];
  /** The unredacted book; `./visibility.ts` decides what reaches a sentence. */
  readonly names: LogNames;
  /** The seat reading the log. Card names it may not see are replaced. */
  readonly viewer: PlayerId;
  readonly density: LogDensity;
}

interface OpenStep {
  readonly key: string;
  readonly title: string;
  readonly lines: LogLine[];
}

interface OpenTurn {
  readonly key: string;
  readonly title: string;
  readonly owner: string | null;
  readonly steps: OpenStep[];
}

/**
 * The whole stream as turns and steps.
 *
 * Single pass, and every group is created lazily by the first thing that needs
 * it: a step with nothing in it never exists at `story` density, so the log does
 * not print thirteen empty headings per turn. At `everything` density a heading
 * stands for its own `stepBegan` and `stepEnded` whether or not anything happened
 * between them, because there the count has to close.
 *
 * A `stepEnded` does not close its group. The events between one step ending and
 * the next beginning belong to the step that just ran, and a group closed early
 * would have to invent somewhere else to put them.
 */
export function buildLog(input: LogInput): readonly LogTurn[] {
  const { events, viewer, density } = input;
  const names = withAbilityNames(input.names, events);
  const roles = logRoles(events);
  const keepEmptySteps = density === 'everything';
  let turn: OpenTurn = { key: 'turn-pre', title: PREGAME_TURN, owner: null, steps: [] };
  const turns: OpenTurn[] = [turn];
  let step: OpenStep | null = null;

  for (const [index, event] of events.entries()) {
    const role = roles[index] ?? eventRole(event);
    if (role === 'heading') {
      if (event.type === 'turnBegan') {
        turn = {
          key: `turn-${String(index)}`,
          title: `Turn ${String(event.turn)}`,
          owner: names.player(event.active),
          steps: [],
        };
        turns.push(turn);
        step = null;
      } else if (event.type === 'stepBegan') {
        step = { key: `step-${String(index)}`, title: stepWords(event.step), lines: [] };
        turn.steps.push(step);
      }
      // `stepEnded` closes nothing: see the docblock. Its step already has a
      // heading, which is the record that the step ran.
      continue;
    }
    if (!drawnAt(role, density)) continue;
    if (step === null) {
      step = {
        key: `${turn.key}-open`,
        title: turn.owner === null ? PREGAME_STEP : PRESTEP,
        lines: [],
      };
      turn.steps.push(step);
    }
    step.lines.push({
      key: `event-${String(index)}`,
      index,
      text: describeEvent(event, namesFor(event, viewer, names)),
      role,
    });
  }

  return turns.map((open): LogTurn => ({
    key: open.key,
    title: open.title,
    owner: open.owner,
    steps: open.steps
      .filter((entry) => keepEmptySteps || entry.lines.length > 0)
      .map((entry): LogStep => ({ key: entry.key, title: entry.title, lines: entry.lines })),
  }));
}

/** How many lines the log is drawing, which is what its head reports. */
export function countLines(turns: readonly LogTurn[]): number {
  let total = 0;
  for (const turn of turns) {
    for (const step of turn.steps) total += step.lines.length;
  }
  return total;
}

/** What a shut log knows about itself: how big it is and what just happened. */
export interface LogSummary {
  readonly count: number;
  readonly newest: LogLine | null;
}

/**
 * The head's two facts without building the tree.
 *
 * The closed strip is what a game renders on every single decision, and
 * `buildLog` narrates every event in the stream to produce something the strip
 * uses two values from. A 700-event game re-narrated per render is quadratic
 * work behind a one-line label, and it was measured as such: the whole-game
 * click-through tests went from seconds to timing out. So the shut path is one
 * scan that classifies and one sentence at the end of it, and `buildLog` is not
 * called until somebody opens the panel.
 *
 * `test/log/game-log.test.ts` holds the two to the same count, which is the
 * thing a second derivation has to be held to.
 */
export function summarizeLog(input: LogInput): LogSummary {
  const { events, viewer, density } = input;
  const roles = logRoles(events);
  let count = 0;
  let newestAt = -1;
  for (const index of events.keys()) {
    if (!drawnAt(roles[index] ?? 'story', density)) continue;
    count += 1;
    newestAt = index;
  }
  const newest = newestAt < 0 ? undefined : events[newestAt];
  const role = roles[newestAt];
  if (newest === undefined || role === undefined) return { count, newest: null };
  const names = withAbilityNames(input.names, events);
  return {
    count,
    newest: {
      key: `event-${String(newestAt)}`,
      index: newestAt,
      text: describeEvent(newest, namesFor(newest, viewer, names)),
      role,
    },
  };
}
