import type { MoveId, PendingDecision, PlayInteraction, SeatId, TableView } from '@mtg/engine';
import type { AutoPassSettings } from '@mtg/kernel';
import { hasStop } from '@mtg/kernel';

interface BackendPassPosition {
  readonly view: TableView;
  readonly decision: PendingDecision | null;
  readonly play?: PlayInteraction | undefined;
}

/**
 * Returns the backend's exact pass id when the shared stop settings settle it.
 *
 * This intentionally knows no backend ids, labels, decision kinds, or phase
 * spellings. The adapter must declare both the standard step and the opaque
 * pass role, and the current decision must still offer that exact id.
 */
export function automaticBackendPass(
  session: BackendPassPosition,
  viewer: SeatId,
  settings: AutoPassSettings,
): MoveId | null {
  if (!settings.enabled || !settings.passUnstopped) return null;
  const decision = session.decision;
  const play = session.play;
  if (decision === null || play === undefined) return null;
  if (decision.seat !== viewer || session.view.priority !== viewer) return null;
  if (play.turnStep === null || play.passPriority === null) return null;
  if (!decision.options.some((option) => option.id === play.passPriority)) return null;

  // A configured stop is a visible beat even when pass is the only game move.
  // In particular, the default owns both local main phases so an empty or
  // landless hand cannot make the whole first turn disappear before paint.
  const side = session.view.turn.active === viewer ? 'yourTurn' : 'theirTurn';
  if (hasStop(settings.stops, side, play.turnStep)) return null;

  const substantive = decision.options.filter(
    (option) => option.id !== play.passPriority && option.id !== play.concede,
  );
  const categoriesByMove = new Map<string, Set<string>>();
  for (const action of play.objectActions) {
    const categories = categoriesByMove.get(action.move) ?? new Set<string>();
    if (action.category !== undefined) categories.add(action.category);
    categoriesByMove.set(action.move, categories);
  }
  const responses = substantive.filter((option) => {
    const categories = categoriesByMove.get(option.id);
    return categories === undefined || categories.size !== 1 || !categories.has('mana');
  });
  // Mana abilities do not use the stack and cannot answer what is on it. Every
  // undeclared or differently classified option remains fail-closed as a real
  // response, matching the kernel's `canRespond` boundary without reading ids
  // or labels.
  if (session.view.stack.length > 0 && responses.length > 0) return null;
  // Away from a configured stop, a priority containing only pass and concede
  // is bookkeeping: there is no game action for the player to take there.
  if (substantive.length === 0) return play.passPriority;

  return play.passPriority;
}
