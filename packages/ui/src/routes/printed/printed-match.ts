/** Match preparation is not play admission: the backend must independently qualify the format. */
import { resumePrintedLimitedDraft } from '@mtg/draft-export';
import type {
  PreparedPrintedLimitedFormat,
  PrintedBoosterCopy,
  PrintedLimitedDraftOptions,
} from '@mtg/draft-export';
import type { SessionSpec, SeatId } from '@mtg/engine';
import { prepareLimitedDeck, toDeckRef } from '@mtg/limited';
import { suggestPrintedDeck } from './deck-evaluation';
import { printedLimitedFacts } from './limited-facts';
import { restorePrintedSession } from './printed-limited-session';
import type { PrintedLimitedSession } from './printed-limited-session';
import type { PrintedDraftRatings } from '../../lab/printed-draft-ratings';

type DraftBot = Pick<PrintedLimitedDraftOptions, 'score' | 'botPolicy'>;

function opponentPool(
  prepared: PreparedPrintedLimitedFormat,
  session: PrintedLimitedSession,
  bot: DraftBot,
): readonly PrintedBoosterCopy[] {
  if (session.mode === 'sealed') {
    // Game/rematch seeds cannot reroll the opponent's Limited pool.
    const seed = JSON.stringify(['printed-sealed-opponent/v1', prepared.fingerprint, session.seed]);
    return prepared.openSealedPool(seed).cards;
  }
  const progress = resumePrintedLimitedDraft(prepared, session.transcript, bot);
  const opponent = progress.result?.seats.find((seat) => seat.seatId === 'seat-2');
  if (opponent === undefined) throw new Error('A printed match requires a finished draft with seat-2.');
  return opponent.picks.map((pick) => pick.card);
}

/**
 * Resolve a saved session, not caller-supplied card objects. Physical ownership
 * survives until the existing Limited adapter counts names at the engine seam.
 * Opponent picks stay here; never pass this match payload to a draft advisor.
 */
export function preparePrintedMatch(
  prepared: PreparedPrintedLimitedFormat,
  input: unknown,
  options: { readonly seed: string; readonly humanSeat: SeatId },
  bot: DraftBot,
  ratings?: PrintedDraftRatings,
): SessionSpec {
  if (options.seed.trim().length === 0) throw new Error('A printed match seed must not be empty.');
  if (options.humanSeat !== 0 && options.humanSeat !== 1) throw new Error('Invalid human match seat.');
  const restored = restorePrintedSession(prepared, input, bot);
  if (restored.deck === null) throw new Error('A printed match requires a saved deck.');
  const build = (pool: readonly PrintedBoosterCopy[]) =>
    prepareLimitedDeck(pool, (card) => printedLimitedFacts(card.payload.printing));
  const human = toDeckRef(
    { ...build(restored.pool), ...restored.deck },
    `Your ${restored.session.mode} deck`,
  );
  const opponent = toDeckRef(
    suggestPrintedDeck(build(opponentPool(prepared, restored.session, bot)), ratings),
    `Bot ${restored.session.mode} deck`,
  );
  const localSeat = { name: 'You', controller: 'local' as const, deck: human };
  const engineSeat = { name: 'Forge bot', controller: 'engine' as const, deck: opponent };
  return {
    content: { kind: 'printed', format: prepared.format.id },
    seats: options.humanSeat === 0 ? [localSeat, engineSeat] : [engineSeat, localSeat],
    seed: options.seed,
    maximumTurns: null,
  };
}
