// @vitest-environment jsdom
/**
 * The game log, against a real played game rather than a hand-built array.
 *
 * `mtg-bz2.12`. Every assertion below narrates the events a kernel session
 * actually emitted, for the reason `test/log/narrate.test.ts` does: a fixture
 * written by hand agrees with whatever the code that reads it believes, and the
 * bug this lane can most plausibly ship — an event class that never reaches the
 * screen — is invisible to a test whose input is the list of events somebody
 * remembered to put in it.
 *
 * Three properties are load-bearing and each has its own block:
 *
 *  - **Nothing is silently missing.** At `everything` density every event in the
 *    stream is a line or a heading, counted, and the count has to close. That is
 *    the whole of "authoritative": a log that quietly drops a class of event is a
 *    summary with a misleading name.
 *  - **Nothing leaks.** The play surface is a hotseat surface, so the log is read
 *    by both seats in turn, and a line naming a card the other player drew hands
 *    one player the other's hand. The rule is checked from both sides, and the
 *    negative is checked as well as the positive.
 *  - **It is history a person can read.** Grouped by the turn and step the kernel
 *    itself emitted, chronological, and anchored at its newest end.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EXAMPLE_CARDS, parseCard } from '@mtg/dsl';
import type { Card, CardInput } from '@mtg/dsl';
import type { GameEvent, GameEventType, PlayerId } from '@mtg/kernel';
import { botSeat, choose, createSession, FULL_CONTROL, humanSeat, simpleAgent } from '@mtg/kernel';
import { PlayRoute } from '../../src/routes/PlayRoute';
import { dealMirrorGame } from '../../src/routes/play/deal';
import { ownedName } from '../../src/routes/play/naming';
import { nameOf } from '../../src/routes/play/position';
import {
  DENSITY_GROUP_LABEL,
  DENSITY_LABELS,
  EVERY_EVENT_LABEL,
  GAME_LOG_LABEL,
  GAME_LOG_STATUS_LABEL,
} from '../../src/log/GameLog';
import { buildLog, countLines, eventRole, impliedEvents, logRoles, summarizeLog } from '../../src/log/group';
import type { EventRole, LogTurn } from '../../src/log/group';
import type { LogNames } from '../../src/log/narrate';
import { HIDDEN_CARD, namesVisibleTo, privateTo } from '../../src/log/visibility';
import { uiStyleSheet } from '../../src/styles/index';

afterEach(cleanup);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const KERNEL_EVENTS = join(REPO_ROOT, 'packages/kernel/src/events.ts');
const GROUP_SRC = join(REPO_ROOT, 'packages/ui/src/log/group.ts');
const VISIBILITY_SRC = join(REPO_ROOT, 'packages/ui/src/log/visibility.ts');

const SEATS = ['You', 'Bot'] as const;

/**
 * The two node members these assertions read, checked at runtime.
 *
 * The workspace tsconfig has no `lib: dom`, so `HTMLElement` here carries neither
 * `getAttribute` nor `textContent`; `test/play/play.test.ts` opens the same door
 * the same way and says so.
 */
interface NodeLike {
  readonly getAttribute: (name: string) => string | null;
  readonly textContent: string | null;
}

function nodeOf(value: unknown): NodeLike {
  const candidate = value as Partial<NodeLike> | null | undefined;
  if (candidate === null || candidate === undefined || typeof candidate.getAttribute !== 'function') {
    throw new Error('expected a node in the document');
  }
  return candidate as NodeLike;
}

function attr(value: unknown, name: string): string | null {
  return nodeOf(value).getAttribute(name);
}

function text(value: unknown): string {
  return nodeOf(value).textContent ?? '';
}

const NAMES: LogNames = {
  player: (id: PlayerId): string => SEATS[id],
  card: (oid: string): string => `card ${oid}`,
  target: (oid: string): string => `their card ${oid}`,
};

/** A whole game against a bot, so the events are the reducer's own. */
function playedGame(): ReturnType<typeof createSession> {
  const game = dealMirrorGame(EXAMPLE_CARDS, { youName: 'You', opponentName: 'Bot' });
  let session = createSession(game.config.setup, [humanSeat('You'), botSeat(simpleAgent('Bot'))]);
  for (let step = 0; step < 10_000 && session.pending !== null; step += 1) {
    session = choose(session, 0);
  }
  return session;
}

const SESSION = playedGame();
const EVENTS = SESSION.events;

/** The names book a live surface builds: the game's own object table. */
const LIVE_NAMES: LogNames = {
  player: (id: PlayerId): string => SEATS[id],
  card: (oid: string): string => nameOf(SESSION.state, oid),
  target: (oid: string): string => ownedName(SESSION.state, SEATS, oid),
};

/**
 * A pool that puts abilities on the stack, because the shared one cannot.
 *
 * `@mtg/dsl`'s example cards carry keywords and spell effects and not one
 * ability, so a mirror game of them never creates a stack object without a card
 * — which is the only object the id leak in `mtg-zwk` could ever have been
 * about. These two cards are the smallest pool that produces both kinds: one
 * ability a player activates and one that triggers on its own.
 *
 * Invented rather than borrowed from a set fixture. `AGENTS.md`: a card name
 * belongs in a fixture and not in a public package, and a test that needs a
 * creature invents one.
 */
const ABILITY_CARD_INPUTS: readonly CardInput[] = [
  {
    kind: 'creature',
    id: 'log-kiln-warden',
    name: 'Kiln Warden',
    rarity: 'common',
    set: { code: 'LOG', collectorNumber: 1 },
    manaCost: { generic: 1, R: 1 },
    colors: ['R'],
    subtypes: ['Dwarf'],
    power: 2,
    toughness: 2,
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 0 }, tapSelf: true },
        effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetPlayer' } }],
      },
    ],
  },
  {
    kind: 'creature',
    id: 'log-bellwether-herald',
    name: 'Bellwether Herald',
    rarity: 'uncommon',
    set: { code: 'LOG', collectorNumber: 2 },
    manaCost: { generic: 2, R: 1 },
    colors: ['R'],
    subtypes: ['Human', 'Scout'],
    power: 2,
    toughness: 3,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [
          {
            kind: 'createToken',
            count: 1,
            token: { name: 'Ember', power: 1, toughness: 1, colors: ['R'], subtypes: ['Elemental'] },
          },
        ],
      },
    ],
  },
];

const ABILITY_POOL: readonly Card[] = [
  ...ABILITY_CARD_INPUTS.map(parseCard),
  ...EXAMPLE_CARDS.filter((card) => card.colors.length === 1 && card.colors[0] === 'R'),
];

/** The same whole game, over a pool that has abilities to put on the stack. */
function playedWith(pool: readonly Card[]): ReturnType<typeof createSession> {
  const game = dealMirrorGame(pool, { youName: 'You', opponentName: 'Bot' });
  let session = createSession(game.config.setup, [humanSeat('You'), botSeat(simpleAgent('Bot'))]);
  for (let step = 0; step < 10_000 && session.pending !== null; step += 1) session = choose(session, 0);
  return session;
}

function countOf(type: GameEventType): number {
  return EVENTS.filter((event: GameEvent) => event.type === type).length;
}

function allLines(turns: readonly LogTurn[]): readonly string[] {
  return turns.flatMap((turn) => turn.steps.flatMap((step) => step.lines.map((line) => line.text)));
}

describe('the played game is worth asserting against', () => {
  it('finished, and is long enough that the grouping has work to do', () => {
    expect(SESSION.result).not.toBeNull();
    expect(EVENTS.length).toBeGreaterThan(500);
    expect(countOf('turnBegan')).toBeGreaterThan(3);
    expect(countOf('stepBegan')).toBeGreaterThan(30);
  });
});

/**
 * The coverage table, checked rather than written down.
 *
 * `eventRole` and `privateTo` are both closed with `assertNever`, so tsc already
 * proves neither can miss a member of the union. What tsc cannot say is that the
 * two files are switching over the *kernel's* union rather than over a copy that
 * drifted, so the member names are read out of `packages/kernel/src/events.ts`
 * and each one has to appear as its own case in both. A member handled by falling
 * into a neighbor's case is the one shape that compiles and is still wrong.
 */
describe('every event class the kernel can emit is classified', () => {
  const declared = [
    ...new Set(
      [...readFileSync(KERNEL_EVENTS, 'utf8').matchAll(/readonly type: '([a-zA-Z]+)'/g)].map(
        (found) => found[1] ?? '',
      ),
    ),
  ];

  it('reads the whole union out of the kernel', () => {
    expect(declared.length).toBeGreaterThan(40);
    expect(declared).toContain('spellCast');
    expect(declared).toContain('lifeChanged');
    expect(declared).toContain('zoneChanged');
  });

  it('gives each member its own case in the role table and the visibility rule', () => {
    const group = readFileSync(GROUP_SRC, 'utf8');
    const visibility = readFileSync(VISIBILITY_SRC, 'utf8');
    const missing: string[] = [];
    for (const type of declared) {
      if (!group.includes(`case '${type}':`)) missing.push(`group.ts: ${type}`);
      if (!visibility.includes(`case '${type}':`)) missing.push(`visibility.ts: ${type}`);
    }
    expect(missing).toEqual([]);
  });

  /**
   * The playtester's list, member by member, against the roles they were given. Each
   * of these is a class she named; none of them may sit in the tier the density
   * control hides, because that tier is the engine's bookkeeping and hers is the
   * game.
   */
  it('puts every class she named in the always-shown tier', () => {
    const story: readonly GameEventType[] = [
      'spellCast',
      'abilityActivated',
      'triggerTargetsChosen',
      'abilityTriggered',
      'triggerDeclined',
      'damageDealt',
      'damagePrevented',
      'lifeChanged',
      'zoneChanged',
      'cardDrawn',
      'cardsDiscarded',
      'cardsMilled',
      'permanentEntered',
      'permanentDestroyed',
      'attackersDeclared',
      'blockersDeclared',
      'blockerOrderChosen',
      'handMulliganed',
      'handKept',
    ];
    const found = new Map<GameEventType, string>();
    for (const event of EVENTS) found.set(event.type, eventRole(event));
    for (const type of story) {
      const role = found.get(type);
      // Only the ones this game actually produced can be checked from its
      // stream; the rest are covered by the case-table test above.
      if (role !== undefined) expect(`${type}=${role}`).toBe(`${type}=story`);
    }
  });

  /**
   * The one event whose tier cannot be read off this game, because no card in
   * `EXAMPLE_CARDS` holds a permanent down. It sits in the always-shown tier for
   * a reason the others do not need: an untap is visible on the board and its
   * line is a caption, but a *skipped* untap changes nothing anyone can see, so
   * at the detail tier the turn a Sleep bought would pass with no record of it
   * anywhere.
   */
  it('keeps a skipped untap in the always-shown tier, where its only record is the line', () => {
    expect(eventRole({ type: 'untapSkipped', oid: 'o1' })).toBe('story');
    expect(eventRole({ type: 'permanentUntapped', oid: 'o1' })).toBe('detail');
  });

  it('promotes the turn and step boundaries to headings rather than lines', () => {
    for (const event of EVENTS) {
      if (event.type === 'turnBegan' || event.type === 'stepBegan' || event.type === 'stepEnded') {
        expect(eventRole(event)).toBe('heading');
      }
    }
  });
});

/**
 * The authoritative-history claim, as arithmetic.
 *
 * At `everything` density nothing is dropped, so the lines plus the headings have
 * to add up to the stream. A heading stands for one `stepBegan` and its matching
 * `stepEnded`, or for one `turnBegan`; every other event is exactly one line.
 */
describe('nothing is silently missing', () => {
  const everything = buildLog({ events: EVENTS, names: NAMES, viewer: 0, density: 'everything' });
  const detail = buildLog({ events: EVENTS, names: NAMES, viewer: 0, density: 'detail' });
  const story = buildLog({ events: EVENTS, names: NAMES, viewer: 0, density: 'story' });
  const roles = logRoles(EVENTS);

  function atRole(role: EventRole): number {
    return roles.filter((each) => each === role).length;
  }

  it('accounts for every event in the stream at full density', () => {
    const headings = countOf('turnBegan') + countOf('stepBegan') + countOf('stepEnded');
    expect(countLines(everything) + headings).toBe(EVENTS.length);
  });

  it('adds exactly one tier per level, and each level is a superset of the one below', () => {
    expect(countLines(story)).toBe(atRole('story'));
    expect(countLines(detail)).toBe(atRole('story') + atRole('detail'));
    expect(countLines(everything)).toBe(atRole('story') + atRole('detail') + atRole('priority'));
    // Supersets by index, not only by count: a level that swapped one line for
    // another would keep the arithmetic and break the reading.
    const indices = (turns: readonly LogTurn[]): readonly number[] =>
      turns.flatMap((turn) => turn.steps.flatMap((step) => step.lines.map((line) => line.index)));
    const wider = new Set(indices(detail));
    for (const index of indices(story)) expect(wider.has(index)).toBe(true);
    const widest = new Set(indices(everything));
    for (const index of indices(detail)) expect(widest.has(index)).toBe(true);
  });

  /**
   * The measurement `mtg-zwk` was filed on, held as a number.
   *
   * A finished game of the flagship's size is over a thousand events, the
   * default was 179 lines of it and the only other setting was 905. Each of
   * these bounds is the shape of the complaint rather than a snapshot of one
   * seed: the default has to stay far below the raw stream, the middle has to be
   * a real middle rather than either neighbor in disguise, and the top has to
   * stay the whole thing.
   */
  it('leaves the default well under the stream, with a middle that is neither end', () => {
    expect(countLines(story)).toBeLessThan(countLines(everything) / 4);
    expect(countLines(detail)).toBeGreaterThan(countLines(story) * 2);
    expect(countLines(detail)).toBeLessThan(countLines(everything) / 2);
    // Priority is the reason the top level is the size it is, and the reason it
    // is a tier of its own rather than part of the middle.
    expect(atRole('priority')).toBeGreaterThan(countLines(detail));
  });

  it('draws no priority pass below the top level, and every one of them at it', () => {
    const passes = countOf('priorityGained') + countOf('priorityPassed');
    expect(passes).toBeGreaterThan(100);
    for (const turns of [story, detail]) {
      for (const text of allLines(turns)) expect(text).not.toContain('priority');
    }
    expect(allLines(everything).filter((text) => text.includes('priority')).length).toBe(passes);
  });

  /**
   * The shut strip counts the log without building it, which is a second
   * derivation and is held to the first. `group.ts` says what it bought and why
   * it exists; this is the part that keeps it honest.
   */
  it('counts the same log the tree does, at both densities, and names the same newest line', () => {
    for (const density of ['story', 'everything'] as const) {
      const tree = buildLog({ events: EVENTS, names: NAMES, viewer: 0, density });
      const summary = summarizeLog({ events: EVENTS, names: NAMES, viewer: 0, density });
      expect(summary.count).toBe(countLines(tree));
      expect(summary.newest?.text).toBe(allLines(tree).at(-1));
    }
  });

  it('finishes a sentence for every line, with no interpolated hole in it', () => {
    for (const text of allLines(everything)) {
      expect(text.length).toBeGreaterThan(0);
      expect(text.endsWith('.')).toBe(true);
      expect(text).not.toMatch(/undefined|\[object Object\]/);
    }
  });

  it('keeps the lines in the order the reducer emitted them', () => {
    const indices = everything.flatMap((turn) =>
      turn.steps.flatMap((step) => step.lines.map((line) => line.index)),
    );
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(indices.length).toBe(countLines(everything));
  });
});

/**
 * The object-id leak, from the seat that saw it.
 *
 * `mtg-zwk`. `object ab83 resolves.` reached a played board, and the fix has to
 * be measured against the book a live surface actually builds — `NAMES` above
 * answers every id with a string, so it would pass a test the real one fails.
 * `LIVE_NAMES` is `routes/play/position.ts`'s `nameOf` over the finished state,
 * which is the function that produced the leak.
 */
describe('no engine object id reaches a sentence', () => {
  const OBJECT_ID = /object [a-z0-9]+/;
  const session = playedWith(ABILITY_POOL);
  const events = session.events;
  const names: LogNames = {
    player: (id: PlayerId): string => SEATS[id],
    card: (oid: string): string => nameOf(session.state, oid),
    target: (oid: string): string => ownedName(session.state, SEATS, oid),
  };

  it('put ability objects on the stack, or this proves nothing', () => {
    const activated = events.filter((event: GameEvent) => event.type === 'abilityActivated').length;
    const triggered = events.filter((event: GameEvent) => event.type === 'abilityTriggered').length;
    expect(activated + triggered).toBeGreaterThan(0);
    // The book a live surface builds really does miss them, which is the bug.
    // Without this the fix could be a no-op and every assertion below would pass.
    const missed = events.filter(
      (event: GameEvent) =>
        (event.type === 'abilityActivated' || event.type === 'abilityTriggered') &&
        OBJECT_ID.test(nameOf(session.state, event.oid)),
    );
    expect(missed.length).toBe(activated + triggered);
  });

  it('names the source of every ability that resolved, at every level', () => {
    for (const density of ['story', 'detail', 'everything'] as const) {
      const lines = allLines(buildLog({ events, names, viewer: 0, density }));
      for (const line of lines) expect(line).not.toMatch(OBJECT_ID);
      expect(lines.some((line) => /'s ability resolves\./.test(line))).toBe(true);
    }
  });

  it('spends the name the line above it already printed', () => {
    const drawn = events.filter((event: GameEvent) => eventRole(event) !== 'heading');
    const lines = allLines(buildLog({ events, names, viewer: 0, density: 'everything' }));
    let checked = 0;
    for (const [at, event] of drawn.entries()) {
      if (event.type !== 'abilityTriggered' && event.type !== 'abilityActivated') continue;
      const source = nameOf(session.state, event.source);
      // The same permanent names both the activation line and, later, the line
      // for the ability object it put on the stack.
      expect(lines[at]).toContain(source);
      const resolved = lines.findIndex(
        (line, index) => index > at && line === `${source}'s ability resolves.`,
      );
      expect(resolved).toBeGreaterThan(at);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  /**
   * The shut strip narrates its newest line on its own path, so it gets its own
   * assertion: a leak fixed in the tree and not in the summary is a leak on the
   * one row of the log that is on screen at all times.
   */
  it('keeps the id out of the closed strip too', () => {
    for (let cut = 1; cut <= events.length; cut += 1) {
      const summary = summarizeLog({
        events: events.slice(0, cut),
        names,
        viewer: 0,
        density: 'everything',
      });
      expect(summary.newest?.text ?? '').not.toMatch(OBJECT_ID);
    }
  });
});

/**
 * One fact, one sentence.
 *
 * The kernel emits `zoneChanged` for every movement and a second event for the
 * reason, so a land drop arrived as three lines and a draw as two. The demotion
 * is per movement rather than per zone, so this checks both directions: the
 * doubled halves are gone from the story and the movements nothing else reports
 * are still in it.
 */
describe('a fact the log already stated is not stated twice', () => {
  const story = allLines(buildLog({ events: EVENTS, names: NAMES, viewer: 0, density: 'story' }));
  const implied = impliedEvents(EVENTS);

  it('demotes rather than drops: every implied event is still drawn one level up', () => {
    const roles = logRoles(EVENTS);
    expect(implied.size).toBeGreaterThan(20);
    for (const index of implied) expect(roles[index]).toBe('detail');
    const detail = buildLog({ events: EVENTS, names: NAMES, viewer: 0, density: 'detail' });
    const drawn = new Set(
      detail.flatMap((turn) => turn.steps.flatMap((step) => step.lines.map((line) => line.index))),
    );
    for (const index of implied) expect(drawn.has(index)).toBe(true);
  });

  it('tells a land drop once, and a draw once', () => {
    const drops = EVENTS.filter((event: GameEvent) => event.type === 'landPlayed');
    expect(drops.length).toBeGreaterThan(4);
    for (const drop of drops) {
      if (drop.type !== 'landPlayed') continue;
      const land = NAMES.card(drop.oid);
      expect(story.filter((text) => text.includes(land) && text.includes('battlefield')).length).toBe(0);
    }
    const draws = countOf('cardDrawn');
    expect(story.filter((text) => / draws? /.test(text)).length).toBe(draws);
    expect(story.filter((text) => text.includes('moves from library to hand')).length).toBe(0);
  });

  /**
   * The direction that keeps the demotion honest. the playtester's list names zone
   * movement, and a rule that hid all of it would pass every assertion above.
   */
  it('keeps a movement no other event reports', () => {
    // A bounce, hand-built: neither pool this file plays produces one, and this
    // is the direction that keeps the demotion honest — a rule that hid every
    // zone change would pass every assertion above it.
    const bounce: readonly GameEvent[] = [
      { type: 'zoneChanged', oid: 'c1', from: 'battlefield', to: 'hand', owner: 0 },
    ];
    expect(impliedEvents(bounce).size).toBe(0);
    expect(allLines(buildLog({ events: bounce, names: NAMES, viewer: 0, density: 'story' }))).toEqual([
      `${NAMES.card('c1')} moves from battlefield to hand.`,
    ]);
  });

  it('spends a claim once, so a second identical move is still news', () => {
    // The same card drawn, put back and drawn again. One `cardDrawn` may only
    // cover one library-to-hand movement; counting rather than collecting is
    // what makes the second one visible.
    const twice: readonly GameEvent[] = [
      { type: 'zoneChanged', oid: 'c1', from: 'library', to: 'hand', owner: 0 },
      { type: 'cardDrawn', player: 0, oid: 'c1' },
      { type: 'zoneChanged', oid: 'c1', from: 'library', to: 'hand', owner: 0 },
    ];
    expect([...impliedEvents(twice)]).toEqual([0]);
  });
});

/**
 * English, over a seat that is called `You`.
 *
 * `You keeps their opening hand.` and `You loses the game` shipped, because the
 * sentences were written for a third-person label and the play surface hands
 * them a pronoun. The rule is read off the label rather than set by a flag, so
 * this checks both a seat that is second person and a table where neither is.
 */
describe('the sentences agree with the seat they are about', () => {
  const SEAT_NAME = 'Wren';
  const linesFor = (label: string): readonly string[] =>
    allLines(
      buildLog({
        events: EVENTS,
        names: {
          player: (id: PlayerId): string => (id === 0 ? label : 'Bot'),
          card: NAMES.card,
          target: NAMES.target,
        },
        viewer: 0,
        density: 'everything',
      }),
    );
  const pronoun = linesFor('You');
  const named = linesFor(SEAT_NAME);

  /**
   * The test that needs no list of verbs.
   *
   * Narrate the same game twice, once with the seat called `You` and once with
   * it called a name, then substitute the name back. Wherever a sentence
   * conjugates for its subject the two must disagree — `Wren keeps their opening
   * hand` substitutes to `You keeps their opening hand`, which is the sentence
   * that shipped. A grammar rule that got missed anywhere in `describeEvent`
   * fails here without anybody having to have listed the verb it used.
   */
  it('never reads as the third-person sentence with the pronoun pasted in', () => {
    const wrong: string[] = [];
    let about = 0;
    for (const [at, third] of named.entries()) {
      if (!third.includes(SEAT_NAME)) continue;
      about += 1;
      const mechanical = third.split(SEAT_NAME).join('You');
      if (pronoun[at] === mechanical) wrong.push(mechanical);
    }
    expect(wrong).toEqual([]);
    expect(about).toBeGreaterThan(100);
  });

  it('says your hand and their hand, and never the seat name twice in one clause', () => {
    expect(pronoun.some((line) => line === 'You keep your opening hand.')).toBe(true);
    expect(pronoun.some((line) => line === 'Bot keeps their opening hand.')).toBe(true);
    expect(named.some((line) => line === `${SEAT_NAME} keeps their opening hand.`)).toBe(true);
  });

  it('points at the seat in the lower case a pronoun keeps', () => {
    expect(pronoun.filter((line) => /damage to you\./.test(line)).length).toBeGreaterThan(0);
    expect(pronoun.filter((line) => /damage to You\./.test(line))).toEqual([]);
  });

  it('leaves a table where neither seat is a pronoun entirely in the third person', () => {
    expect(named.some((line) => line === `${SEAT_NAME} passes priority.`)).toBe(true);
    expect(named.some((line) => line.startsWith(`${SEAT_NAME} draws `))).toBe(true);
    expect(named.filter((line) => line.includes(`${SEAT_NAME} draw `))).toEqual([]);
  });
});

describe('grouped by the turn and step the kernel emitted', () => {
  const turns = buildLog({ events: EVENTS, names: NAMES, viewer: 0, density: 'story' });

  it('opens on everything ahead of the first turn, then one group per turn', () => {
    expect(turns[0]?.title).toBe('Before the game');
    expect(turns[0]?.owner).toBeNull();
    expect(turns.length).toBe(countOf('turnBegan') + 1);
    expect(turns[1]?.title).toBe('Turn 1');
    expect(turns.map((turn) => turn.title).slice(1)).toEqual(
      EVENTS.filter((event: GameEvent) => event.type === 'turnBegan').map(
        (event) => `Turn ${String(event.type === 'turnBegan' ? event.turn : 0)}`,
      ),
    );
  });

  it('names the active player on each turn, and both seats take turns', () => {
    const owners = turns.slice(1).map((turn) => turn.owner);
    expect(new Set(owners)).toEqual(new Set(['You', 'Bot']));
  });

  /**
   * Two properties, and they are read off two different logs on purpose.
   *
   * The naming property - the heading is the kernel's own step word, spaced out
   * rather than renamed - is a property of every step the kernel emitted, so it
   * is read at `everything` density, where every step has a heading. Reading it
   * at `story` density asserted something else by accident: that a step survived
   * the density filter, which is a fact about the trajectory. `upkeep` did
   * survive once, stopped surviving when a kernel commit moved the game onto a
   * line where nothing happens in anyone's upkeep, and failed here, having never
   * been about the naming the test is named for. A step whose only events are
   * priority passes is exactly what `story` density exists to drop.
   *
   * The emptiness property is the one that does belong at `story` density, and
   * the subset check keeps the two honest: a story heading has to be a word the
   * full log also prints, so the filter can drop a step but never rename one.
   */
  it('names its steps in the kernel words, and draws no empty step at story density', () => {
    const everything = buildLog({ events: EVENTS, names: NAMES, viewer: 0, density: 'everything' });
    const printed = new Set(everything.flatMap((turn) => turn.steps.map((step) => step.title)));
    expect(printed).toContain('precombat main');
    expect(printed).toContain('upkeep');

    const titles = new Set(turns.flatMap((turn) => turn.steps.map((step) => step.title)));
    for (const title of titles) expect(printed).toContain(title);
    for (const turn of turns) {
      for (const step of turn.steps) expect(step.lines.length).toBeGreaterThan(0);
    }
  });

  it('keeps an empty step at full density, because there the count has to close', () => {
    const everything = buildLog({ events: EVENTS, names: NAMES, viewer: 0, density: 'everything' });
    const steps = everything.flatMap((turn) => turn.steps);
    expect(steps.length).toBeGreaterThanOrEqual(countOf('stepBegan'));
  });

  it('puts the opening hands ahead of the first turn rather than inside it', () => {
    const opening = turns[0]?.steps[0];
    expect(opening?.title).toBe('opening hands');
    expect(opening?.lines[0]?.text).toMatch(/plays? first \(seed /);
  });
});

/**
 * Two people at one screen, which is where the log can leak.
 *
 * The rule under test is `visibility.ts`'s: a card's identity is public exactly
 * when it has been in a public zone (CR 400.2), so a draw and a mulligan's
 * bottoming are private and a discard and a mill are not. Both directions are
 * checked, because a redaction that hid every card from everybody would pass a
 * one-sided test and make the log useless.
 */
describe('a log the other seat may read', () => {
  const asZero = buildLog({ events: EVENTS, names: LIVE_NAMES, viewer: 0, density: 'everything' });
  const asOne = buildLog({ events: EVENTS, names: LIVE_NAMES, viewer: 1, density: 'everything' });
  const zeroLines = allLines(asZero);
  const oneLines = allLines(asOne);

  it('narrates the same number of lines to both seats, so a hidden card is redacted and not dropped', () => {
    expect(zeroLines.length).toBe(oneLines.length);
    expect(zeroLines.length).toBeGreaterThan(0);
  });

  it('differs between the seats exactly where the kernel says the knowledge is private', () => {
    const events = EVENTS.filter((event: GameEvent) => eventRole(event) !== 'heading');
    expect(events.length).toBe(zeroLines.length);
    for (const [at, event] of events.entries()) {
      const differs = zeroLines[at] !== oneLines[at];
      const owner = privateTo(event);
      // A private event whose sentence happens to name no card reads the same to
      // both seats, which is correct and is why this is one-directional: every
      // line that differs is a private one.
      if (differs) expect(owner).not.toBeNull();
    }
  });

  it('hides the card the other seat drew, and shows the seat its own', () => {
    const draws = EVENTS.filter((event: GameEvent) => event.type === 'cardDrawn');
    expect(draws.length).toBeGreaterThan(10);
    let hiddenFromZero = 0;
    let shownToZero = 0;
    const events = EVENTS.filter((event: GameEvent) => eventRole(event) !== 'heading');
    for (const [at, event] of events.entries()) {
      if (event.type !== 'cardDrawn') continue;
      const line = zeroLines[at] ?? '';
      const real = nameOf(SESSION.state, event.oid);
      if (event.player === 0) {
        expect(line).toContain(real);
        shownToZero += 1;
      } else {
        expect(line).toContain(HIDDEN_CARD);
        expect(line).not.toContain(real);
        hiddenFromZero += 1;
      }
    }
    // Both halves really happened, or one of the two expectations above never ran.
    expect(hiddenFromZero).toBeGreaterThan(5);
    expect(shownToZero).toBeGreaterThan(5);
  });

  it('leaves a public zone movement readable to both seats', () => {
    const events = EVENTS.filter((event: GameEvent) => eventRole(event) !== 'heading');
    let publicMoves = 0;
    for (const [at, event] of events.entries()) {
      if (event.type !== 'zoneChanged') continue;
      if (event.from === 'library' || event.from === 'hand') {
        if (event.to === 'library' || event.to === 'hand') continue;
      }
      expect(namesVisibleTo(event, 0)).toBe(true);
      expect(zeroLines[at]).toBe(oneLines[at]);
      publicMoves += 1;
    }
    expect(publicMoves).toBeGreaterThan(0);
  });

  /**
   * The one event that is public against the zone rule rather than because of
   * it. The cards are still in a hand, and CR 701.16a says both players saw
   * them; a redacted reveal would print a spell doing nothing at all.
   */
  it('shows a revealed hand to both seats even though the cards are still in it', () => {
    const event: GameEvent = { type: 'handRevealed', player: 1, oids: ['o1'] };
    expect(privateTo(event)).toBeNull();
    expect(namesVisibleTo(event, 0)).toBe(true);
    expect(namesVisibleTo(event, 1)).toBe(true);
  });

  it('never hides a player name, because the opposing status line prints one', () => {
    for (const line of zeroLines) expect(line).not.toContain(`${HIDDEN_CARD} draws`);
    expect(zeroLines.some((line) => line.startsWith('Bot '))).toBe(true);
  });
});

/**
 * The same rule through the rendered surface, from both seats.
 *
 * `test/play/play.test.ts` proves the opposing *hand* is face-down; this is the
 * second place the same secret can escape, and it escapes as text rather than as
 * a card face, so it needs its own assertion against the panel's own words.
 */
describe('the rendered log on a hotseat table', () => {
  const HOTSEAT = ['Player one', 'Player two'] as const;

  function openLog(): ReturnType<typeof screen.getByRole> {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${GAME_LOG_LABEL},`) }));
    return screen.getByRole('region', { name: GAME_LOG_LABEL });
  }

  function renderAt(seat: PlayerId): { readonly choices: readonly number[] } {
    const game = dealMirrorGame(EXAMPLE_CARDS, { opponent: 'human' });
    let session = createSession(game.config.setup, game.config.seats);
    const choices: number[] = [];
    // Far enough in that both seats have drawn, cast and taken damage.
    while (session.pending !== null && choices.length < 120) {
      if (session.pending.player === seat && choices.length > 40) break;
      choices.push(0);
      session = choose(session, 0);
    }
    render(h(PlayRoute, { config: { ...game.config, choices, autoPass: FULL_CONTROL } }));
    return { choices };
  }

  it('opens from a control that names itself and its size', () => {
    renderAt(0);
    const head = screen.getByRole('button', { name: new RegExp(`^${GAME_LOG_LABEL}, \\d+ entr`) });
    expect(attr(head, 'aria-expanded')).toBe('false');
    fireEvent.click(head);
    expect(attr(head, 'aria-expanded')).toBe('true');
    expect(screen.getByRole('region', { name: GAME_LOG_LABEL })).toBeTruthy();
  });

  it('says the other seat drew a card, and never says which', () => {
    for (const seat of [0, 1] as const) {
      cleanup();
      renderAt(seat);
      const other = seat === 0 ? 1 : 0;
      const shown = text(openLog());
      expect(shown).toContain(`${HOTSEAT[other]} draws ${HIDDEN_CARD}.`);
      expect(shown).toContain(`${HOTSEAT[seat]} draws `);
      // The negative, in the words the leak would take: a draw line naming a
      // card is a draw line the viewer is not entitled to unless it is theirs.
      const drawn = [...shown.matchAll(new RegExp(`${HOTSEAT[other]} draws ([^.]+)\\.`, 'g'))].map(
        (found) => found[1] ?? '',
      );
      expect(new Set(drawn)).toEqual(new Set([HIDDEN_CARD]));
      expect(drawn.length).toBeGreaterThan(0);
    }
  });

  /**
   * The three levels through the rendered control, which is the surface the bead
   * was written against: two settings meant "179 hidden" or "nothing hidden" and
   * no way to ask for anything between them.
   */
  it('offers three levels, each showing strictly more than the one below', () => {
    renderAt(0);
    const panel = openLog();
    const shown = (): number =>
      within(screen.getByRole('region', { name: GAME_LOG_LABEL })).queryAllByRole('listitem').length;

    const group = screen.getByRole('group', { name: DENSITY_GROUP_LABEL });
    expect(within(group).getAllByRole('button').length).toBe(3);
    expect(within(panel).queryAllByRole('listitem').length).toBe(shown());
    const counts: number[] = [];
    for (const level of ['story', 'detail', 'everything'] as const) {
      fireEvent.click(screen.getByRole('button', { name: DENSITY_LABELS[level] }));
      counts.push(shown());
      expect(attr(screen.getByRole('button', { name: DENSITY_LABELS[level] }), 'aria-pressed')).toBe('true');
    }
    const [story = 0, detail = 0, everything = 0] = counts;
    expect(detail).toBeGreaterThan(story);
    expect(everything).toBeGreaterThan(detail);
  });

  it('says how much it is holding back, and holds nothing back at the top', () => {
    renderAt(0);
    openLog();
    const hidden = text(screen.getByText(/\d+ hidden/));
    expect(Number(hidden.split(' ')[0])).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: DENSITY_LABELS.detail }));
    expect(Number(text(screen.getByText(/\d+ hidden/)).split(' ')[0])).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: EVERY_EVENT_LABEL }));
    expect(screen.getByText('nothing hidden')).toBeTruthy();
  });

  it('leaves the legal-move rail exactly where it was', () => {
    renderAt(0);
    openLog();
    expect(screen.queryByRole('group', { name: 'Legal moves' })).not.toBeNull();
  });
});

/**
 * The live region, and the reason it is shaped the way it is.
 *
 * A burst on this surface is twenty to forty entries; a polite region over the
 * list would queue and read every one of them, and `role="log"` with
 * `aria-live="off"` is not the escape hatch it looks like — ARIA defines `off` as
 * "unless the user is currently focused on that region", and this panel is
 * focusable so that a keyboard can scroll it at all. `GameLog.ts` carries the
 * whole argument and its sources. What is checkable here is that the list is a
 * named, focusable, non-live region, that its structure is navigable, and that the
 * digest exists whether or not the panel is open — a live region added to the
 * document at the same moment its text changes announces nothing.
 */
describe('the log is navigable rather than announced', () => {
  it('is a named focusable region rather than a live one, with headings inside it', () => {
    render(
      h(PlayRoute, {
        config: {
          ...dealMirrorGame(EXAMPLE_CARDS, {}).config,
          choices: [0, 0, 0, 0],
          autoPass: FULL_CONTROL,
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${GAME_LOG_LABEL},`) }));
    const panel = screen.getByRole('region', { name: GAME_LOG_LABEL });
    // Not a live region at all: the digest below is what announces.
    expect(attr(panel, 'aria-live')).toBeNull();
    expect(attr(panel, 'tabindex')).toBe('0');
    // Headings are how a screen reader walks a five-hundred-entry history, so
    // the turn and step titles are headings rather than styled spans.
    expect(within(panel).queryAllByRole('heading').length).toBeGreaterThan(2);
  });

  it('carries the newest line in a status region, open or shut', () => {
    render(
      h(PlayRoute, {
        config: {
          ...dealMirrorGame(EXAMPLE_CARDS, {}).config,
          choices: [0, 0, 0, 0],
          autoPass: FULL_CONTROL,
        },
      }),
    );
    const shut = screen.getByRole('status', { name: GAME_LOG_STATUS_LABEL });
    // The entry number is what makes two identical events in a row two
    // announcements rather than one; GameLog.ts carries why.
    expect(text(shut)).toMatch(/^Log entry \d+: .+\.$/);
    expect(attr(shut, 'aria-live')).toBe('polite');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${GAME_LOG_LABEL},`) }));
    expect(text(screen.getByRole('status', { name: GAME_LOG_STATUS_LABEL }))).toMatch(/^Log entry \d+: /);
  });
});

/**
 * Newest-visible, as a cascade declaration.
 *
 * jsdom lays nothing out, so no assertion here is a pixel; the measured numbers
 * are in `styles/board/log.ts` and in this change's commit message. What is
 * checkable is the rule the behavior is made of, which is one declaration: a
 * `column-reverse` scroller is anchored at its bottom, so the panel opens on the
 * newest line and appending to it does not move a reader who has scrolled back.
 */
describe('the panel is anchored at its newest end', () => {
  const CSS = uiStyleSheet();
  const panel = CSS.match(/\.mtg-log__panel \{[^}]*\}/)?.[0] ?? '';

  it('declares the reversed column and the overflow that makes it a scroller', () => {
    expect(panel).toContain('flex-direction: column-reverse');
    expect(panel).toContain('overflow-y: auto');
    expect(panel).toContain('min-height: 0');
  });

  /**
   * The declaration that must stay absent. In a reversed column `flex-end` is the
   * top of the box, and putting the content there puts the overflow on the start
   * side, which Chrome does not make scrollable: measured at all three viewports
   * the panel reported `scrollHeight === clientHeight` and the newest 3178px were
   * unreachable. `styles/board/log.ts` carries the numbers.
   */
  it('does not pack the content against the top, which would make the newest end unreachable', () => {
    expect(panel).not.toContain('justify-content');
  });

  it('gives an opened log the rail the floored blocks are not using', () => {
    // The cap was 40% while the move list shared this column and had nowhere
    // else to go; `mtg-rgc.4` moved the list to the pod column, so the only
    // siblings left are the stack and the two graveyards, each floored at its own
    // head and capped at 30%, and the log takes the rest.
    expect(CSS).toMatch(/\.mtg-board__rail > \.mtg-log\[data-open='true'\] \{[^}]*flex: 1 1 auto/);
    expect(CSS).toMatch(/\.mtg-board__rail > \.mtg-log\[data-open='true'\] \{[^}]*max-height: 100%/);
    expect(CSS).toMatch(/\.mtg-board__rail > \.mtg-zone \{[^}]*max-height: 30%/);
    // And the panel's own 22rem cap comes off with it, so a block that was just
    // given 589px does not draw 352px of log and 237px of nothing.
    expect(CSS).toMatch(/\.mtg-board__rail > \.mtg-log > \.mtg-log__panel \{ max-height: none; \}/);
  });

  it('keeps the digest out of the pixels without taking it out of the tree', () => {
    const hidden = CSS.match(/\.mtg-sr-only \{[^}]*\}/)?.[0] ?? '';
    expect(hidden).toContain('clip-path: inset(50%)');
    expect(hidden).not.toContain('display: none');
    expect(hidden).not.toContain('visibility: hidden');
  });
});
