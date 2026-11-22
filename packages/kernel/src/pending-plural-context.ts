/** One source of truth for the effects and targeting source of a staged plural choice. */
import { effectsForActivatedAbility, isCastable, spellEffectsFor, type Effect } from '@mtg/dsl';
import type { ProtectionSource } from './keyword-abilities';
import { currentActivatedAbilityAt } from './layers';
import type { GameState, PendingPluralTargets } from './state';
import { triggerOnStack } from './trigger-choice';
import { getObject } from './zones';

export interface PendingPluralContext {
  readonly effects: readonly Effect[];
  readonly source: ProtectionSource;
}

export function pendingPluralContext(state: GameState, pending: PendingPluralTargets): PendingPluralContext {
  if (pending.origin === 'cast') {
    const physical = getObject(state, pending.oid);
    const free = pending.castingCost === 'withoutMana' ? state.pendingFreeCast : undefined;
    const card = free?.oid === pending.oid ? (free.card ?? physical.card) : physical.card;
    if (!isCastable(card)) throw new Error('pending plural cast no longer names a castable card');
    return { effects: spellEffectsFor(card, pending.mode ?? null, 'ordinary'), source: pending.oid };
  }
  if (pending.origin === 'activation') {
    const ability = currentActivatedAbilityAt(state, pending.oid, pending.abilityIndex ?? -1);
    if (ability === undefined) throw new Error('pending plural activation no longer names an ability');
    return {
      effects: effectsForActivatedAbility(ability, pending.mode ?? null),
      source: pending.oid,
    };
  }
  const trigger = triggerOnStack(state, pending.oid);
  if (trigger === null) throw new Error('pending plural trigger no longer exists');
  const source =
    state.objects[trigger.source]?.zone === 'battlefield'
      ? trigger.source
      : (trigger.entry.sourceCharacteristics ?? trigger.source);
  return { effects: trigger.ability.effects, source };
}
