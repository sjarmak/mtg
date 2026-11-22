import { wilsonInterval } from '@mtg/metrics';
import type { ParsedGame } from './transcript';
import type {
  CommanderHeadToHeadGameRecord,
  CommanderHeadToHeadOverall,
  CommanderHeadToHeadPairing,
  CommanderHeadToHeadPlayOrderCell,
  Share,
} from './schema';

export function recordGames(
  parsed: readonly ParsedGame[],
  listedFirst: 'a' | 'b',
): readonly CommanderHeadToHeadGameRecord[] {
  const seatToSide = (seat: 1 | 2): 'a' | 'b' => ((seat === 1) === (listedFirst === 'a') ? 'a' : 'b');
  return parsed.map((parsedGame) => {
    if (parsedGame.firstSeat === null) {
      throw new Error(`game ${String(parsedGame.game)} has no recorded play order`);
    }
    return {
      game: parsedGame.game,
      listedFirst,
      playedFirst: seatToSide(parsedGame.firstSeat),
      outcome: parsedGame.outcome,
      winner: parsedGame.winnerSeat === null ? null : seatToSide(parsedGame.winnerSeat),
      turn: parsedGame.turn,
      durationMs: parsedGame.durationMs,
    };
  });
}

export function shareOf(successes: number, trials: number): Share {
  const interval = wilsonInterval(successes, trials);
  return { point: trials > 0 ? successes / trials : 0, low: interval.low, high: interval.high };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function playOrderCell(
  records: readonly CommanderHeadToHeadGameRecord[],
  playedFirst: 'a' | 'b',
): CommanderHeadToHeadPlayOrderCell {
  const cellRecords = records.filter((record) => record.playedFirst === playedFirst);
  return {
    games: cellRecords.length,
    aWins: cellRecords.filter((record) => record.winner === 'a').length,
    bWins: cellRecords.filter((record) => record.winner === 'b').length,
  };
}

function shareOfCell(cell: CommanderHeadToHeadPlayOrderCell): number | null {
  const decisive = cell.aWins + cell.bWins;
  return decisive > 0 ? cell.aWins / decisive : null;
}

function balancedShare(
  aPlayedFirst: CommanderHeadToHeadPlayOrderCell,
  bPlayedFirst: CommanderHeadToHeadPlayOrderCell,
): number | null {
  const first = shareOfCell(aPlayedFirst);
  const second = shareOfCell(bPlayedFirst);
  return first === null || second === null ? null : (first + second) / 2;
}

export function tallyPairing(
  a: string,
  b: string,
  seeds: readonly [number, number],
  commands: readonly [string, string],
  records: readonly CommanderHeadToHeadGameRecord[],
): CommanderHeadToHeadPairing {
  const games = records.length;
  const aWins = records.filter((record) => record.winner === 'a').length;
  const bWins = records.filter((record) => record.winner === 'b').length;
  const rulesDraws = records.filter((record) => record.outcome === 'rules-draw').length;
  const clockDraws = records.filter((record) => record.outcome === 'clock-draw').length;
  const byPlayOrder = {
    aPlayedFirst: playOrderCell(records, 'a'),
    bPlayedFirst: playOrderCell(records, 'b'),
  };
  const turns = records.map((record) => record.turn).filter((turn): turn is number => turn !== null);
  const decisive = aWins + bWins;

  return {
    a,
    b,
    games,
    aWins,
    bWins,
    rulesDraws,
    clockDraws,
    seeds: [...seeds],
    commands: [...commands],
    aShare: decisive > 0 ? shareOf(aWins, decisive) : null,
    byPlayOrder,
    aBalancedShare: balancedShare(byPlayOrder.aPlayedFirst, byPlayOrder.bPlayedFirst),
    meanTurns: turns.length > 0 ? mean(turns) : null,
    meanMs: games > 0 ? mean(records.map((record) => record.durationMs)) : 0,
    gameRecords: [...records],
  };
}

export function tallyOverall(
  deckIds: readonly string[],
  pairings: readonly CommanderHeadToHeadPairing[],
): readonly CommanderHeadToHeadOverall[] {
  return deckIds.map((id) => {
    let wins = 0;
    let losses = 0;
    let rulesDraws = 0;
    let clockDraws = 0;
    for (const pairing of pairings) {
      if (pairing.a !== id && pairing.b !== id) continue;
      const self: 'a' | 'b' = pairing.a === id ? 'a' : 'b';
      for (const record of pairing.gameRecords) {
        if (record.outcome === 'rules-draw') rulesDraws += 1;
        else if (record.outcome === 'clock-draw') clockDraws += 1;
        else if (record.winner === self) wins += 1;
        else losses += 1;
      }
    }
    const decisive = wins + losses;
    return {
      id,
      games: wins + losses + rulesDraws + clockDraws,
      wins,
      losses,
      rulesDraws,
      clockDraws,
      share: decisive > 0 ? shareOf(wins, decisive) : null,
    };
  });
}
