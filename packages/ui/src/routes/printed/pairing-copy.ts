import { isLowSampleWinRate } from '@mtg/printed-card';
import type {
  PairingDeck,
  PrintedDeckWinRate,
  PrintedDeckWinRates,
  RankedHeadToHeadOpponent,
  RankedOpponent,
} from '@mtg/printed-card';

export const NO_WIN_RATE_COPY = 'No measured win rate for this deck.';

export const CLOSEST_MATCH_UNAVAILABLE_COPY =
  'Closest match needs a measured win rate for your deck, and this one has none.';

export const NO_MEASURED_OPPONENT_COPY = 'No other deck here has a measured win rate.';

export const PAIRING_PANEL_LABEL = 'How evenly matched';

export const RANKED_OPPONENTS_LABEL = 'Opponents, closest first';

export function closestMatchLabel(opponent: PairingDeck): string {
  return `Seat the closest match: ${opponent.name}`;
}

export function closestMatchSeatedCopy(opponent: PairingDeck, mine: PairingDeck): string {
  return `${opponent.name} is the closest measured match for ${mine.name}.`;
}

export function yourDeckCopy(table: PrintedDeckWinRates, mine: PairingDeck, row: PrintedDeckWinRate): string {
  return `Your deck: ${mine.name}, ${deckWinRateCopy(table, row)}`;
}

export function acrossTheTableCopy<Deck extends PairingDeck>(
  table: PrintedDeckWinRates,
  opponent: RankedOpponent<Deck>,
): string {
  return `Across the table: ${opponentGapCopy(table, opponent)}`;
}

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function sampleNote(table: PrintedDeckWinRates, row: PrintedDeckWinRate): string {
  return isLowSampleWinRate(table, row) ? ', low sample' : '';
}

export function deckWinRateCopy(table: PrintedDeckWinRates, row: PrintedDeckWinRate): string {
  const games = row.games === 1 ? '1 game' : `${String(row.games)} games`;
  return `${percent(row.winRatePercent)} pod win rate, ${games} (${table.source.name})${sampleNote(table, row)}`;
}

export function pairingBasisCopy(table: PrintedDeckWinRates): string {
  return `Win rates come from four-player games between people, tracked by ${table.source.name}. A game here is one-on-one against the computer, so read them as a guide to which decks are close, not as your odds.`;
}

export function opponentGapCopy<Deck extends PairingDeck>(
  table: PrintedDeckWinRates,
  opponent: RankedOpponent<Deck>,
): string {
  if (!opponent.measured) return `${opponent.deck.name}, no measured win rate`;
  const gap = Math.abs(opponent.gapPoints).toFixed(1);
  const standing =
    gap === '0.0' ? 'about even' : `${gap} points ${opponent.gapPoints < 0 ? 'weaker' : 'stronger'}`;
  return `${opponent.deck.name}, ${percent(opponent.rate.winRatePercent)}, ${standing}${sampleNote(table, opponent.rate)}`;
}

export const HEAD_TO_HEAD_PANEL_LABEL = 'Lab measurement, computer on both sides';

export const HEAD_TO_HEAD_RANKED_LABEL = 'Head-to-head, closest first';

export const TOO_FEW_HEAD_TO_HEAD_GAMES_COPY = 'too few finished games to say';

export const NO_HEAD_TO_HEAD_OPPONENT_COPY = 'No other deck here has a lab head-to-head measurement.';

export function headToHeadBasisCopy(): string {
  return "Forge's own computer plays both decks, head to head, over forty two-player games. This is not play data from people's games, so read it beside the four-player win rates above as a second, separate fact, never averaged with them.";
}

export function headToHeadClosestMatchLabel(opponent: PairingDeck): string {
  return `Seat the closest head-to-head match: ${opponent.name}`;
}

export function headToHeadClosestMatchSeatedCopy(opponent: PairingDeck, mine: PairingDeck): string {
  return `${opponent.name} is the closest head-to-head match for ${mine.name}.`;
}

function headToHeadPercent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

export function headToHeadOpponentCopy<Deck extends PairingDeck>(
  mine: PairingDeck,
  entry: RankedHeadToHeadOpponent<Deck>,
): string {
  if (!entry.measured) return `${entry.deck.name}, ${TOO_FEW_HEAD_TO_HEAD_GAMES_COPY}`;
  return `${entry.deck.name}, ${mine.name} won ${String(entry.mineWins)} of ${String(entry.decided)} decided games (${headToHeadPercent(entry.mineShare)})`;
}

export function headToHeadSeatedCopy<Deck extends PairingDeck>(
  mine: PairingDeck,
  opponent: RankedHeadToHeadOpponent<Deck>,
): string {
  return `Head-to-head so far: ${headToHeadOpponentCopy(mine, opponent)}`;
}
