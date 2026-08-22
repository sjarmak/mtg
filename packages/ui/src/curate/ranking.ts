/**
 * Tap in preference order, and the one undo behind it.
 *
 * Ranking is not drag-to-reorder. A tablet drag over a grid of 260px
 * thumbnails is a fight with the scroll gesture, and the thing a person
 * actually does when they look at four pictures of one card is point at them
 * in the order they like them. So a tap on an unranked picture appends it to
 * that card's list, and its position in the list is the number drawn on it.
 *
 * A second tap on a *numbered* picture drops it, and everything after it moves
 * up one. That is the only way to unsay something, and it makes the gesture
 * total: every picture is one tap from being in the list and one tap from being
 * out of it, with no mode to enter and no control to find.
 *
 * A card whose list is emptied is not a card with an empty preference, it is a
 * card with no preference — `resolvePreferences` paints the base for it, which
 * is exactly what "I took my picks back" should mean, and the write endpoint
 * deletes the entry rather than writing a zero-length list the schema refuses.
 *
 * Undo is a stack rather than a single slot, because the mistake a person makes
 * on this page is a mis-tap in a run of taps and noticing it two pictures
 * later. It is capped: an unbounded history of a tablet session left open all
 * afternoon is memory nobody asked for, and nothing here is the record — the
 * preferences file on disk is, written after every tap.
 */

/** Card id to its picks, best-liked first. A card absent from it has no preference. */
export type CurationPicks = ReadonlyMap<string, readonly string[]>;

/** One card's list as it was before the tap that is being remembered. */
export interface CurationUndoStep {
  readonly cardId: string;
  readonly previous: readonly string[];
}

export interface CurationState {
  readonly picks: CurationPicks;
  readonly history: readonly CurationUndoStep[];
}

/** How many taps can be taken back. Beyond this the oldest step is forgotten. */
export const UNDO_DEPTH = 50;

export const EMPTY_CURATION_STATE: CurationState = { picks: new Map(), history: [] };

/** A card's picks as the page has them, which is the empty list until somebody taps. */
export function picksFor(state: CurationState, cardId: string): readonly string[] {
  return state.picks.get(cardId) ?? [];
}

/** 1-based position of `digest` in a card's picks, or `null` when it is unranked. */
export function rankOf(state: CurationState, cardId: string, digest: string): number | null {
  const index = picksFor(state, cardId).indexOf(digest);
  return index === -1 ? null : index + 1;
}

function withPicks(state: CurationState, cardId: string, next: readonly string[]): CurationState {
  const picks = new Map(state.picks);
  if (next.length === 0) picks.delete(cardId);
  else picks.set(cardId, next);
  const step: CurationUndoStep = { cardId, previous: picksFor(state, cardId) };
  const history = [...state.history, step].slice(-UNDO_DEPTH);
  return { picks, history };
}

/**
 * The state after one tap on one picture, and the card whose list changed.
 *
 * The changed card is returned rather than diffed by the caller because the
 * caller's next move is to write exactly that card through the endpoint, and a
 * page that has to work out what it just did is a page that can get it wrong.
 */
export interface CurationChange {
  readonly state: CurationState;
  readonly cardId: string;
  readonly hashes: readonly string[];
}

export function tap(state: CurationState, cardId: string, digest: string): CurationChange {
  const current = picksFor(state, cardId);
  const next = current.includes(digest) ? current.filter((pick) => pick !== digest) : [...current, digest];
  const updated = withPicks(state, cardId, next);
  return { state: updated, cardId, hashes: next };
}

/**
 * The state one tap ago, or `null` when there is nothing to take back.
 *
 * `null` rather than the unchanged state, because the caller's other job is to
 * write the restored list to disk and there is nothing to write.
 */
export function undo(state: CurationState): CurationChange | null {
  const step = state.history[state.history.length - 1];
  if (step === undefined) return null;
  const picks = new Map(state.picks);
  if (step.previous.length === 0) picks.delete(step.cardId);
  else picks.set(step.cardId, [...step.previous]);
  return {
    state: { picks, history: state.history.slice(0, -1) },
    cardId: step.cardId,
    hashes: step.previous,
  };
}

/** The state a preferences file already on disk puts the page in. */
export function stateFromPreferences(
  preferences: Readonly<Record<string, readonly string[]>>,
): CurationState {
  const picks = new Map<string, readonly string[]>();
  for (const [cardId, hashes] of Object.entries(preferences)) {
    if (hashes.length > 0) picks.set(cardId, [...hashes]);
  }
  return { picks, history: [] };
}
