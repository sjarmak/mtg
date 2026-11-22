/**
 * A backend-neutral live session on the same board as generated-set play.
 *
 * The neutral projection carries fewer facts than the kernel, so this surface
 * leaves blocker relationships, attachments, derived keywords and staged
 * declarations absent. It carries the backend's explicit attacking flag, and
 * never guesses the relationships the projection does not expose. It never
 * branches on a backend id, decision kind, phase spelling, step spelling,
 * event detail or move id.
 */
import { createElement, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type {
  GameBackend,
  MoveLabel,
  PendingDecision,
  PlayInteraction,
  SeatId,
  SessionSpec,
  TableView,
  TextDecisionInput,
} from '@mtg/engine';
import { labelDecision, seatViewOf, textSubmission } from '@mtg/engine';
import type { BeatSet, CombatBeat } from '@mtg/kernel';
import { DEFAULT_AUTO_PASS, DEFAULT_BEATS } from '@mtg/kernel';
import { BASIC_LAND_PRINTINGS } from '../../card/basic-land-printings';
import type { PrintedCardPresentation } from '../../card/printed-card-art';
import { OFFICIAL_TOKEN_PRINTINGS } from '../../card/token-printings';
import { seatVerb } from '../../seat';
import type { AskSlot } from './ask-flyout';
import { attackPlan, attackTargeting, describeDefender } from './attack-targets';
import type { AttackDefender } from './attack-targets';
import { backendBoardPosition, movesBySeat, visibleObjects } from './backend-position';
import { withoutBridgeIdentifiers } from './choice-text';
import { attackControls, NO_STAGING } from './combat';
import type { AttackStaging } from './combat';
import { findInspected } from './inspect';
import { automaticBackendPass } from './backend-auto-pass';
import { automaticBackendMove } from './backend-auto-move';
import { BackendEventLog } from './BackendEventLog';
import {
  describeBackendOpenFailure,
  GATEWAY_STARTING_RETRY_MS,
  isGatewayStarting,
} from '../../net/gateway-starting';
import { onPageLeft } from './page-leave';
import { usePassKey } from './pass-key';
import { useCoarsePointer } from './pointer';
import { CombatDamageMove } from './CombatDamageMove';
import type { PlayChoice, PlayPrompt } from './prompt';
import { choicesByObject } from './prompt';
import { priorityFoot, priorityHolderText } from './priority';
import { LEGAL_MOVES_LABEL, presentedBeatPanel, promptPanel } from './rail';
import { PlayContextRail } from './PlayRail';
import { PlaySurface } from './PlaySurface';
import { useEnumeratedSelection } from './selection';
import type { TableSelection } from './selection';
import {
  createPlaySessionController,
  type PlaySessionController,
  type PlaySessionControllerState,
  type SessionFeed,
} from './session-controller';
import { stepBar } from './toolbar';

export const OPENING_SESSION_LABEL = 'Opening game…';
export const SUBMITTING_MOVE_LABEL = 'Submitting move…';
export const CLOSED_SESSION_LABEL = 'Game closed';
export const CLOSE_GAME_LABEL = 'Close game';
export const UNDO_COMMIT_REFUSAL = 'Completed actions and priority passes cannot be undone.';
export const UNDO_IN_FLIGHT_REFUSAL = 'Wait for the current move to finish before taking anything back.';

function isBasicLandPrinting(card: PrintedCardPresentation): boolean {
  return /^Basic Land\b/i.test(card.typeLine);
}

export interface BackendGameProps {
  readonly backend: GameBackend;
  readonly table: SessionSpec;
  /** Exact printing data used only to present observed named objects. */
  readonly printedCards?: readonly PrintedCardPresentation[];
  /** Returns to the owning deck builder after the held session is released. */
  readonly onClose?: () => void;
  readonly onNewGame?: () => void;
  /** Dealer-owned route control, in the same strip used by generated play. */
  readonly toolbar?: ReactNode;
  /** Lets a builder recover from an open refusal without hiding the reason. */
  readonly onOpenFailure?: (message: string) => void;
  /** Positions the other seat reaches, for a table played over the network. */
  readonly feed?: SessionFeed;
}

const OPENING_STATE: PlaySessionControllerState = {
  phase: 'opening',
  session: null,
  error: null,
};

function openingSnapshot(): PlaySessionControllerState {
  return OPENING_STATE;
}

function subscribeToNothing(): () => void {
  return (): void => undefined;
}

type ForgeGameEndReason =
  'AllOpponentsLost' | 'Draw' | 'WinsGameSpellEffect' | 'AllHumansLost' | 'AllOpposingTeamsLost';

const FORGE_END_REASON_WORDS: Readonly<Record<ForgeGameEndReason, string>> = {
  AllOpponentsLost: 'all opponents lost',
  Draw: 'no player won',
  WinsGameSpellEffect: 'a spell or ability won the game',
  AllHumansLost: 'all human players lost',
  AllOpposingTeamsLost: 'all opposing teams lost',
};

function endReasonText(reason: string): string {
  const forgeReason = FORGE_END_REASON_WORDS[reason as ForgeGameEndReason];
  if (forgeReason !== undefined) return forgeReason;
  return reason
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

function resultText(state: Extract<PlaySessionControllerState, { readonly phase: 'finished' }>): string {
  const result = state.session.result;
  if (result === null) return 'Game finished';
  const ending = `on turn ${String(result.endedOnTurn)}: ${endReasonText(result.reason)}`;
  if (result.winner === null) return `Game drawn ${ending}`;
  const winner = seatViewOf(state.session.view, result.winner).name;
  return `${winner} ${seatVerb(winner, 'wins', 'win')} ${ending}`;
}

function backendPrompt(
  decision: PendingDecision,
  labels: readonly MoveLabel[],
  play: PlayInteraction | undefined,
  explain: string,
  objectOids: readonly string[],
): PlayPrompt {
  const isStartingChoice = play?.automatic?.reason === 'local-starts';
  const playFirst = play?.automatic?.move;
  const byMove = new Map(decision.options.map((option) => [option.id, option]));
  const sourceOids = new Map<string, string[]>();
  const sourceCategories = new Map<
    string,
    Set<NonNullable<PlayInteraction['objectActions'][number]['category']>>
  >();
  for (const action of play?.objectActions ?? []) {
    const held = sourceOids.get(action.move) ?? [];
    if (!held.includes(action.oid)) held.push(action.oid);
    sourceOids.set(action.move, held);
    if (action.category !== undefined) {
      const categories = sourceCategories.get(action.move) ?? new Set();
      categories.add(action.category);
      sourceCategories.set(action.move, categories);
    }
  }
  const baseTexts = labels.map((label) =>
    withoutBridgeIdentifiers(label.text, [
      label.id,
      ...(byMove.get(label.id)?.targets.map((target) => target.oid) ?? []),
      ...objectOids,
    ]),
  );
  const totalByText = new Map<string, number>();
  for (const baseText of baseTexts) totalByText.set(baseText, (totalByText.get(baseText) ?? 0) + 1);
  const seenByText = new Map<string, number>();
  const choices = labels.map((label, index): PlayChoice => {
    const option = byMove.get(label.id);
    const categories = [...(sourceCategories.get(label.id) ?? [])];
    const objectKind: PlayChoice['kind'] =
      categories.length !== 1
        ? 'other'
        : categories[0] === 'play'
          ? 'playLand'
          : categories[0] === 'cast'
            ? 'castSpell'
            : categories[0] === 'ability'
              ? 'activateAbility'
              : categories[0] === 'mana'
                ? 'activateManaAbility'
                : 'declareAttackers';
    const kind: PlayChoice['kind'] =
      label.id === play?.passPriority ? 'passPriority' : label.id === play?.concede ? 'concede' : objectKind;
    const baseText = baseTexts[index] ?? label.text;
    const total = totalByText.get(baseText) ?? 1;
    const position = (seenByText.get(baseText) ?? 0) + 1;
    seenByText.set(baseText, position);
    return {
      index,
      label: isStartingChoice
        ? label.id === playFirst
          ? 'Play first'
          : 'Play second'
        : total > 1
          ? `${baseText} (${String(position)} of ${String(total)})`
          : baseText,
      detail: null,
      kind,
      oids: sourceOids.get(label.id) ?? [],
      aimedAt: option?.targets.map((target) => target.oid) ?? [],
    };
  });
  return {
    headline: isStartingChoice
      ? 'You won the die roll'
      : play?.promptRole === 'opening-hand'
        ? 'Opening hand'
        : 'Choose an action',
    explain: isStartingChoice ? 'Choose whether to play first or second.' : explain,
    choices,
    textInput: null,
    truncated: !decision.complete,
    truncationWarning: 'The backend capped this enumeration, so some legal moves are not listed.',
  };
}

/** The contract supplies both validation bounds and the opaque-id constructor. */
function TextMove(props: {
  readonly input: TextDecisionInput;
  readonly submitting: boolean;
  readonly submit: (id: string) => void;
}): ReactElement {
  const [value, setValue] = useState('');
  const answer = value.trim();
  const valid = answer.length >= props.input.minLength && answer.length <= props.input.maxLength;
  return createElement(
    'form',
    {
      className: 'mtg-choices mtg-choices__text',
      role: 'group',
      'aria-label': LEGAL_MOVES_LABEL,
      onSubmit: (event: { preventDefault(): void }): void => {
        event.preventDefault();
        if (valid && !props.submitting) props.submit(textSubmission(props.input, answer));
      },
    },
    createElement(
      'label',
      { className: 'mtg-choices__group-title', htmlFor: 'mtg-backend-answer' },
      props.input.label,
    ),
    createElement('input', {
      className: 'mtg-input',
      id: 'mtg-backend-answer',
      name: 'backend-answer',
      type: 'text',
      value,
      minLength: props.input.minLength,
      maxLength: props.input.maxLength,
      autoComplete: 'off',
      onChange: (event: { currentTarget: { value: string } }): void => setValue(event.currentTarget.value),
    }),
    createElement(
      'button',
      { type: 'submit', className: 'mtg-btn', disabled: !valid || props.submitting },
      'Submit answer',
    ),
  );
}

function resultPanel(text: string, onNewGame: (() => void) | undefined): ReactElement {
  return createElement(
    'section',
    { className: 'mtg-panel mtg-prompt' },
    createElement(
      'div',
      { className: 'mtg-panel__head' },
      createElement('span', { className: 'mtg-panel__title' }, 'Game over'),
    ),
    createElement(
      'div',
      { className: 'mtg-panel__body' },
      createElement('p', null, text),
      onNewGame === undefined
        ? null
        : createElement('button', { type: 'button', className: 'mtg-btn', onClick: onNewGame }, 'New game'),
    ),
  );
}

/**
 * Who won the opening roll, said from what this shell saw rather than from a
 * backend sentence, because Forge logs no coin toss and its adapter is frozen
 * under the printed admissions. The bridge asks the roll's winner who plays
 * first, so a local seat that sat through the pregame without being asked lost
 * the roll; a seat that was asked saw the answer in its own prompt.
 */
function openingRollText(names: readonly [string, string], viewer: SeatId, active: SeatId): string {
  const winner = names[viewer === 0 ? 1 : 0];
  return active === viewer
    ? `${winner} won the die roll and let you play first.`
    : `${winner} won the die roll and ${seatVerb(winner, 'plays', 'play')} first.`;
}

function phaseStatus(state: PlaySessionControllerState, quietMove: string | null = null): ReactNode {
  if (state.phase === 'submitting') {
    return state.move === quietMove ? null : createElement('p', { role: 'status' }, SUBMITTING_MOVE_LABEL);
  }
  if (state.phase === 'finished') return createElement('p', { role: 'status' }, resultText(state));
  if (state.phase === 'error') {
    return createElement(
      'p',
      { className: 'mtg-prompt__warning', role: 'alert' },
      describeBackendOpenFailure(state.error),
    );
  }
  return null;
}

interface ObservedCombatBeat {
  readonly kind: CombatBeat;
  readonly key: string;
  readonly sentence: string;
}

/**
 * The combat frame an observed projection can prove from shared facts alone.
 *
 * Priority follows each turn-based combat action, so an exact automatic pass
 * at one of these steps is the same no-question boundary where kernel play
 * pauses. At least one projected attacker is required: merely entering an
 * empty combat step is not something the normal table stops to show.
 */
function observedCombatBeat(
  view: TableView,
  play: PlayInteraction | undefined,
  beats: BeatSet,
): ObservedCombatBeat | null {
  const attacking = seatViewOf(view, view.turn.active).battlefield.filter((object) => object.attacking);
  if (attacking.length === 0) return null;
  let kind: CombatBeat | null = null;
  if (play?.turnStep === 'declareAttackers') kind = 'attackers';
  if (play?.turnStep === 'declareBlockers') kind = 'blockers';
  if (play?.turnStep === 'firstStrikeDamage' || play?.turnStep === 'combatDamage') kind = 'damage';
  if (kind === null || !beats.has(kind)) return null;
  const attacker = seatViewOf(view, view.turn.active).name;
  const creatures = attacking.length === 1 ? '1 creature' : `${String(attacking.length)} creatures`;
  const sentence =
    kind === 'attackers'
      ? `${attacker} ${seatVerb(attacker, 'is', 'are')} attacking with ${creatures}.`
      : kind === 'blockers'
        ? 'Blockers have been declared.'
        : 'Combat damage is dealt.';
  return {
    kind,
    key: `${String(view.turn.number)}:${String(view.turn.active)}:${kind}`,
    sentence,
  };
}

/** Opens one backend session per mounted component and releases it on cleanup. */
export function BackendGame(props: BackendGameProps): ReactElement {
  const [opening] = useState(() => ({ backend: props.backend, table: props.table, feed: props.feed }));
  const [controller, setController] = useState<PlaySessionController | null>(null);
  const [autoPass, setAutoPass] = useState(DEFAULT_AUTO_PASS);
  const [beats] = useState<BeatSet>(DEFAULT_BEATS);
  const [acknowledgedBeat, setAcknowledgedBeat] = useState<string | null>(null);
  const [stageAllAttackers, setStageAllAttackers] = useState(false);
  // Who the next attacker is sent at, and who each staged one was. Both empty
  // until the player answers, which is the point (`./attack-targets.ts`).
  const [pickedDefender, setPickedDefender] = useState<string | null>(null);
  const [assignedDefenders, setAssignedDefenders] = useState<ReadonlyMap<string, AttackDefender>>(
    () => new Map(),
  );
  const [undoRefusal, setUndoRefusal] = useState<{
    readonly submitted: number;
    readonly projectionVersion: number;
    readonly text: string;
  } | null>(null);
  // Pregame as this shell saw it: nothing yet, the opening hand without a
  // starting choice, or the starting choice itself. Only the middle state can
  // say the other seat won the roll; a session joined at turn one says nothing.
  const [pregame, setPregame] = useState<'unseen' | 'seen' | 'chosen'>('unseen');
  const [openingRoll, setOpeningRoll] = useState<string | null>(null);
  const coarse = useCoarsePointer();

  // React development StrictMode runs a setup/cleanup/setup cycle in one
  // commit. Defer creation by one microtask so that discarded setup can cancel
  // before it starts a real backend subprocess. The surviving setup still owns
  // and releases the one live session on an actual unmount.
  useEffect((): (() => void) => {
    let active = true;
    let next: PlaySessionController | null = null;
    queueMicrotask(() => {
      if (!active) return;
      next = createPlaySessionController(
        opening.backend,
        opening.table,
        opening.feed === undefined ? {} : { feed: opening.feed },
      );
      setController(next);
    });
    const stopWatching = onPageLeft(() => {
      if (next !== null) void next.close();
    });
    return () => {
      active = false;
      stopWatching();
      if (next !== null) void next.close();
    };
  }, [opening]);

  const state = useSyncExternalStore(
    controller?.subscribe ?? subscribeToNothing,
    controller?.getSnapshot ?? openingSnapshot,
    controller?.getSnapshot ?? openingSnapshot,
  );
  const session = state.session;
  const decision = session?.decision ?? null;
  const viewer: SeatId = session?.localSeats[0] ?? 0;
  useEffect((): void => {
    if (session === null || session.play === undefined) return;
    if (session.play.automatic?.reason === 'local-starts') {
      setPregame('chosen');
      return;
    }
    if (session.play.turnStep === null) {
      setPregame((seen) => (seen === 'unseen' ? 'seen' : seen));
      return;
    }
    // Two players roll for the first turn. A pod's order is not a roll one of
    // them lost, so there is no sentence to say about it.
    if (
      pregame === 'seen' &&
      openingRoll === null &&
      session.view.turn.number === 1 &&
      session.view.seats.length === 2
    ) {
      setOpeningRoll(
        openingRollText(
          [session.view.seats[0].name, session.view.seats[1].name],
          viewer,
          session.view.turn.active,
        ),
      );
    }
  }, [openingRoll, pregame, session, viewer]);
  const routineAutomatic = session === null ? null : automaticBackendMove(session, viewer);
  const passAutomatic =
    session === null || routineAutomatic !== null ? null : automaticBackendPass(session, viewer, autoPass);
  const proposedBeat =
    session === null || passAutomatic === null ? null : observedCombatBeat(session.view, session.play, beats);
  const combatBeat = proposedBeat?.key === acknowledgedBeat ? null : proposedBeat;
  const automatic = routineAutomatic ?? (combatBeat === null ? passAutomatic : null);
  const hiddenAutomatic = routineAutomatic ?? passAutomatic;
  // A routine adapter/controller move is not a human choice. Keep its old
  // decision hidden while the exact submission is in flight as well as during
  // the first effect pass, so setup and payment cannot flash a fallback panel.
  const interactiveDecision = state.phase === 'awaiting' && hiddenAutomatic === null ? decision : null;
  const declaredPass = session?.play?.passPriority ?? null;
  const passId =
    state.phase === 'awaiting' &&
    interactiveDecision !== null &&
    interactiveDecision.seat === viewer &&
    session?.view.priority === viewer &&
    declaredPass !== null &&
    interactiveDecision.options.some((option) => option.id === declaredPass)
      ? declaredPass
      : null;
  const onPass = useCallback((): void => {
    if (passId !== null) void controller?.submit(passId);
  }, [controller, passId]);
  const onContinue = useCallback((): void => {
    if (combatBeat === null || passAutomatic === null) return;
    setAcknowledgedBeat(combatBeat.key);
    void controller?.submit(passAutomatic);
  }, [combatBeat, controller, passAutomatic]);
  const declaredUndo = session?.play?.undo ?? null;
  const undoId =
    state.phase === 'awaiting' &&
    interactiveDecision !== null &&
    interactiveDecision.seat === viewer &&
    declaredUndo !== null &&
    interactiveDecision.options.some((option) => option.id === declaredUndo)
      ? declaredUndo
      : null;
  const onUndo = useCallback((): void => {
    if (undoId !== null) {
      setUndoRefusal(null);
      void controller?.submit(undoId);
      return;
    }
    if (session === null) return;
    setUndoRefusal({
      submitted: session.submitted,
      projectionVersion: session.view.version,
      text: state.phase === 'submitting' || automatic !== null ? UNDO_IN_FLIGHT_REFUSAL : UNDO_COMMIT_REFUSAL,
    });
  }, [automatic, controller, session, state.phase, undoId]);
  const passKeyNote = usePassKey({
    pass: combatBeat === null ? (passId === null ? null : onPass) : onContinue,
    decisions: session?.submitted ?? 0,
  });
  const labels =
    session === null || interactiveDecision === null ? [] : labelDecision(interactiveDecision, session.view);
  const names = session === null ? null : session.view.seats.map((seat) => seat.name);
  const declaredPriority =
    session !== null &&
    names !== null &&
    interactiveDecision !== null &&
    declaredPass !== null &&
    session.view.priority === interactiveDecision.seat &&
    interactiveDecision.options.some((option) => option.id === declaredPass);
  const prompt =
    session === null || interactiveDecision === null || interactiveDecision.input !== undefined
      ? null
      : backendPrompt(
          interactiveDecision,
          labels,
          session.play,
          declaredPriority ? priorityHolderText(session.view.priority, names!) : interactiveDecision.prompt,
          visibleObjects(session.view).map((object) => object.oid),
        );
  const offered = new Set(interactiveDecision?.options.map((option) => option.id) ?? []);
  const attackerRole = session?.play?.attackers ?? null;
  const attackerActions =
    state.phase === 'awaiting' &&
    interactiveDecision?.seat === viewer &&
    session?.play?.turnStep === 'declareAttackers' &&
    attackerRole !== null &&
    offered.has(attackerRole.confirm)
      ? session.play.objectActions.filter((action) => action.category === 'combat')
      : [];
  const stagedAttackers = new Set(attackerRole?.staged ?? []);
  const attackPlanned =
    session === null || attackerRole === null
      ? null
      : attackPlan(attackerActions, offered, stagedAttackers, describeDefender(session.view));
  const attackConfirm =
    attackPlanned !== null && attackerRole !== null
      ? labels.findIndex((label) => label.id === attackerRole.confirm)
      : -1;
  // Whom the next creature goes at, and whom each staged one was sent at. Only
  // this surface knows the second: the projection says a creature attacks and
  // not at whom, so what was submitted is what is shown.
  const attackTargeted =
    attackPlanned === null
      ? null
      : attackTargeting(attackPlanned, stagedAttackers, assignedDefenders, pickedDefender, setPickedDefender);
  const attackPicked = attackTargeted?.picked ?? null;
  const attackQuestion = attackTargeted !== null;
  const attackEligible =
    attackPlanned === null || attackConfirm < 0
      ? new Set<string>()
      : new Set(
          [...attackPlanned.creatures].filter(
            (oid) =>
              attackPlanned.move(oid, attackPicked) !== null &&
              (!attackQuestion || attackPicked !== null || stagedAttackers.has(oid)),
          ),
        );
  const stageAttacker = (oid: string): void => {
    const move = attackPlanned?.move(oid, attackPicked) ?? null;
    if (move === null) return;
    // Recorded before it is sent, so the count on the picker is never behind
    // the click. A creature taken back out forgets its defender.
    setAssignedDefenders((was) => {
      const next = new Map(was);
      const defender = attackTargeted?.options.find((option) => option.key === attackPicked);
      if (stagedAttackers.has(oid) || defender === undefined) next.delete(oid);
      else next.set(oid, defender);
      return next;
    });
    void controller?.submit(move);
  };
  const staging: AttackStaging =
    attackConfirm < 0
      ? NO_STAGING
      : {
          eligible: attackEligible,
          staged: stagedAttackers,
          toggle: stageAttacker,
          stageAll: (): void => setStageAllAttackers(true),
          confirm: attackConfirm,
          ...(attackTargeted === null ? {} : { targets: attackTargeted }),
        };
  useEffect((): void => {
    if (attackerRole !== null) return;
    // The declaration is over, so the next one asks again from nothing.
    setPickedDefender(null);
    setAssignedDefenders((was) => (was.size === 0 ? was : new Map()));
  }, [attackerRole]);
  useEffect((): void => {
    if (!stageAllAttackers) return;
    if (state.phase === 'submitting' || state.phase === 'opening') return;
    if (attackConfirm < 0) {
      setStageAllAttackers(false);
      return;
    }
    const next = [...attackEligible].find((oid) => !stagedAttackers.has(oid));
    if (next === undefined) {
      setStageAllAttackers(false);
      return;
    }
    stageAttacker(next);
  });
  const byObject = prompt === null ? new Map<string, readonly PlayChoice[]>() : choicesByObject(prompt);
  const byPlayer = new Map(
    [...movesBySeat(viewer, interactiveDecision, session?.play)].map(([seat, ids]) => [
      seat,
      ids.flatMap((id) => {
        const index = labels.findIndex((label) => label.id === id);
        return index < 0 || prompt === null ? [] : [prompt.choices[index]!];
      }),
    ]),
  );
  const selection = useEnumeratedSelection({
    decisions: session?.submitted ?? 0,
    byObject,
    onChoose: (index): void => {
      const id = labels[index]?.id;
      if (id !== undefined) void controller?.submit(id);
    },
    coarse,
  });
  const slot: AskSlot =
    combatBeat !== null
      ? { kind: 'halt' }
      : interactiveDecision === null
        ? state.phase === 'finished'
          ? { kind: 'report' }
          : { kind: 'idle' }
        : { kind: 'decision', count: labels.length };
  useEffect((): void => {
    if (state.phase !== 'error' || state.session !== null) return;
    if (isGatewayStarting(state.error)) return;
    props.onOpenFailure?.(describeBackendOpenFailure(state.error));
  }, [props.onOpenFailure, state]);
  useEffect((): (() => void) | void => {
    if (state.phase !== 'error' || state.session !== null) return;
    if (!isGatewayStarting(state.error)) return;
    const timer = setTimeout(() => controller?.retryOpen(), GATEWAY_STARTING_RETRY_MS);
    return () => clearTimeout(timer);
  }, [controller, state]);
  useEffect((): void => {
    if (state.phase !== 'awaiting') return;
    if (automatic !== null) void controller?.submit(automatic);
  }, [automatic, controller, state.phase]);

  if (state.phase === 'opening') {
    return createElement('p', { role: 'status' }, OPENING_SESSION_LABEL);
  }
  if (state.phase === 'closed') {
    return createElement('p', { role: 'status' }, CLOSED_SESSION_LABEL);
  }
  if (session === null) {
    return createElement(
      'div',
      { className: 'mtg-live', 'data-session-phase': state.phase },
      phaseStatus(state),
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-btn',
          onClick: (): void => {
            void controller?.close();
            props.onClose?.();
          },
        },
        CLOSE_GAME_LABEL,
      ),
    );
  }

  const viewerName = seatViewOf(session.view, viewer).name;
  const result = state.phase === 'finished' ? resultText(state) : null;
  const combatDamage = session.play?.combatDamage ?? null;
  const decisionContent =
    combatBeat !== null
      ? presentedBeatPanel(combatBeat.kind, combatBeat.sentence, onContinue)
      : interactiveDecision === null
        ? result === null
          ? null
          : resultPanel(result, props.onNewGame)
        : interactiveDecision.input === undefined
          ? promptPanel(
              prompt!,
              (choice) => {
                if (typeof choice !== 'number') return;
                const id = labels[choice]?.id;
                if (id !== undefined) void controller?.submit(id);
              },
              session.submitted,
            )
          : createElement(
              'section',
              {
                className:
                  combatDamage === null ? 'mtg-panel mtg-prompt' : 'mtg-panel mtg-prompt mtg-prompt--damage',
              },
              createElement(
                'div',
                { className: 'mtg-panel__head' },
                createElement(
                  'span',
                  { className: 'mtg-panel__title' },
                  combatDamage === null ? 'Supply an answer' : 'Assign combat damage',
                ),
                createElement(
                  'span',
                  { className: 'mtg-panel__note' },
                  combatDamage === null ? 'Free text' : `${String(combatDamage.total)} total`,
                ),
              ),
              createElement(
                'div',
                { key: `decision-${String(session.submitted)}`, className: 'mtg-panel__body' },
                createElement('p', { className: 'mtg-prompt__explain' }, interactiveDecision.prompt),
                combatDamage === null
                  ? createElement(TextMove, {
                      input: interactiveDecision.input,
                      submitting: state.phase === 'submitting',
                      submit: (id): void => {
                        void controller?.submit(id);
                      },
                    })
                  : createElement(CombatDamageMove, {
                      assignment: combatDamage,
                      input: interactiveDecision.input,
                      submitting: state.phase === 'submitting',
                      submit: (id): void => {
                        void controller?.submit(id);
                      },
                    }),
              ),
            );
  const stepText = `${session.view.turn.phase} · ${session.view.turn.step}`;
  const fixedPriority = priorityFoot({
    holder: session.view.priority,
    names: names!,
    stackDepth: session.view.stack.length,
    overYourOwn: passId !== null && session.view.stack.at(-1)?.controller === viewer,
    stepText,
    passAt: passId === null ? null : 0,
    onPass,
    keyNote: passKeyNote,
    ...(session.status === 'awaiting' && session.play !== undefined
      ? { canUndo: undoId !== null, onUndo }
      : {}),
  });
  const steps =
    session.play === undefined
      ? null
      : stepBar({
          step: session.play.turnStep,
          turnText: `Turn ${String(session.view.turn.number)}: ${seatViewOf(session.view, session.view.turn.active).name}`,
          stepText,
          autoPass,
          onAutoPass: setAutoPass,
          canYield: false,
          beats,
        });
  const suppliedPrintings = props.printedCards ?? [];
  const suppliedBasics = new Set(
    suppliedPrintings.filter(isBasicLandPrinting).map((card) => card.name.toLocaleLowerCase()),
  );
  const printingPresentation = [
    ...BASIC_LAND_PRINTINGS.filter((card) => !suppliedBasics.has(card.name.toLocaleLowerCase())),
    ...OFFICIAL_TOKEN_PRINTINGS,
    ...suppliedPrintings,
  ];
  const position = backendBoardPosition(session.view, viewer, printingPresentation, session.play);
  const tableSelection: TableSelection = {
    ...selection,
    declaration: null,
    ordering: null,
    targeting: null,
  };
  const close = (): void => {
    void controller?.close();
    props.onClose?.();
  };
  const toolbar =
    props.toolbar ??
    createElement('button', { type: 'button', className: 'mtg-btn', onClick: close }, CLOSE_GAME_LABEL);
  const currentUndoRefusal =
    undoRefusal?.submitted === session.submitted && undoRefusal.projectionVersion === session.view.version
      ? createElement('p', { className: 'mtg-prompt__warning', role: 'alert' }, undoRefusal.text)
      : null;

  return createElement(
    'div',
    { className: 'mtg-live', 'data-session-phase': state.phase },
    createElement(PlaySurface, {
      seatName: viewerName,
      slot,
      panel: decisionContent,
      priority: fixedPriority,
      steps,
      stepText,
      choicesMade: session.submitted,
      decisions: session.submitted,
      events: session.events.length,
      opensItself:
        session.play?.promptRole === 'opening-hand' || session.play?.automatic?.reason === 'local-starts',
      toolbar,
      status:
        phaseStatus(state, declaredPass) ??
        currentUndoRefusal ??
        (openingRoll !== null && session.view.turn.number === 1
          ? createElement('p', { className: 'mtg-page-note' }, openingRoll)
          : null),
      projectionVersion: session.view.version,
      inspect: (key): ReturnType<typeof findInspected> => findInspected(position, key),
      contextRail: (inspected, reveal): ReactNode =>
        createElement(PlayContextRail, {
          entries: position.stack.entries,
          history: createElement(BackendEventLog, {
            events: session.events,
            localSeat: viewerName,
            openingRoll,
          }),
          inspected,
          reveal,
        }),
      table: {
        position,
        viewer,
        byObject,
        byPlayer,
        selection: tableSelection,
        staging,
        combat: attackControls(staging, (choice): void => {
          if (typeof choice !== 'number') return;
          const id = labels[choice]?.id;
          if (id !== undefined) void controller?.submit(id);
        }),
        onResolve: passId === null ? null : onPass,
      },
      onEscape: (): boolean => {
        if (selection.openKey === null) return false;
        selection.dismiss();
        return true;
      },
    }),
  );
}
