/**
 * The event log the Replay tab reads, recorded on the way to opening the lab.
 *
 * `stage-art.ts` copies rasters and `stage-symbols.ts` fetches symbols; this
 * one has nothing to fetch, because the producer is in this repository. Three
 * bot games are played through the kernel and written where the page can
 * fetch them, which takes about a fifth of a second.
 *
 * Recorded every run rather than committed, and that is the point rather than a
 * saving: a recorded game is about a megabyte, and a committed one is a
 * megabyte that goes quietly wrong the first time the kernel changes how a game
 * plays. The seeds are pinned, so the file is a pure function of these three
 * lines and the engine as it stands in this checkout — it cannot be stale, and
 * two runs of `npm run play` a month apart show the same three games unless the
 * engine moved, in which case they show what it does now.
 *
 * # Which decks, and why it is no longer the fixture ones
 *
 * It used to be `@mtg/sim`'s fixture decks whatever set the lab had opened, on
 * the argument that building a deck out of a generated set is `@mtg/deckbuild`'s
 * decision and not this file's. That argument survives; the premise stopped
 * being true. The launcher now stages *written* decks beside the set
 * (`stage-precons.ts`), and it has already refused any file naming a card this
 * set does not print — so playing them here is not a second silent decision, it
 * is the same one, and `buildPrecon` does the building either way.
 *
 * What the fixture decks cost was the tab itself. They are built from the DSL
 * example cards, whose ids begin `slc-`, and no art manifest on this machine
 * carries one: the launcher scored manifests by how many of the set's ids they
 * covered, staged the winner, and then handed the Replay tab a game whose every
 * face resolved to nothing. A recorded game and the live board showed the same
 * permanents, one painted and one hatched.
 *
 * The fixture decks remain the fallback, for a set nobody has written decks
 * for, and the launcher says which it recorded — three games of another card
 * pool is a fine thing to watch the engine resolve and a poor thing to mistake
 * for this set.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Card } from '@mtg/dsl';
import { buildPrecon } from '@mtg/deckbuild';
import type { PreconDeck, PreconFile } from '@mtg/deckbuild';
import type { DeckList } from '@mtg/kernel';
import { FIXTURE_DECK_GW, FIXTURE_DECK_RW, FIXTURE_DECK_UB, greedyBot } from '@mtg/sim';
import { recordGame, writeEventLog } from './record-replay';
import type { RecordGameOptions } from './record-replay';

/** The file name the page fetches, staged into `packages/ui/public/`. */
export const EVENT_LOG_FILENAME = 'replay.events.jsonl';

/**
 * Three pinned games, chosen for what a reader can see in them rather than at
 * random: three different matchups, both seats winning one, and none of them so
 * long that the turn rail stops fitting. Every one is decided — a game that
 * ends on the turn cap is a real outcome and the test fixture holds one, but it
 * is a poor thing to open the lab on.
 */
export const LAB_GAMES: readonly RecordGameOptions[] = [
  {
    index: 0,
    seed: 'lab/v1/RW-UB/1',
    decks: [FIXTURE_DECK_RW, FIXTURE_DECK_UB],
    agents: [greedyBot('greedy-rw'), greedyBot('greedy-ub')],
    startingPlayer: 0,
    maximumTurns: 40,
  },
  {
    index: 1,
    seed: 'lab/v1/GW-UB/3',
    decks: [FIXTURE_DECK_GW, FIXTURE_DECK_UB],
    agents: [greedyBot('greedy-gw'), greedyBot('greedy-ub')],
    startingPlayer: 0,
    maximumTurns: 40,
  },
  {
    index: 2,
    // Re-picked from /2 on 2026-08-17: the mulligan policy gained a castability
    // term, every seeded lab game moved with it, and all three staged games
    // started ending the same way round. This seat wins here, so the lab still
    // opens on a log that shows both seats winning something.
    seed: 'lab/v1/RW-GW/4',
    decks: [FIXTURE_DECK_RW, FIXTURE_DECK_GW],
    agents: [greedyBot('greedy-rw'), greedyBot('greedy-gw')],
    startingPlayer: 0,
    maximumTurns: 40,
  },
];

/** How many games the lab opens on, whichever decks play them. */
const LAB_GAME_COUNT = LAB_GAMES.length;

/**
 * How many seeds a matchup is given to produce a decided game.
 *
 * `LAB_GAMES` could pin decided games because somebody looked at them; a deal
 * off whatever set is being played cannot. A seed is ~60ms, so the launcher can
 * afford to try again — and when every attempt hits the turn cap that is a real
 * fact about these two decks, so the last one is kept and reported rather than
 * hidden.
 */
const SEED_ATTEMPTS = 3;

/**
 * The set being played and the decks written for it.
 *
 * Both, or neither: a set with no precon file is recorded from the fixture
 * decks, because inventing a deck list is the decision this file is still not
 * making. `@mtg/deckbuild` refuses a list naming a card the set does not print,
 * which is the same check `choosePreconFile` has already run.
 */
export interface LabDeal {
  readonly setCode: string;
  readonly cards: readonly Card[];
  readonly precons: PreconFile;
}

export interface StagedEventLog {
  readonly path: string;
  readonly games: number;
  readonly steps: number;
  readonly bytes: number;
  /** What the games were played with, named in the launcher's line. */
  readonly source: string;
  /** One line per game, for the launcher to print. */
  readonly lines: readonly string[];
}

function outcomeOf(game: ReturnType<typeof recordGame>): string {
  const { result, seed, seats } = game.game;
  const winner = result.winner === null ? 'a draw' : `${seats[result.winner].deck} wins`;
  return (
    `${seats[0].deck} vs ${seats[1].deck} (${seed}): ` +
    `${String(game.steps.length)} decisions over ${String(result.endedOnTurn)} turns, ${winner}`
  );
}

/**
 * The matchups a set's own decks are dealt into.
 *
 * Walks the list two at a time and wraps, so five decks show all five over
 * three games and a two-deck set plays its one matchup three times under three
 * seeds. Index-driven rather than sampled: the schedule is part of what makes
 * the file a pure function of the set.
 */
function matchupsOf(
  decks: readonly PreconDeck[],
  games: number,
): readonly (readonly [PreconDeck, PreconDeck])[] {
  const pairs: (readonly [PreconDeck, PreconDeck])[] = [];
  for (let index = 0; index < games; index += 1) {
    const first = decks[(index * 2) % decks.length];
    const second = decks[(index * 2 + 1) % decks.length];
    if (first === undefined || second === undefined) throw new Error('a precon file with no decks');
    pairs.push([first, second]);
  }
  return pairs;
}

function deckListOf(deck: PreconDeck, cards: readonly Card[]): DeckList {
  return { name: deck.name, cards: buildPrecon(deck, cards).deck };
}

/** The games a set's own decks play, one decided game per matchup where there is one. */
function dealtGames(deal: LabDeal): readonly RecordGameOptions[] {
  const lists = new Map<string, DeckList>();
  const listFor = (deck: PreconDeck): DeckList => {
    const built = lists.get(deck.id) ?? deckListOf(deck, deal.cards);
    lists.set(deck.id, built);
    return built;
  };
  return matchupsOf(deal.precons.decks, LAB_GAME_COUNT).map(([first, second], index) => ({
    index,
    seed: `lab/v2/${deal.setCode}/${first.id}-${second.id}/${String(index + 1)}`,
    decks: [listFor(first), listFor(second)] as const,
    agents: [greedyBot(`greedy-${first.id}`), greedyBot(`greedy-${second.id}`)] as const,
    startingPlayer: 0,
    maximumTurns: 40,
  }));
}

/**
 * Records one matchup, retrying its seed until the game is decided.
 *
 * The seed carries the attempt, so a game that ends on the turn cap is followed
 * by a different game rather than the same one; the last attempt is returned
 * whatever it ended in.
 */
function recordDecided(options: RecordGameOptions): ReturnType<typeof recordGame> {
  let last = recordGame(options);
  for (let attempt = 2; attempt <= SEED_ATTEMPTS; attempt += 1) {
    if (last.game.result.reason !== 'turnLimit') return last;
    last = recordGame({ ...options, seed: `${options.seed}/${String(attempt)}` });
  }
  return last;
}

/**
 * Records the lab's games and writes them to `path`.
 *
 * Deterministic in the seeds, and with a deal, in the set and its decks as
 * well: the same checkout at the same revision writes the same bytes.
 */
export function stageEventLog(path: string, deal?: LabDeal): StagedEventLog {
  const recorded =
    deal === undefined
      ? LAB_GAMES.map((options) => recordGame(options))
      : dealtGames(deal).map((options) => recordDecided(options));
  const text = writeEventLog(EVENT_LOG_FILENAME, recorded);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
  return {
    path,
    games: recorded.length,
    steps: recorded.reduce((total, game) => total + game.steps.length, 0),
    bytes: text.length,
    source:
      deal === undefined
        ? 'the DSL example decks, because this set has no written decks — their cards are not in its art'
        : `${deal.setCode}’s own preconstructed decks`,
    lines: recorded.map((game) => outcomeOf(game)),
  };
}

/** What the launcher prints about the staged log. */
export function describeEventLog(staged: StagedEventLog): string {
  const head =
    `Recorded ${String(staged.games)} bot games for the Replay tab from ${staged.source} ` +
    `(${String(staged.steps)} decisions, ${String(Math.round(staged.bytes / 1024))} KB).`;
  return [head, ...staged.lines.map((line) => `  - ${line}`)].join('\n');
}
