import type { MoveId, PendingDecision, PlayInteraction, SeatId, TableView } from '@mtg/engine';
import { seatViewOf } from '@mtg/engine';

interface BackendAutomaticPosition {
  readonly decision: PendingDecision | null;
  readonly play?: PlayInteraction | undefined;
  readonly view?: Pick<TableView, 'seats'> | undefined;
}

const LAND = /(?:^|\s)Land(?:\s|$)/u;

function preferredManaPayment(session: BackendAutomaticPosition, viewer: SeatId, declared: MoveId): MoveId {
  const play = session.play;
  const decision = session.decision;
  const view = session.view;
  if (play?.automatic?.reason !== 'mana-payment' || decision === null || view === undefined) return declared;

  const offered = new Set(decision.options.map((option) => option.id));
  const battlefield = new Map(seatViewOf(view, viewer).battlefield.map((object) => [object.oid, object]));
  const sourceActions = play.objectActions.filter(
    (action) => action.category === 'mana' && offered.has(action.move) && battlefield.has(action.oid),
  );
  const declaredSource = sourceActions.find((action) => action.move === declared);

  // A move without a source object spends mana that is already floating. That
  // preserves every permanent and remains the best automatic payment.
  if (declaredSource === undefined) return declared;
  if (declaredSource.manaOutput === undefined) return declared;

  const exact = sourceActions.filter(
    (action): action is typeof action & { readonly manaOutput: NonNullable<typeof action.manaOutput> } =>
      action.manaOutput !== undefined,
  );
  const outputsBySource = new Map<string, Set<string>>();
  const sourcesByOutput = new Map<string, Set<string>>();
  for (const action of exact) {
    const outputs = outputsBySource.get(action.oid) ?? new Set<string>();
    outputs.add(action.manaOutput);
    outputsBySource.set(action.oid, outputs);
    const sources = sourcesByOutput.get(action.manaOutput) ?? new Set<string>();
    sources.add(action.oid);
    sourcesByOutput.set(action.manaOutput, sources);
  }

  // All candidates remain exact moves enumerated by the backend. Prefer an
  // ordinary land over a creature or artifact, then the least-flexible source,
  // then the most-redundant output. For {1}{G}, a U/G dual plus an Island thus
  // spends the Island's blue first and leaves the only green-capable source
  // available for the colored remainder.
  const ranked = exact.map((action, index) => ({ action, index }));
  ranked.sort((left, right) => {
    const leftLand = LAND.test(battlefield.get(left.action.oid)?.typeLine ?? '') ? 0 : 1;
    const rightLand = LAND.test(battlefield.get(right.action.oid)?.typeLine ?? '') ? 0 : 1;
    return (
      leftLand - rightLand ||
      (outputsBySource.get(left.action.oid)?.size ?? Number.MAX_SAFE_INTEGER) -
        (outputsBySource.get(right.action.oid)?.size ?? Number.MAX_SAFE_INTEGER) ||
      (sourcesByOutput.get(right.action.manaOutput)?.size ?? 0) -
        (sourcesByOutput.get(left.action.manaOutput)?.size ?? 0) ||
      left.index - right.index
    );
  });
  return ranked[0]?.action.move ?? declared;
}

/**
 * Returns an adapter-declared routine move for the local seat.
 *
 * The move stays fail-closed: it must still belong to the current local
 * decision. Backend ids and decision-kind spellings remain opaque here.
 */
export function automaticBackendMove(session: BackendAutomaticPosition, viewer: SeatId): MoveId | null {
  const decision = session.decision;
  const automatic = session.play?.automatic;
  if (decision === null || automatic === undefined || automatic === null) return null;
  if (decision.seat !== viewer) return null;
  if (!decision.options.some((option) => option.id === automatic.move)) return null;
  // The adapter identifies the die-roll winner's "play first" option so the
  // UI can present both opening choices clearly. It is not a routine action:
  // the winning player must decide whether to take it.
  if (automatic.reason === 'local-starts') return null;
  return preferredManaPayment(session, viewer, automatic.move);
}
