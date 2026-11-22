/** Choice collection and APNAP commit ordering for simultaneous battlefield entries. */
import {
  COLORS,
  isAuraCard,
  printedEntryReplacement,
  type Card,
  type Color,
  type EntryCharacteristicMode,
} from '@mtg/dsl';
import { isLegalAuraEntryHost } from './attach';
import type { ObjectId, PlayerId } from './ids';
import { controllerOf, hasCardType, isCreatureObject } from './layers';
import type { ReplacementEffect } from './replacement-effects';
import {
  apnapOrder,
  copiableCardOf,
  type GameObject,
  type GameState,
  type EntryCounterKind,
  type PendingBattlefieldEntry,
  type PendingBattlefieldEntryBatch,
} from './state';
import type { Trace } from './trace';
import { withState } from './trace';

export interface ResolvedEntryChoices {
  readonly copiedCard?: Card | null;
  readonly counterPermanent?: ObjectId;
  readonly chosenPlayer?: PlayerId;
  readonly chosenCardName?: string;
  readonly chosenColors?: readonly Color[];
  readonly characteristicsMode?: EntryCharacteristicMode;
  readonly auraHost?: ObjectId | null;
  /** Present, including null, once an optional entry-counter choice is answered. */
  readonly optionalCounter?: { readonly counter: EntryCounterKind; readonly count: number } | null;
  /** Present once a pay-life-or-enter-tapped replacement has been answered. */
  readonly paidEntryLife?: boolean;
}

export type EntryChoiceRequest =
  | { readonly kind: 'copy'; readonly creatures: readonly ObjectId[] }
  | { readonly kind: 'counter'; readonly permanents: readonly ObjectId[] }
  | { readonly kind: 'characteristics'; readonly modes: readonly EntryCharacteristicMode[] }
  | { readonly kind: 'optionalCounter'; readonly counter: EntryCounterKind; readonly count: number }
  | { readonly kind: 'payLife'; readonly life: number }
  | { readonly kind: 'player' }
  | { readonly kind: 'cardName' }
  | { readonly kind: 'colors'; readonly pairs: readonly (readonly [Color, Color])[] }
  | { readonly kind: 'aura'; readonly permanents: readonly ObjectId[] }
  | { readonly kind: 'auraUnavailable' };

export type CommitBattlefieldEntry = (
  trace: Trace,
  entry: PendingBattlefieldEntry,
  batch: PendingBattlefieldEntryBatch,
) => Trace;

function objectAt(state: GameState, oid: ObjectId): GameObject {
  const object = state.objects[oid];
  if (object === undefined) throw new Error(`unknown game object: ${oid}`);
  return object;
}

/** Materializes one replacement choice as layer-1 copiable card values. */
export function cardWithEntryCharacteristics(card: Card, mode: EntryCharacteristicMode): Card {
  if (card.kind !== 'creature') {
    throw new Error('cardWithEntryCharacteristics: only a creature can choose creature characteristics');
  }
  return {
    ...card,
    power: mode.power,
    toughness: mode.toughness,
    subtypes: [...new Set([...card.subtypes, ...(mode.addSubtypes ?? [])])],
    keywords: [...new Set([...card.keywords, ...(mode.addKeywords ?? [])])],
    keywordAbilities: [...(card.keywordAbilities ?? []), ...(mode.addKeywordAbilities ?? [])],
  };
}

function copiedCardWasChosen(resolved: ResolvedEntryChoices): boolean {
  return Object.prototype.hasOwnProperty.call(resolved, 'copiedCard');
}

export function entryCardOf(object: GameObject, resolved: ResolvedEntryChoices): Card {
  const copied = resolved.copiedCard ?? copiableCardOf(object);
  return resolved.characteristicsMode === undefined
    ? copied
    : cardWithEntryCharacteristics(copied, resolved.characteristicsMode);
}

/** The next as-entry decision, read without moving the object. */
export function entryChoiceFor(
  state: GameState,
  oid: ObjectId,
  controller: PlayerId,
  resolved: ResolvedEntryChoices,
): EntryChoiceRequest | null {
  const object = objectAt(state, oid);
  if (
    !copiedCardWasChosen(resolved) &&
    printedEntryReplacement(copiableCardOf(object))?.kind === 'entersAsCopyOfCreature'
  ) {
    return {
      kind: 'copy',
      creatures: state.battlefield.filter((candidate) => isCreatureObject(state, candidate)),
    };
  }
  const current = printedEntryReplacement(resolved.copiedCard ?? copiableCardOf(object));
  if (resolved.paidEntryLife === undefined && current?.kind === 'payLifeOrEntersTapped') {
    return { kind: 'payLife', life: current.life };
  }
  if (resolved.characteristicsMode === undefined && current?.kind === 'entersAsCharacteristicChoice') {
    return { kind: 'characteristics', modes: current.modes };
  }
  if (resolved.counterPermanent === undefined && current?.kind === 'putCounterOnControlledPermanent') {
    const permanents = state.battlefield.filter(
      (candidate) =>
        controllerOf(state, candidate) === controller && hasCardType(state, candidate, current.permanentType),
    );
    return permanents.length === 0 ? null : { kind: 'counter', permanents };
  }
  if (resolved.chosenPlayer === undefined && current?.kind === 'choosePlayer') {
    return { kind: 'player' };
  }
  if (resolved.chosenCardName === undefined && current?.kind === 'chooseCardName') {
    return { kind: 'cardName' };
  }
  if (resolved.chosenColors === undefined && current?.kind === 'chooseTwoColors') {
    return {
      kind: 'colors',
      pairs: COLORS.flatMap((left, index) => COLORS.slice(index + 1).map((right) => [left, right] as const)),
    };
  }
  const entryCard = entryCardOf(object, resolved);
  if (
    resolved.optionalCounter === undefined &&
    entryCard.keywordAbilities?.some((ability) => ability.kind === 'unleash') === true
  ) {
    return { kind: 'optionalCounter', counter: 'plusOnePlusOne', count: 1 };
  }
  if (resolved.auraHost === undefined && isAuraCard(entryCard)) {
    const permanents = state.battlefield.filter((host) => isLegalAuraEntryHost(state, entryCard, host));
    return permanents.length === 0 ? { kind: 'auraUnavailable' } : { kind: 'aura', permanents };
  }
  return null;
}

export function awaitEntryChoice(
  trace: Trace,
  item: PendingBattlefieldEntry,
  choice: Exclude<EntryChoiceRequest, { readonly kind: 'auraUnavailable' }>,
): Trace {
  const common = {
    player: item.controller,
    oid: item.oid,
    controller: item.controller,
    tapped: item.tapped,
  } as const;
  const waiting = {
    ...trace.state.turn,
    priority: null,
    awaitingPlayer: item.controller,
  };
  switch (choice.kind) {
    case 'copy':
      return withState(trace, {
        ...trace.state,
        turn: { ...waiting, awaiting: 'entryCopy' },
        pendingEntryCopy: { ...common, creatures: choice.creatures },
      });
    case 'counter':
      return withState(trace, {
        ...trace.state,
        turn: { ...waiting, awaiting: 'entryCounter' },
        pendingEntryCounterChoice: {
          ...common,
          permanents: choice.permanents,
          copiedCard: item.copiedCard ?? null,
        },
      });
    case 'characteristics':
      return withState(trace, {
        ...trace.state,
        turn: { ...waiting, awaiting: 'entryCharacteristics' },
        pendingEntryCharacteristicsChoice: {
          ...common,
          modes: choice.modes,
          copiedCard: item.copiedCard ?? null,
        },
      });
    case 'optionalCounter':
      return withState(trace, {
        ...trace.state,
        turn: { ...waiting, awaiting: 'entryOptionalCounter' },
        pendingEntryOptionalCounterChoice: {
          player: item.controller,
          entry: item,
          counter: choice.counter,
          count: choice.count,
        },
      });
    case 'payLife':
      return withState(trace, {
        ...trace.state,
        turn: { ...waiting, awaiting: 'entryPayLife' },
        pendingEntryPayLifeChoice: {
          player: item.controller,
          entry: item,
          life: choice.life,
        },
      });
    case 'player':
      return withState(trace, {
        ...trace.state,
        turn: { ...waiting, awaiting: 'entryPlayer' },
        pendingEntryPlayerChoice: {
          ...common,
          copiedCard: item.copiedCard ?? null,
        },
      });
    case 'cardName':
      return withState(trace, {
        ...trace.state,
        turn: { ...waiting, awaiting: 'cardName' },
        pendingEntryCardNameChoice: {
          ...common,
          copiedCard: item.copiedCard ?? null,
        },
      });
    case 'colors':
      return withState(trace, {
        ...trace.state,
        turn: { ...waiting, awaiting: 'entryColors' },
        pendingEntryColorsChoice: {
          ...common,
          copiedCard: item.copiedCard ?? null,
        },
      });
    case 'aura':
      return withState(trace, {
        ...trace.state,
        turn: { ...waiting, awaiting: 'entryAura' },
        pendingEntryAuraChoice: {
          player: item.controller,
          entry: item,
          permanents: choice.permanents,
        },
      });
  }
}

/** A view in which none of this simultaneous cohort has entered yet. */
export function entryBatchEvaluationState(state: GameState, batch: PendingBattlefieldEntryBatch): GameState {
  const baselineContinuous = new Set(batch.baselineContinuousIds);
  const baselineReplacements = new Set(batch.baselineReplacementIds);
  return {
    ...state,
    battlefield: batch.baselineBattlefield,
    continuous: state.continuous.filter((effect) => baselineContinuous.has(effect.id)),
    replacements: state.replacements.filter((effect) => baselineReplacements.has(effect.id)),
  };
}

/** Keeps batch-created records while carrying consumed baseline replacements forward. */
export function mergeEntryBatchReplacements(
  state: GameState,
  evaluated: readonly ReplacementEffect[],
  batch: PendingBattlefieldEntryBatch,
): readonly ReplacementEffect[] {
  const baseline = new Set(batch.baselineReplacementIds);
  return [...evaluated, ...state.replacements.filter((effect) => !baseline.has(effect.id))];
}

/** Gives every cohort-entry trigger the one post-event state CR 603.2 observes. */
function bindEntryBatchEventsToFinalState(trace: Trace, from: number, cohort: readonly ObjectId[]): Trace {
  if (trace.eventStates === undefined) return trace;
  const cohortIds = new Set(cohort);
  return {
    ...trace,
    eventStates: trace.eventStates.map((state, index) => {
      if (index < from) return state;
      const event = trace.events[index];
      return event?.type === 'permanentEntered' && cohortIds.has(event.oid) ? trace.state : state;
    }),
  };
}

export function startBattlefieldEntryBatch(
  trace: Trace,
  remaining: readonly PendingBattlefieldEntry[],
  commit: CommitBattlefieldEntry,
): Trace {
  if (remaining.length === 0) return trace;
  const apnapRemaining = apnapOrder(trace.state).flatMap((player) =>
    remaining.filter((entry) => entry.controller === player),
  );
  const batch: PendingBattlefieldEntryBatch = {
    baselineBattlefield: trace.state.battlefield,
    baselineContinuousIds: trace.state.continuous.map((effect) => effect.id),
    baselineReplacementIds: trace.state.replacements.map((effect) => effect.id),
    cohort: apnapRemaining.map((item) => item.oid),
    prepared: [],
    remaining: apnapRemaining,
  };
  return continueBattlefieldEntryBatch(
    withState(trace, { ...trace.state, pendingBattlefieldEntryBatch: batch }),
    commit,
  );
}

export function continueBattlefieldEntryBatch(trace: Trace, commit: CommitBattlefieldEntry): Trace {
  let current = trace;
  for (;;) {
    const batch = current.state.pendingBattlefieldEntryBatch;
    if (batch === undefined) throw new Error('continueBattlefieldEntryBatch: no batch is pending');
    const item = batch.remaining[0];
    if (item !== undefined) {
      const choice = entryChoiceFor(current.state, item.oid, item.controller, item);
      if (choice?.kind === 'auraUnavailable') {
        current = withState(current, {
          ...current.state,
          pendingBattlefieldEntryBatch: {
            ...batch,
            remaining: [{ ...item, auraHost: null }, ...batch.remaining.slice(1)],
          },
        });
        continue;
      }
      if (choice !== null) return awaitEntryChoice(current, item, choice);
      current = withState(current, {
        ...current.state,
        pendingBattlefieldEntryBatch: {
          ...batch,
          prepared: [...batch.prepared, item],
          remaining: batch.remaining.slice(1),
        },
      });
      continue;
    }

    if (batch.timestampGroups === undefined) {
      const timestampGroups = apnapOrder(current.state).map((player) => ({
        player,
        chosen: [],
        remaining: batch.prepared
          .filter((entry) => entry.auraHost !== null && entry.controller === player)
          .map((entry) => entry.oid),
      }));
      current = withState(current, {
        ...current.state,
        pendingBattlefieldEntryBatch: { ...batch, timestampGroups },
      });
      continue;
    }

    const normalizedGroups = batch.timestampGroups.map((group) =>
      group.remaining.length === 1
        ? { ...group, chosen: [...group.chosen, group.remaining[0]!], remaining: [] }
        : group,
    );
    const ordering = normalizedGroups.find((group) => group.remaining.length > 1);
    if (ordering !== undefined) {
      return withState(current, {
        ...current.state,
        turn: {
          ...current.state.turn,
          priority: null,
          awaiting: 'entryTimestampOrder',
          awaitingPlayer: ordering.player,
        },
        pendingBattlefieldEntryBatch: { ...batch, timestampGroups: normalizedGroups },
      });
    }

    const { pendingBattlefieldEntryBatch: _completed, ...withoutBatch } = current.state;
    current = withState(current, {
      ...withoutBatch,
      turn: { ...withoutBatch.turn, awaiting: null, awaitingPlayer: null },
    });
    const eventStart = current.events.length;
    const byOid = new Map(batch.prepared.map((entry) => [entry.oid, entry]));
    for (const oid of normalizedGroups.flatMap((group) => group.chosen)) {
      const prepared = byOid.get(oid);
      if (prepared === undefined) throw new Error(`continueBattlefieldEntryBatch: missing ${oid}`);
      current = commit(current, prepared, batch);
    }
    return bindEntryBatchEventsToFinalState(
      current,
      eventStart,
      batch.prepared.map((entry) => entry.oid),
    );
  }
}

export function answerBattlefieldEntryBatch(
  trace: Trace,
  oid: ObjectId,
  resolved: ResolvedEntryChoices,
  commit: CommitBattlefieldEntry,
): Trace {
  const batch = trace.state.pendingBattlefieldEntryBatch;
  if (batch === undefined) throw new Error('answerBattlefieldEntryBatch: no batch is pending');
  const current = batch.remaining[0];
  if (current?.oid !== oid) throw new Error(`answerBattlefieldEntryBatch: ${oid} is not the current entry`);
  return continueBattlefieldEntryBatch(
    withState(trace, {
      ...trace.state,
      pendingBattlefieldEntryBatch: {
        ...batch,
        remaining: [{ ...current, ...resolved }, ...batch.remaining.slice(1)],
      },
    }),
    commit,
  );
}

/** Banks one next-earliest object in the active CR 613.7m controller group. */
export function answerEntryTimestampNext(trace: Trace, oid: ObjectId, commit: CommitBattlefieldEntry): Trace {
  const batch = trace.state.pendingBattlefieldEntryBatch;
  const groups = batch?.timestampGroups;
  if (batch === undefined || groups === undefined) {
    throw new Error('answerEntryTimestampNext: no entry timestamp order is pending');
  }
  const index = groups.findIndex((group) => group.remaining.length > 1);
  const group = groups[index];
  if (group === undefined || !group.remaining.includes(oid)) {
    throw new Error(`answerEntryTimestampNext: ${oid} is not available`);
  }
  const updated = {
    ...group,
    chosen: [...group.chosen, oid],
    remaining: group.remaining.filter((candidate) => candidate !== oid),
  };
  return continueBattlefieldEntryBatch(
    withState(trace, {
      ...trace.state,
      turn: { ...trace.state.turn, awaiting: null, awaitingPlayer: null },
      pendingBattlefieldEntryBatch: {
        ...batch,
        timestampGroups: groups.map((candidate, position) => (position === index ? updated : candidate)),
      },
    }),
    commit,
  );
}
