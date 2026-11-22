import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePrintedConstructedFormat } from '@mtg/printed-card';
import {
  allPairings,
  parsePairArg,
  remainingPairings,
  resolvePairings,
} from '../tools/commander-head-to-head/pairings';
import { renderCommanderDeckFile, forgeDeckFileName } from '../tools/commander-head-to-head/deck-file';
import {
  parseGameOutcomes,
  sinceSimulationStart,
  type ParsedGame,
} from '../tools/commander-head-to-head/transcript';
import { recordGames, shareOf, tallyOverall, tallyPairing } from '../tools/commander-head-to-head/tally';
import { pairingSeed } from '../tools/commander-head-to-head/seed';
import {
  CommanderHeadToHeadGameRecordSchema,
  parseCommanderHeadToHeadResults,
  type CommanderHeadToHeadGameRecord,
} from '../tools/commander-head-to-head/schema';

const ROOT = resolve(import.meta.dirname, '../../..');
const FORMAT_PATH = resolve(
  ROOT,
  'packages/data/data/commander-precons/commander-precons-constructed-format-v1.json',
);
const format = parsePrintedConstructedFormat(JSON.parse(readFileSync(FORMAT_PATH, 'utf8')));
const deckIds = format.decks.map((deck) => deck.id);

const FIXTURES_DIR = resolve(import.meta.dirname, 'fixtures/commander-head-to-head');

function fixtureGames(name: string): readonly ParsedGame[] {
  const text = readFileSync(resolve(FIXTURES_DIR, name), 'utf8');
  return parseGameOutcomes(sinceSimulationStart(text));
}

describe('deck-file', () => {
  it('renders a commander deck in Forge .dck grammar, naming the deck by its id', () => {
    const deck = format.decks.find((candidate) => candidate.id === 'chaos-incarnate');
    if (deck === undefined) throw new Error('fixture deck missing');
    const body = renderCommanderDeckFile(deck, format.sources);
    expect(body.startsWith('[metadata]\nName=chaos-incarnate\n[Commander]\n')).toBe(true);
    expect(body).toContain('\n[Main]\n');
    expect(deck.commanders).toHaveLength(1);
    for (const slot of deck.commanders) {
      expect(body).toContain(`${String(slot.count)} ${slot.name}|`);
    }
    for (const slot of deck.cards) {
      expect(body).toContain(`${String(slot.count)} ${slot.name}|`);
    }
  });

  it('passes a split card name through unchanged, with no name-based rewrite', () => {
    const deck = format.decks.find((candidate) => candidate.id === 'invent-superiority');
    if (deck === undefined) throw new Error('fixture deck missing');
    const body = renderCommanderDeckFile(deck, format.sources);
    expect(body).toContain('1 Trial // Error|C16');
  });

  it('rejects a physical id whose catalog has no declared source', () => {
    const deck = format.decks[0];
    if (deck === undefined) throw new Error('fixture deck missing');
    const broken = { ...deck, cards: [{ physicalId: 'unknown-catalog:0001:x', name: 'Nothing', count: 1 }] };
    expect(() => renderCommanderDeckFile(broken, format.sources)).toThrow(/no source/);
  });

  it('names the deck file after the deck id', () => {
    const deck = format.decks[0];
    if (deck === undefined) throw new Error('fixture deck missing');
    expect(forgeDeckFileName(deck)).toBe(`${deck.id}.dck`);
  });
});

describe('pairings', () => {
  it('enumerates every unordered pair of the precon decks', () => {
    expect(allPairings(deckIds)).toHaveLength((deckIds.length * (deckIds.length - 1)) / 2);
  });

  it('never pairs a deck against itself and never repeats a pair', () => {
    const pairs = allPairings(['x', 'y', 'z']);
    expect(pairs).toEqual([
      { a: 'x', b: 'y' },
      { a: 'x', b: 'z' },
      { a: 'y', b: 'z' },
    ]);
  });

  it('parses an explicit --pair argument', () => {
    expect(parsePairArg('chaos-incarnate:grave-danger')).toEqual({
      a: 'chaos-incarnate',
      b: 'grave-danger',
    });
  });

  it('rejects a malformed --pair argument', () => {
    expect(() => parsePairArg('chaos-incarnate')).toThrow();
    expect(() => parsePairArg('chaos-incarnate:grave-danger:extra')).toThrow();
    expect(() => parsePairArg(':grave-danger')).toThrow();
    expect(() => parsePairArg('chaos-incarnate:')).toThrow();
  });

  it('resolves to the full matrix when no explicit pairing is given', () => {
    expect(resolvePairings(['x', 'y'], [])).toEqual([{ a: 'x', b: 'y' }]);
  });

  it('resolves explicit pairings as given, after validating both decks exist', () => {
    const explicit = [{ a: 'x', b: 'y' }];
    expect(resolvePairings(['x', 'y', 'z'], explicit)).toBe(explicit);
    expect(() => resolvePairings(['x', 'y'], [{ a: 'x', b: 'missing' }])).toThrow(/unknown deck/);
    expect(() => resolvePairings(['x', 'y'], [{ a: 'x', b: 'x' }])).toThrow(/against itself/);
  });

  it('drops already-finished pairings for --resume', () => {
    const all = allPairings(['x', 'y', 'z']);
    const done = [{ a: 'x', b: 'y' }];
    expect(remainingPairings(all, done)).toEqual([
      { a: 'x', b: 'z' },
      { a: 'y', b: 'z' },
    ]);
  });
});

describe('parseGameOutcomes (real Forge transcripts)', () => {
  it('reads play order, turn, and winner off a seeded three-game non-quiet run', () => {
    expect(fixtureGames('seed-20261011-three-games.txt')).toEqual([
      { game: 1, turn: 11, durationMs: 22253, firstSeat: 2, outcome: 'win', winnerSeat: 1 },
      { game: 2, turn: 11, durationMs: 1759, firstSeat: 2, outcome: 'win', winnerSeat: 1 },
      { game: 3, turn: 8, durationMs: 1537, firstSeat: 2, outcome: 'win', winnerSeat: 1 },
    ]);
  });

  it('reports no play order in quiet mode, but agrees with the non-quiet run on every winner and turn', () => {
    const quiet = fixtureGames('seed-20261011-three-games-quiet.txt');
    expect(quiet).toEqual([
      { game: 1, turn: 11, durationMs: 24337, firstSeat: null, outcome: 'win', winnerSeat: 1 },
      { game: 2, turn: 11, durationMs: 1995, firstSeat: null, outcome: 'win', winnerSeat: 1 },
      { game: 3, turn: 8, durationMs: 1623, firstSeat: null, outcome: 'win', winnerSeat: 1 },
    ]);
    const nonQuiet = fixtureGames('seed-20261011-three-games.txt');
    expect(quiet.map((game) => [game.winnerSeat, game.turn])).toEqual(
      nonQuiet.map((game) => [game.winnerSeat, game.turn]),
    );
  });

  it('records a game the clock stopped as a clock draw, even though Forge prints "has won!" for it', () => {
    expect(fixtureGames('clock-one-second-two-games-quiet.txt')).toEqual([
      { game: 1, turn: 5, durationMs: 1040, firstSeat: null, outcome: 'clock-draw', winnerSeat: null },
      { game: 2, turn: 7, durationMs: 1000, firstSeat: null, outcome: 'clock-draw', winnerSeat: null },
    ]);
  });

  it.each([
    ['seed-1-one-game.txt', 1, 13, 4358, 2],
    ['seed-2-one-game.txt', 1, 8, 2349, 1],
    ['seed-3-one-game.txt', 2, 8, 2591, 1],
    ['seed-4-one-game.txt', 2, 14, 7833, 1],
    ['seed-5-one-game.txt', 1, 12, 4146, 1],
    ['seed-6-one-game.txt', 2, 14, 5242, 1],
  ] as const)('reads play order and winner from %s', (file, firstSeat, turn, durationMs, winnerSeat) => {
    expect(fixtureGames(file)).toEqual([
      { game: 1, turn, durationMs, firstSeat, outcome: 'win', winnerSeat },
    ]);
  });

  it('counts a loss to commander damage, which Forge words "has lost due to", as the other seat winning', () => {
    expect(fixtureGames('commander-damage-loss.txt')).toEqual([
      { game: 9, turn: 8, durationMs: 740, firstSeat: null, outcome: 'win', winnerSeat: 2 },
    ]);
  });

  it('reads a play order for every game of an unseeded non-quiet run, not the same seat each time', () => {
    expect(fixtureGames('unseeded-three-games.txt')).toEqual([
      { game: 1, turn: 9, durationMs: 3258, firstSeat: 1, outcome: 'win', winnerSeat: 1 },
      { game: 2, turn: 10, durationMs: 2323, firstSeat: 2, outcome: 'win', winnerSeat: 1 },
      { game: 3, turn: 9, durationMs: 1230, firstSeat: 2, outcome: 'win', winnerSeat: 1 },
    ]);
  });

  it('reports no play order for any game in an unseeded quiet run', () => {
    expect(fixtureGames('unseeded-four-games-quiet.txt')).toEqual([
      { game: 1, turn: 10, durationMs: 3292, firstSeat: null, outcome: 'win', winnerSeat: 1 },
      { game: 2, turn: 10, durationMs: 1314, firstSeat: null, outcome: 'win', winnerSeat: 1 },
      { game: 3, turn: 10, durationMs: 3502, firstSeat: null, outcome: 'win', winnerSeat: 1 },
      { game: 4, turn: 13, durationMs: 2143, firstSeat: null, outcome: 'win', winnerSeat: 1 },
    ]);
  });

  it('never reports a play order for a quiet-mode fixture, and always reports one for a non-quiet fixture', () => {
    const quietFixtures = [
      'seed-20261011-three-games-quiet.txt',
      'unseeded-four-games-quiet.txt',
      'clock-one-second-two-games-quiet.txt',
    ];
    const nonQuietFixtures = [
      'seed-20261011-three-games.txt',
      'seed-1-one-game.txt',
      'seed-2-one-game.txt',
      'seed-3-one-game.txt',
      'seed-4-one-game.txt',
      'seed-5-one-game.txt',
      'seed-6-one-game.txt',
      'unseeded-three-games.txt',
    ];
    for (const file of quietFixtures) {
      expect(fixtureGames(file).every((game) => game.firstSeat === null)).toBe(true);
    }
    for (const file of nonQuietFixtures) {
      expect(fixtureGames(file).every((game) => game.firstSeat !== null)).toBe(true);
    }
  });
});

describe('parseGameOutcomes (malformed input)', () => {
  it('throws on two "has won" lines with no "Stopping slow match as draw" line, a shape no fixture here shows Forge printing', () => {
    const text = [
      'Game Outcome: Turn 5',
      'Game Outcome: Ai(1)-Draconic Domination [C17] [2017] has won because all opponents have lost',
      'Game Outcome: Ai(2)-Heavenly Inferno [CMA] [2017] has won because all opponents have lost',
      'Match Result: Ai(1)-Draconic Domination [C17] [2017]: 1 Ai(2)-Heavenly Inferno [CMA] [2017]: 0 ',
      'Game Result: Game 1 ended in 1040 ms. Ai(1)-Draconic Domination [C17] [2017] has won!',
    ].join('\n');
    expect(() => parseGameOutcomes(text)).toThrow('is neither a clean win, a rules draw, nor a clock draw');
  });

  it('throws, quoting the line, on an unrecognized "Game Result:" line', () => {
    const text = 'Game Result: something unexpected happened';
    expect(() => parseGameOutcomes(text)).toThrow(
      'unrecognized "Game Result:" line: Game Result: something unexpected happened',
    );
  });

  it('throws when a game block carries more than one "Turn: Turn 1" line', () => {
    const text = [
      'Turn: Turn 1 (Ai(1)-Draconic Domination [C17] [2017])',
      'Turn: Turn 1 (Ai(2)-Heavenly Inferno [CMA] [2017])',
      'Game Result: Game 1 ended in 1000 ms. Ai(1)-Draconic Domination [C17] [2017] has won!',
    ].join('\n');
    expect(() => parseGameOutcomes(text)).toThrow('has more than one "Turn: Turn 1" line');
  });

  it('drops a trailing block that never reached a "Game Result:" line, as happens when Forge is killed mid-game', () => {
    const text = ['Game Outcome: Turn 3', 'Turn: Turn 1 (Ai(1)-Draconic Domination [C17] [2017])'].join('\n');
    expect(parseGameOutcomes(text)).toEqual([]);
  });
});

describe('sinceSimulationStart', () => {
  it('drops the card-database boot log that precedes every Forge sim run', () => {
    const text = [
      'Read cards: 33617 archived files in 0 ms (25 parts) using thread pool',
      'The card A-Goldspan Dragon was not assigned to any set. Adding it to UNKNOWN set... to fix see res/editions/ folder. ',
      'Simulation mode',
      'Ai(1)-chaos-incarnate vs Ai(2)-grave-danger - one game of Commander',
    ].join('\n');
    expect(sinceSimulationStart(text)).toBe(
      ['Simulation mode', 'Ai(1)-chaos-incarnate vs Ai(2)-grave-danger - one game of Commander'].join('\n'),
    );
  });

  it('returns the whole text unchanged when there is no simulation marker to find', () => {
    expect(sinceSimulationStart('nothing relevant here')).toBe('nothing relevant here');
  });
});

describe('recordGames', () => {
  it('maps winner and play order back to a or b depending on which deck was listed first', () => {
    const parsed: readonly ParsedGame[] = [
      { game: 1, turn: 10, durationMs: 100, firstSeat: 1, outcome: 'win', winnerSeat: 1 },
      { game: 2, turn: 12, durationMs: 200, firstSeat: 2, outcome: 'win', winnerSeat: 2 },
      { game: 3, turn: null, durationMs: 300, firstSeat: 1, outcome: 'rules-draw', winnerSeat: null },
    ];
    expect(recordGames(parsed, 'a')).toEqual([
      { game: 1, listedFirst: 'a', playedFirst: 'a', outcome: 'win', winner: 'a', turn: 10, durationMs: 100 },
      { game: 2, listedFirst: 'a', playedFirst: 'b', outcome: 'win', winner: 'b', turn: 12, durationMs: 200 },
      {
        game: 3,
        listedFirst: 'a',
        playedFirst: 'a',
        outcome: 'rules-draw',
        winner: null,
        turn: null,
        durationMs: 300,
      },
    ]);
    expect(recordGames(parsed, 'b')).toEqual([
      { game: 1, listedFirst: 'b', playedFirst: 'b', outcome: 'win', winner: 'b', turn: 10, durationMs: 100 },
      { game: 2, listedFirst: 'b', playedFirst: 'a', outcome: 'win', winner: 'a', turn: 12, durationMs: 200 },
      {
        game: 3,
        listedFirst: 'b',
        playedFirst: 'b',
        outcome: 'rules-draw',
        winner: null,
        turn: null,
        durationMs: 300,
      },
    ]);
  });

  it('refuses a game with no recorded play order, which runInvocation guarantees never reaches it', () => {
    const parsed: readonly ParsedGame[] = [
      { game: 1, turn: 10, durationMs: 100, firstSeat: null, outcome: 'win', winnerSeat: 1 },
    ];
    expect(() => recordGames(parsed, 'a')).toThrow('has no recorded play order');
  });
});

describe('shareOf', () => {
  it('reports full uncertainty over zero trials', () => {
    expect(shareOf(0, 0)).toEqual({ point: 0, low: 0, high: 1 });
  });

  it('centers near the observed proportion for a healthy sample', () => {
    const share = shareOf(8, 10);
    expect(share.point).toBeCloseTo(0.8);
    expect(share.low).toBeLessThan(0.8);
    expect(share.high).toBeGreaterThan(0.8);
  });
});

describe('tallyPairing', () => {
  it('counts wins, both draw kinds, and splits by who played first, excluding draws from the share', () => {
    const records: readonly CommanderHeadToHeadGameRecord[] = [
      { game: 1, listedFirst: 'a', playedFirst: 'a', outcome: 'win', winner: 'a', turn: 5, durationMs: 100 },
      { game: 2, listedFirst: 'a', playedFirst: 'a', outcome: 'win', winner: 'b', turn: 7, durationMs: 200 },
      { game: 3, listedFirst: 'b', playedFirst: 'b', outcome: 'win', winner: 'b', turn: 9, durationMs: 300 },
      {
        game: 4,
        listedFirst: 'b',
        playedFirst: 'a',
        outcome: 'rules-draw',
        winner: null,
        turn: null,
        durationMs: 400,
      },
    ];
    const pairing = tallyPairing('deck-a', 'deck-b', [11, 22], ['cmd-1', 'cmd-2'], records);
    expect(pairing.games).toBe(4);
    expect(pairing.aWins).toBe(1);
    expect(pairing.bWins).toBe(2);
    expect(pairing.rulesDraws).toBe(1);
    expect(pairing.clockDraws).toBe(0);
    expect(pairing.seeds).toEqual([11, 22]);
    expect(pairing.commands).toEqual(['cmd-1', 'cmd-2']);
    expect(pairing.meanTurns).toBeCloseTo((5 + 7 + 9) / 3);
    expect(pairing.meanMs).toBeCloseTo((100 + 200 + 300 + 400) / 4);
    expect(pairing.aShare?.point).toBeCloseTo(1 / 3);
    expect(pairing.byPlayOrder.aPlayedFirst).toEqual({ games: 3, aWins: 1, bWins: 1 });
    expect(pairing.byPlayOrder.bPlayedFirst).toEqual({ games: 1, aWins: 0, bWins: 1 });
    expect(pairing.aBalancedShare).toBeCloseTo(0.25);
    expect(pairing.gameRecords).toEqual(records);
  });

  it('reports a null share and a null balanced share when every game is a draw', () => {
    const records: readonly CommanderHeadToHeadGameRecord[] = [
      {
        game: 1,
        listedFirst: 'a',
        playedFirst: 'a',
        outcome: 'rules-draw',
        winner: null,
        turn: 40,
        durationMs: 1,
      },
      {
        game: 2,
        listedFirst: 'a',
        playedFirst: 'b',
        outcome: 'clock-draw',
        winner: null,
        turn: null,
        durationMs: 1,
      },
    ];
    const pairing = tallyPairing('deck-a', 'deck-b', [1, 2], ['cmd-1', 'cmd-2'], records);
    expect(pairing.aWins).toBe(0);
    expect(pairing.bWins).toBe(0);
    expect(pairing.rulesDraws).toBe(1);
    expect(pairing.clockDraws).toBe(1);
    expect(pairing.aShare).toBeNull();
    expect(pairing.aBalancedShare).toBeNull();
  });

  it('reports a null mean turn count when no game in the pairing recorded a turn', () => {
    const records: readonly CommanderHeadToHeadGameRecord[] = [
      {
        game: 1,
        listedFirst: 'a',
        playedFirst: 'a',
        outcome: 'clock-draw',
        winner: null,
        turn: null,
        durationMs: 10,
      },
    ];
    const pairing = tallyPairing('deck-a', 'deck-b', [1, 2], ['cmd-1', 'cmd-2'], records);
    expect(pairing.meanTurns).toBeNull();
  });

  it('always partitions the games across win/draw buckets and across the two play-order cells (seeded)', () => {
    let state = 1234567;
    const nextRandom = (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
    for (let trial = 0; trial < 50; trial += 1) {
      const count = 1 + Math.floor(nextRandom() * 10);
      const records: CommanderHeadToHeadGameRecord[] = [];
      for (let game = 1; game <= count; game += 1) {
        const playedFirst: 'a' | 'b' = nextRandom() < 0.5 ? 'a' : 'b';
        const roll = nextRandom();
        const outcome: CommanderHeadToHeadGameRecord['outcome'] =
          roll < 0.6 ? 'win' : roll < 0.8 ? 'rules-draw' : 'clock-draw';
        const winner: 'a' | 'b' | null = outcome === 'win' ? (nextRandom() < 0.5 ? 'a' : 'b') : null;
        records.push({ game, listedFirst: 'a', playedFirst, outcome, winner, turn: null, durationMs: 0 });
      }
      const pairing = tallyPairing('deck-a', 'deck-b', [1, 2], ['cmd-1', 'cmd-2'], records);
      expect(pairing.aWins + pairing.bWins + pairing.rulesDraws + pairing.clockDraws).toBe(pairing.games);
      expect(pairing.byPlayOrder.aPlayedFirst.games + pairing.byPlayOrder.bPlayedFirst.games).toBe(
        pairing.games,
      );
    }
  });
});

describe('tallyOverall', () => {
  it('sums each deck’s wins, losses, and both draw kinds across every pairing it appears in', () => {
    const pairings = [
      tallyPairing(
        'a',
        'b',
        [1, 2],
        ['cmd-1', 'cmd-2'],
        [
          {
            game: 1,
            listedFirst: 'a',
            playedFirst: 'a',
            outcome: 'win',
            winner: 'a',
            turn: 1,
            durationMs: 1,
          },
          {
            game: 2,
            listedFirst: 'a',
            playedFirst: 'b',
            outcome: 'win',
            winner: 'b',
            turn: 1,
            durationMs: 1,
          },
        ],
      ),
      tallyPairing(
        'a',
        'c',
        [3, 4],
        ['cmd-3', 'cmd-4'],
        [
          {
            game: 1,
            listedFirst: 'a',
            playedFirst: 'a',
            outcome: 'rules-draw',
            winner: null,
            turn: 1,
            durationMs: 1,
          },
        ],
      ),
    ];
    const overall = tallyOverall(['a', 'b', 'c'], pairings);
    expect(overall).toEqual([
      { id: 'a', games: 3, wins: 1, losses: 1, rulesDraws: 1, clockDraws: 0, share: shareOf(1, 2) },
      { id: 'b', games: 2, wins: 1, losses: 1, rulesDraws: 0, clockDraws: 0, share: shareOf(1, 2) },
      { id: 'c', games: 1, wins: 0, losses: 0, rulesDraws: 1, clockDraws: 0, share: null },
    ]);
  });
});

describe('pairingSeed', () => {
  it('is deterministic for the same inputs and changes with any input', () => {
    const base = pairingSeed(42, 'chaos-incarnate', 'grave-danger', 'a');
    expect(pairingSeed(42, 'chaos-incarnate', 'grave-danger', 'a')).toBe(base);
    expect(pairingSeed(42, 'chaos-incarnate', 'grave-danger', 'b')).not.toBe(base);
    expect(pairingSeed(43, 'chaos-incarnate', 'grave-danger', 'a')).not.toBe(base);
    expect(pairingSeed(42, 'grave-danger', 'chaos-incarnate', 'a')).not.toBe(base);
  });

  it('always returns a positive 31-bit integer', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const value = pairingSeed(seed, 'a', 'b', 'a');
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(0x7fffffff);
    }
  });
});

describe('results schema', () => {
  it('parses a well-formed results document and rejects an unknown field', () => {
    const base = {
      schemaVersion: 2,
      format: { id: format.id, contentSha256: format.contentSha256 },
      forgeVersion: '2.0.14',
      measuredAt: new Date().toISOString(),
      gamesPerPairing: 4,
      clockSeconds: 120,
      method: 'test',
      baseSeed: 1,
      players: 'forge-ai-both-seats',
      confidence: 0.95,
      decks: [],
      pairings: [],
      overall: [],
    };
    expect(parseCommanderHeadToHeadResults(base)).toEqual(base);
    expect(() => parseCommanderHeadToHeadResults({ ...base, extra: true })).toThrow();
  });

  it('rejects a game record whose winner disagrees with its outcome', () => {
    const decidedWithNoWinner = {
      game: 1,
      listedFirst: 'a',
      playedFirst: 'a',
      outcome: 'win',
      winner: null,
      turn: 1,
      durationMs: 1,
    };
    expect(() => CommanderHeadToHeadGameRecordSchema.parse(decidedWithNoWinner)).toThrow();

    const drawnWithWinner = {
      game: 1,
      listedFirst: 'a',
      playedFirst: 'a',
      outcome: 'rules-draw',
      winner: 'a',
      turn: 1,
      durationMs: 1,
    };
    expect(() => CommanderHeadToHeadGameRecordSchema.parse(drawnWithWinner)).toThrow();

    const valid = {
      game: 1,
      listedFirst: 'a',
      playedFirst: 'a',
      outcome: 'win',
      winner: 'a',
      turn: 1,
      durationMs: 1,
    };
    expect(CommanderHeadToHeadGameRecordSchema.parse(valid)).toEqual(valid);
  });
});
