import type { PlayerId } from '@mtg/kernel';
import { createRng, nextBelow } from '@mtg/kernel';
import { seatVerb } from '../../seat';
import type { SeatNames } from './position';

export type RollPair = readonly [number, number];

export interface OpeningRoll {
  readonly rounds: readonly RollPair[];
  readonly winner: PlayerId;
}

export const D20_FACES = 20;

const ROLL_ROUNDS_MAX = 64;

export function rollForFirst(seed: string): OpeningRoll {
  let rng = createRng(`${seed}/opening-roll`);
  const rounds: RollPair[] = [];
  for (let round = 0; round < ROLL_ROUNDS_MAX; round += 1) {
    const [first, afterFirst] = nextBelow(rng, D20_FACES);
    const [second, afterSecond] = nextBelow(afterFirst, D20_FACES);
    rng = afterSecond;
    rounds.push([first + 1, second + 1]);
    if (first !== second) return { rounds, winner: first > second ? 0 : 1 };
  }
  throw new Error(
    `play: ${String(ROLL_ROUNDS_MAX)} tied opening rolls under seed "${seed}", which is a broken generator rather than a game`,
  );
}

export function finalRound(roll: OpeningRoll): RollPair {
  const last = roll.rounds[roll.rounds.length - 1];
  if (last === undefined) throw new Error('play: an opening roll with no rounds names no winner');
  return last;
}

export function openingRollText(roll: OpeningRoll, names: SeatNames): string {
  const last = finalRound(roll);
  const loser: PlayerId = roll.winner === 0 ? 1 : 0;
  const winner = names[roll.winner];
  const ties = roll.rounds.length - 1;
  const after = ties === 0 ? '' : ties === 1 ? ' after one tie' : ` after ${String(ties)} ties`;
  return `${winner} won the die roll ${String(last[roll.winner])} to ${String(last[loser])}${after} and ${seatVerb(winner, 'plays', 'play')} first.`;
}

export function tieText(pair: RollPair): string {
  return `Tied at ${String(pair[0])}. Rolling again.`;
}
