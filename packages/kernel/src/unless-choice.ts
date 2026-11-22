/** CR 118.8 tolls attached to a resolving spell or triggered ability. */
import type {
  Card,
  CounterTargetSpellUnlessAbility,
  CounterTriggeringSpellOrAbilityAbility,
  ManaCost,
  SacrificeSelfUnlessControllerPaysAbility,
  SacrificeEnchantedPermanentUnlessControllerPaysManaValueAbility,
  UnlessClause,
} from '@mtg/dsl';
import {
  cardManaValue,
  isCounterTargetSpellUnlessAbility,
  isCounterTriggeringSpellOrAbilityAbility,
  isSacrificeSelfUnlessControllerPaysAbility,
  isSacrificeEnchantedPermanentUnlessControllerPaysManaValueAbility,
  spellEffectsFor,
} from '@mtg/dsl';
import { stackedAbilityAt } from './abilities';
import type { ObjectId, PlayerId } from './ids';
import { canPay } from './mana';
import type { GameState, StackEntry } from './state';
import { getObject } from './zones';
import { copiableValuesOf } from './layers';
import { spellCard } from './stack-spell';

interface StackUnlessBase {
  /** The object currently resolving and printing the toll. */
  readonly entry: StackEntry;
  readonly cost: ManaCost;
  readonly payer: PlayerId;
}

export type TolledStackObject =
  | (StackUnlessBase & {
      readonly kind: 'spell';
      readonly card: Card;
      readonly clause: UnlessClause;
    })
  | (StackUnlessBase & {
      readonly kind: 'counterTriggeringSpellOrAbility';
      readonly ability: CounterTriggeringSpellOrAbilityAbility;
      /** The spell or ability the resolving trigger will counter if unpaid. */
      readonly triggeringEntry: StackEntry;
    })
  | (StackUnlessBase & {
      readonly kind: 'counterTargetSpell';
      readonly ability: CounterTargetSpellUnlessAbility;
      readonly targetEntry: StackEntry;
    })
  | (StackUnlessBase & {
      readonly kind: 'sacrificeSelf';
      readonly ability: SacrificeSelfUnlessControllerPaysAbility;
    })
  | (StackUnlessBase & {
      readonly kind: 'sacrificeEnchantedPermanent';
      readonly ability: SacrificeEnchantedPermanentUnlessControllerPaysManaValueAbility;
      readonly permanent: ObjectId;
    });

/** The seat an ordinary spell's payer word names. */
export function unlessPayer(state: GameState, entry: StackEntry, clause: UnlessClause): PlayerId | null {
  const target = entry.targets[0];
  if (target === undefined || target === null) return null;
  if (clause.payer === 'targetPlayer') return target.kind === 'player' ? target.player : null;
  if (target.kind === 'permanent') return getObject(state, target.oid).controller;
  if (target.kind !== 'spell') return null;
  return (
    state.stack.find((candidate) => candidate.oid === target.oid && candidate.ability === null)?.controller ??
    null
  );
}

function spellUnless(state: GameState, entry: StackEntry): TolledStackObject | null {
  if (entry.ability !== null) return null;
  const card = spellCard(state, entry);
  if (card === null) return null;
  const selected = spellEffectsFor(card, entry.mode, 'ordinary');
  const counter = selected.length === 1 && selected[0]?.kind === 'counterSpell' ? selected[0] : undefined;
  const clause =
    card.unless ??
    (counter?.unlessCost === undefined
      ? undefined
      : ({
          payer: 'targetController',
          cost:
            'kind' in counter.unlessCost
              ? { generic: entry.x ?? 0, W: 0, U: 0, B: 0, R: 0, G: 0, hasX: false }
              : counter.unlessCost,
        } satisfies UnlessClause));
  if (clause === undefined) return null;
  const payer = unlessPayer(state, entry, clause);
  return payer === null ? null : { kind: 'spell', entry, card, clause, cost: clause.cost, payer };
}

function triggeredCounterUnless(state: GameState, entry: StackEntry): TolledStackObject | null {
  const reference = entry.ability;
  if (reference === null) return null;
  const printed = stackedAbilityAt(state, entry);
  if (printed === undefined || !isCounterTriggeringSpellOrAbilityAbility(printed)) return null;
  const context = entry.triggerContext;
  if (context?.kind !== 'selfBecomesTargetByOpponent') return null;
  const triggeringEntry = state.stack.find((candidate) => candidate.oid === context.triggeringStackObject);
  if (triggeringEntry === undefined) return null;
  return {
    kind: 'counterTriggeringSpellOrAbility',
    entry,
    ability: printed,
    triggeringEntry,
    cost: printed.counterTriggeringSpellOrAbilityUnless.cost,
    payer: triggeringEntry.controller,
  };
}

function activatedCounterUnless(state: GameState, entry: StackEntry): TolledStackObject | null {
  if (entry.ability === null) return null;
  const printed = stackedAbilityAt(state, entry);
  if (printed === undefined || !isCounterTargetSpellUnlessAbility(printed)) return null;
  const target = entry.targets[0];
  if (target?.kind !== 'spell') return null;
  const targetEntry = state.stack.find((candidate) => candidate.oid === target.oid);
  if (targetEntry === undefined) return null;
  return {
    kind: 'counterTargetSpell',
    entry,
    ability: printed,
    targetEntry,
    cost: printed.counterTargetSpellUnless.cost,
    payer: targetEntry.controller,
  };
}

/** A source controller's fixed price to stop its self-entry sacrifice. */
function triggeredSacrificeSelfUnless(state: GameState, entry: StackEntry): TolledStackObject | null {
  if (entry.ability === null) return null;
  const printed = stackedAbilityAt(state, entry);
  if (printed === undefined || !isSacrificeSelfUnlessControllerPaysAbility(printed)) return null;
  return {
    kind: 'sacrificeSelf',
    entry,
    ability: printed,
    cost: printed.sacrificeSelfUnlessControllerPays.cost,
    payer: entry.controller,
  };
}

/** Soul Tithe's live host, with the trigger-time host as source-LKI fallback. */
function triggeredSacrificeEnchantedPermanentUnless(
  state: GameState,
  entry: StackEntry,
): TolledStackObject | null {
  if (entry.ability === null) return null;
  const printed = stackedAbilityAt(state, entry);
  if (printed === undefined || !isSacrificeEnchantedPermanentUnlessControllerPaysManaValueAbility(printed)) {
    return null;
  }
  const context = entry.triggerContext;
  if (context?.kind !== 'beginningOfEachPlayersUpkeep') return null;
  const source = state.objects[entry.ability.sourceOid];
  const liveHost =
    source?.zone === 'battlefield' && (source.incarnation ?? 0) === entry.sourceBattlefieldIncarnation
      ? source.attachedTo
      : undefined;
  const permanent = liveHost ?? context.enchantedPermanent;
  if (permanent === undefined) return null;
  const object = state.objects[permanent];
  const expectedIncarnation =
    liveHost === undefined ? context.enchantedPermanentIncarnation : (object?.incarnation ?? 0);
  if (
    object?.zone !== 'battlefield' ||
    expectedIncarnation === undefined ||
    (object.incarnation ?? 0) !== expectedIncarnation
  ) {
    return null;
  }
  return {
    kind: 'sacrificeEnchantedPermanent',
    entry,
    ability: printed,
    permanent,
    cost: {
      generic: cardManaValue(copiableValuesOf(state, permanent)),
      W: 0,
      U: 0,
      B: 0,
      R: 0,
      G: 0,
      hasX: false,
    },
    payer: context.triggeringPlayer,
  };
}

/** The semantic toll on top, whether or not its payer can currently afford it. */
export function stackUnless(state: GameState): TolledStackObject | null {
  const entry = state.stack[state.stack.length - 1];
  if (entry === undefined) return null;
  return (
    spellUnless(state, entry) ??
    triggeredCounterUnless(state, entry) ??
    activatedCounterUnless(state, entry) ??
    triggeredSacrificeSelfUnless(state, entry) ??
    triggeredSacrificeEnchantedPermanentUnless(state, entry)
  );
}

/** The toll decision currently worth asking; unaffordable prices are automatic declines. */
export function stackAwaitingUnless(state: GameState): TolledStackObject | null {
  const pending = stackUnless(state);
  if (pending === null || !canPay(state, pending.payer, pending.cost)) return null;
  return pending;
}

/** Compatibility for callers interested only in ordinary spell-level tolls. */
export function spellAwaitingUnless(
  state: GameState,
): Extract<TolledStackObject, { readonly kind: 'spell' }> | null {
  const pending = stackAwaitingUnless(state);
  return pending?.kind === 'spell' ? pending : null;
}
