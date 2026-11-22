export type GameOutcome = 'win' | 'rules-draw' | 'clock-draw';

export interface ParsedGame {
  readonly game: number;
  readonly turn: number | null;
  readonly durationMs: number;
  readonly firstSeat: 1 | 2 | null;
  readonly outcome: GameOutcome;
  readonly winnerSeat: 1 | 2 | null;
}

const SIMULATION_START = 'Simulation mode';
const GAME_RESULT_PREFIX = 'Game Result: ';
const GAME_OUTCOME_PREFIX = 'Game Outcome: ';
const STOPPED_LINE = 'Stopping slow match as draw';

const RESULT_WIN = /^Game Result: Game (\d+) ended in (\d+) ms\. Ai\((1|2)\)-.+ has won!$/;
const RESULT_DRAW = /^Game Result: Game (\d+) ended in a Draw! Took (\d+) ms\.$/;
const OUTCOME_TURN = /^Game Outcome: Turn (\d+)$/;
const FIRST_TURN = /^Turn: Turn 1 \(Ai\((1|2)\)-.+\)$/;
const OUTCOME_WON = /^Game Outcome: Ai\((1|2)\)-.+ has won because .+$/;
const OUTCOME_LOST = /^Game Outcome: Ai\((1|2)\)-.+ has lost (?:because|due to) .+$/;

export function sinceSimulationStart(output: string): string {
  const start = output.indexOf(SIMULATION_START);
  return start >= 0 ? output.slice(start) : output;
}

function splitGameBlocks(text: string): readonly (readonly string[])[] {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    current.push(line);
    if (line.startsWith(GAME_RESULT_PREFIX)) {
      blocks.push(current);
      current = [];
    }
  }
  return blocks;
}

function seatsMatching(block: readonly string[], pattern: RegExp): readonly (1 | 2)[] {
  const seats: (1 | 2)[] = [];
  for (const line of block) {
    const match = pattern.exec(line);
    if (match?.[1] !== undefined) seats.push(match[1] === '1' ? 1 : 2);
  }
  return seats;
}

function readFirstSeat(block: readonly string[], game: number): 1 | 2 | null {
  const firstSeatLines = block.filter((line) => FIRST_TURN.test(line));
  if (firstSeatLines.length > 1) {
    throw new Error(`game ${String(game)} has more than one "Turn: Turn 1" line`);
  }
  if (firstSeatLines.length === 0) return null;
  const match = FIRST_TURN.exec(firstSeatLines[0]!);
  return match?.[1] === '1' ? 1 : 2;
}

function classifyDecidedGame(
  block: readonly string[],
  game: number,
  resultSeat: 1 | 2,
  resultLine: string,
): 1 | 2 {
  const wonSeats = seatsMatching(block, OUTCOME_WON);
  const lostSeats = seatsMatching(block, OUTCOME_LOST);
  const isValidWin =
    wonSeats.length === 1 &&
    lostSeats.length === 1 &&
    wonSeats[0] !== lostSeats[0] &&
    wonSeats[0] === resultSeat;
  if (!isValidWin) {
    const outcomeLines = block.filter((line) => line.startsWith(GAME_OUTCOME_PREFIX));
    throw new Error(
      `game ${String(game)} is neither a clean win, a rules draw, nor a clock draw: ${[...outcomeLines, resultLine].join(' | ')}`,
    );
  }
  return resultSeat;
}

function parseGameBlock(block: readonly string[]): ParsedGame {
  const resultLine = block.find((line) => line.startsWith(GAME_RESULT_PREFIX));
  if (resultLine === undefined) throw new Error('game block has no "Game Result:" line');
  const win = RESULT_WIN.exec(resultLine);
  const draw = RESULT_DRAW.exec(resultLine);
  if (win === null && draw === null) throw new Error(`unrecognized "Game Result:" line: ${resultLine}`);

  const match = (win ?? draw)!;
  const game = Number(match[1]);
  const durationMs = Number(match[2]);
  const resultSeat: 1 | 2 | null = win !== null ? (win[3] === '1' ? 1 : 2) : null;

  const turnLine = block.find((line) => OUTCOME_TURN.test(line));
  const turn = turnLine !== undefined ? Number(OUTCOME_TURN.exec(turnLine)![1]) : null;
  const firstSeat = readFirstSeat(block, game);

  if (block.includes(STOPPED_LINE)) {
    return { game, turn, durationMs, firstSeat, outcome: 'clock-draw', winnerSeat: null };
  }
  if (draw !== null) {
    return { game, turn, durationMs, firstSeat, outcome: 'rules-draw', winnerSeat: null };
  }

  const winnerSeat = classifyDecidedGame(block, game, resultSeat!, resultLine);
  return { game, turn, durationMs, firstSeat, outcome: 'win', winnerSeat };
}

export function parseGameOutcomes(text: string): readonly ParsedGame[] {
  return splitGameBlocks(text).map(parseGameBlock);
}
