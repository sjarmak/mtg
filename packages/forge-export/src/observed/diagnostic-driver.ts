/** Bounded, deterministic exploration of backend-declared observed interactions. */
import { createHash } from 'node:crypto';
import { textSubmission } from '@mtg/engine';
import type { MoveId, ObservedSession, PlayObjectActionCategory } from '@mtg/engine';

export interface ObservedDiagnosticChoice {
  readonly move: MoveId | null;
  readonly selection:
    | `automatic:${'local-starts' | 'mana-payment' | 'mana-payment-cancel' | 'text-suggestion'}`
    | `object:${Exclude<PlayObjectActionCategory, 'combat' | 'mana'>}`
    | 'combat:stage-attacker'
    | 'combat:object'
    | 'combat:confirm'
    | 'enumerated:targeted'
    | 'enumerated:seat'
    | 'enumerated:opaque'
    | 'priority:pass'
    | 'unsupported:text-input'
    | 'unsupported:no-option';
}

export interface ObservedDiagnosticDecision {
  readonly index: number;
  readonly turn: number;
  readonly kind: string;
  readonly offered: number;
  readonly declaredRoles: {
    readonly automatic: boolean;
    readonly objectActions: number;
    readonly seatActions: number;
    readonly attackers: boolean;
    readonly pass: boolean;
  };
  readonly selectedMove: MoveId | null;
  readonly selection: ObservedDiagnosticChoice['selection'];
}

export interface ObservedDiagnosticSessionReport {
  readonly schemaVersion: 1;
  readonly kind: 'observed-catalog-discovery-session';
  readonly qualification: 'unproven';
  readonly backend: string;
  readonly seed: string;
  readonly status: 'finished' | 'decision-budget-exhausted' | 'unsupported-decision' | 'submit-failed';
  readonly submitted: number;
  readonly decisions: readonly ObservedDiagnosticDecision[];
  readonly callbackCounts: Readonly<Record<string, number>>;
  /** Aggregate names only; no zone snapshots or backend object identities are retained. */
  readonly cardCoverage: {
    readonly observed: readonly string[];
    readonly offeredActions: readonly string[];
    readonly selectedActions: readonly string[];
  };
  readonly result: ObservedSession['result'];
  readonly error: { readonly kind: string; readonly message: string } | null;
}

const OBJECT_PRIORITY = ['play', 'cast', 'ability'] as const;

function uniqueNames(...groups: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(groups.flat())].sort();
}

function observableObjects(session: ObservedSession) {
  const publicObjects = [
    ...session.view.stack,
    ...session.view.seats.flatMap((seat) => [...seat.graveyard, ...seat.exile, ...seat.battlefield]),
  ];
  const localHands = session.view.seats.flatMap((seat) =>
    session.localSeats.includes(seat.id) ? (seat.hand ?? []) : [],
  );
  return [...publicObjects, ...localHands];
}

function actionNames(session: ObservedSession): readonly string[] {
  const namesByOid = new Map(observableObjects(session).map((object) => [object.oid, object.name]));
  return uniqueNames(
    (session.play?.objectActions ?? []).flatMap((action) => {
      const name = namesByOid.get(action.oid);
      return name === undefined ? [] : [name];
    }),
  );
}

function selectedActionName(session: ObservedSession, choice: ObservedDiagnosticChoice): readonly string[] {
  if (choice.move === null) return [];
  const action = session.play?.objectActions.find((candidate) => candidate.move === choice.move);
  if (action === undefined) return [];
  const object = observableObjects(session).find((candidate) => candidate.oid === action.oid);
  return object === undefined ? [] : [object.name];
}

function selected<T>(values: readonly T[], seed: string): T | undefined {
  if (values.length === 0) return undefined;
  const digest = createHash('sha256').update(seed).digest();
  return values[digest.readUInt32BE(0) % values.length];
}

function offeredMove(session: ObservedSession, move: MoveId | null | undefined): move is MoveId {
  return (
    move !== null && move !== undefined && session.decision!.options.some((option) => option.id === move)
  );
}

function coverageDirectedActions<T extends { readonly oid: string }>(
  session: ObservedSession,
  actions: readonly T[],
  preferredCardNames: ReadonlySet<string>,
): readonly T[] {
  if (preferredCardNames.size === 0) return actions;
  const namesByOid = new Map(observableObjects(session).map((object) => [object.oid, object.name]));
  const preferred = actions.filter((action) => {
    const name = namesByOid.get(action.oid);
    return name !== undefined && preferredCardNames.has(name);
  });
  return preferred.length === 0 ? actions : preferred;
}

/**
 * Chooses only from exact moves in the current decision. Presentation labels,
 * backend decision spellings, and move-id structure are deliberately ignored.
 */
export function chooseObservedDiagnosticMove(
  session: ObservedSession,
  seed: string,
  excludedMoves: ReadonlySet<MoveId> = new Set(),
  preferredCardNames: ReadonlySet<string> = new Set(),
): ObservedDiagnosticChoice {
  const decision = session.decision;
  if (decision === null) return { move: null, selection: 'unsupported:no-option' };
  if (decision.input !== undefined) {
    const suggestion = selected(decision.input.suggestions ?? [], `${seed}/text-suggestion`);
    return suggestion === undefined
      ? { move: null, selection: 'unsupported:text-input' }
      : {
          move: textSubmission(decision.input, suggestion),
          selection: 'automatic:text-suggestion',
        };
  }
  const play = session.play;
  if (offeredMove(session, play?.automatic?.move)) {
    return {
      move: play.automatic.move,
      selection: `automatic:${play.automatic.reason}`,
    };
  }

  const declaredActions = (play?.objectActions ?? []).filter((action) => offeredMove(session, action.move));
  const actions = declaredActions.filter((action) => !excludedMoves.has(action.move));
  const attackers = play?.attackers;
  if (attackers !== undefined && attackers !== null) {
    const staged = new Set(attackers.staged);
    const add = selected(
      coverageDirectedActions(
        session,
        actions.filter((action) => action.category === 'combat' && !staged.has(action.oid)),
        preferredCardNames,
      ),
      `${seed}/attacker`,
    );
    if (add !== undefined) return { move: add.move, selection: 'combat:stage-attacker' };
    if (offeredMove(session, attackers.confirm)) {
      return { move: attackers.confirm, selection: 'combat:confirm' };
    }
  }

  for (const category of OBJECT_PRIORITY) {
    const action = selected(
      coverageDirectedActions(
        session,
        actions.filter((candidate) => candidate.category === category),
        preferredCardNames,
      ),
      `${seed}/object/${category}`,
    );
    if (action !== undefined) return { move: action.move, selection: `object:${category}` };
  }
  const forbidden = new Set([
    ...declaredActions.map((action) => action.move),
    ...[play?.concede, play?.passPriority].filter(
      (move): move is string => move !== undefined && move !== null,
    ),
  ]);
  const candidates = decision.options.filter(
    (option) => !forbidden.has(option.id) && !excludedMoves.has(option.id),
  );
  const targeted = selected(
    candidates.filter((option) => option.targets.length > 0),
    `${seed}/target`,
  );
  if (targeted !== undefined) return { move: targeted.id, selection: 'enumerated:targeted' };
  const seats = new Set(play?.seatActions?.map((action) => action.move) ?? []);
  const seat = selected(
    candidates.filter((option) => seats.has(option.id)),
    `${seed}/seat`,
  );
  if (seat !== undefined) return { move: seat.id, selection: 'enumerated:seat' };
  const opaque = selected(candidates, `${seed}/opaque`);
  if (opaque !== undefined) return { move: opaque.id, selection: 'enumerated:opaque' };
  const combat = selected(
    actions.filter((candidate) => candidate.category === 'combat'),
    `${seed}/combat`,
  );
  if (combat !== undefined) return { move: combat.move, selection: 'combat:object' };
  if (offeredMove(session, play?.passPriority)) {
    return { move: play.passPriority, selection: 'priority:pass' };
  }
  return { move: null, selection: 'unsupported:no-option' };
}

function observation(
  session: ObservedSession,
  index: number,
  choice: ObservedDiagnosticChoice,
): ObservedDiagnosticDecision {
  const play = session.play;
  return {
    index,
    turn: session.view.turn.number,
    kind: session.decision?.kind ?? 'absent',
    offered: session.decision?.options.length ?? 0,
    declaredRoles: {
      automatic: play?.automatic !== undefined && play?.automatic !== null,
      objectActions: play?.objectActions.length ?? 0,
      seatActions: play?.seatActions?.length ?? 0,
      attackers: play?.attackers !== undefined && play?.attackers !== null,
      pass: play?.passPriority !== undefined && play?.passPriority !== null,
    },
    selectedMove: choice.move,
    selection: choice.selection,
  };
}

export async function runObservedDiagnosticSession(
  initial: ObservedSession,
  options: {
    readonly seed: string;
    readonly decisionBudget: number;
    readonly preferredActionCardNames?: ReadonlySet<string>;
  },
): Promise<ObservedDiagnosticSessionReport> {
  if (!Number.isInteger(options.decisionBudget) || options.decisionBudget < 1)
    throw new Error('Observed diagnostic decision budget must be a positive integer');
  let session = initial;
  const decisions: ObservedDiagnosticDecision[] = [];
  const callbackCounts: Record<string, number> = {};
  let error: ObservedDiagnosticSessionReport['error'] = null;
  let status: ObservedDiagnosticSessionReport['status'] = 'decision-budget-exhausted';
  let turn = session.view.turn.number;
  let pendingPaymentAction: MoveId | null = null;
  let manaCancellationMove: MoveId | null = null;
  let blockedMoves: readonly MoveId[] = [];
  let observedCards = uniqueNames(observableObjects(session).map((object) => object.name));
  let offeredActionCards = actionNames(session);
  let selectedActionCards: readonly string[] = [];
  let preferredActionCardNames = new Set(options.preferredActionCardNames ?? []);

  while (decisions.length < options.decisionBudget && session.status === 'awaiting') {
    if (session.view.turn.number !== turn) {
      turn = session.view.turn.number;
      pendingPaymentAction = null;
      manaCancellationMove = null;
      blockedMoves = [];
    }
    if (
      session.decision?.kind === 'priority' &&
      pendingPaymentAction !== null &&
      offeredMove(session, pendingPaymentAction)
    ) {
      blockedMoves = [...new Set([...blockedMoves, pendingPaymentAction])];
      pendingPaymentAction = null;
    }
    if (session.decision?.kind !== 'mana-payment') manaCancellationMove = null;
    const choice: ObservedDiagnosticChoice =
      manaCancellationMove !== null && offeredMove(session, manaCancellationMove)
        ? { move: manaCancellationMove, selection: 'enumerated:opaque' }
        : chooseObservedDiagnosticMove(
            session,
            `${options.seed}/${String(decisions.length)}`,
            new Set(blockedMoves),
            preferredActionCardNames,
          );
    const found = observation(session, decisions.length, choice);
    decisions.push(found);
    callbackCounts[found.kind] = (callbackCounts[found.kind] ?? 0) + 1;
    const selectedNames = selectedActionName(session, choice);
    selectedActionCards = uniqueNames(selectedActionCards, selectedNames);
    preferredActionCardNames = new Set(
      [...preferredActionCardNames].filter((name) => !selectedNames.includes(name)),
    );
    if (choice.move === null) {
      status = 'unsupported-decision';
      break;
    }
    const selectedPriorityAction =
      session.decision?.kind === 'priority' &&
      choice.move !== session.play?.passPriority &&
      choice.move !== session.play?.concede
        ? choice.move
        : null;
    if (choice.selection === 'object:cast' || choice.selection === 'object:ability') {
      pendingPaymentAction = choice.move;
    } else if (
      session.decision?.kind === 'mana-payment' &&
      choice.selection === 'enumerated:opaque' &&
      pendingPaymentAction !== null
    ) {
      blockedMoves = [...new Set([...blockedMoves, pendingPaymentAction])];
      manaCancellationMove = choice.move;
      pendingPaymentAction = null;
    }
    const submitted = await session.submit(choice.move);
    if (!submitted.ok) {
      status = 'submit-failed';
      error = { kind: submitted.error.kind, message: submitted.error.message };
      break;
    }
    if (submitted.session.decision?.kind === 'mana-payment' && selectedPriorityAction !== null) {
      pendingPaymentAction = selectedPriorityAction;
    }
    session = submitted.session;
    observedCards = uniqueNames(
      observedCards,
      observableObjects(session).map((object) => object.name),
    );
    offeredActionCards = uniqueNames(offeredActionCards, actionNames(session));
  }
  if (session.status === 'finished') status = 'finished';
  await session.close();
  return {
    schemaVersion: 1,
    kind: 'observed-catalog-discovery-session',
    qualification: 'unproven',
    backend: session.backend,
    seed: options.seed,
    status,
    submitted: session.submitted,
    decisions,
    callbackCounts,
    cardCoverage: {
      observed: observedCards,
      offeredActions: offeredActionCards,
      selectedActions: selectedActionCards,
    },
    result: session.result,
    error,
  };
}
