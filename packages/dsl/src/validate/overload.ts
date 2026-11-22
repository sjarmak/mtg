/** Structural validation for a card's ordinary/Overload effect pair. */
import type { Card } from '../card';
import { canonicalJson } from '../canonical-json';
import { effectChoosesTarget, hasTarget, referentSourceIndex, type Effect } from '../effects';
import type { OverloadEffect } from '../overload';
import { targetFilterOf, targetRestrictionOf, type TargetFilter, type TargetSpec } from '../targets';
import type { Violation } from '../violations';
import { violation } from '../violations';
import { effectUsesChosenX } from './effects';

function withoutSelectionFields(effect: Effect | OverloadEffect): Readonly<Record<string, unknown>> {
  const record = { ...effect } as Record<string, unknown>;
  delete record.target;
  delete record.scope;
  delete record.scopeFilter;
  delete record.spellSelection;
  return record;
}

function restrictionFilter(target: TargetSpec): TargetFilter | null {
  const restriction = targetRestrictionOf(target);
  if (restriction === null) return null;
  switch (restriction.kind) {
    case 'withKeyword':
      return { keywords: [restriction.keyword] };
    case 'withoutKeyword':
      return { excludeKeywords: [restriction.keyword] };
    default:
      return null;
  }
}

function mergeFilter(base: TargetFilter, target: TargetSpec): TargetFilter | null {
  const authored = targetFilterOf(target) ?? {};
  const narrowed = restrictionFilter(target);
  if (targetRestrictionOf(target) !== null && narrowed === null) return null;
  return { ...base, ...authored, ...(narrowed ?? {}) };
}

interface ExpectedGroup {
  readonly scope: 'permanentsYouControl' | 'permanentsYouDontControl';
  readonly filter: TargetFilter;
}

function expectedGroup(target: TargetSpec): ExpectedGroup | null {
  const direction =
    target.kind === 'targetCreatureYouControl'
      ? 'permanentsYouControl'
      : target.kind === 'targetCreatureYouDontControl' ||
          target.kind === 'targetCreatureOpponentControls' ||
          target.kind === 'targetArtifactYouDontControl' ||
          target.kind === 'targetNonlandPermanentOpponentControls' ||
          target.kind === 'targetNonlandPermanentYouDontControl'
        ? 'permanentsYouDontControl'
        : null;
  if (direction === null) return null;
  const base: TargetFilter =
    target.kind === 'targetNonlandPermanentOpponentControls' ||
    target.kind === 'targetNonlandPermanentYouDontControl'
      ? { excludeCardTypes: ['land'] }
      : target.kind === 'targetArtifactYouDontControl'
        ? { cardTypes: ['artifact'] }
        : { cardTypes: ['creature'] };
  const filter = mergeFilter(base, target);
  return filter === null ? null : { scope: direction, filter };
}

function pairError(
  ordinary: Effect,
  overloaded: OverloadEffect,
  ordinaryEffects: readonly Effect[],
  index: number,
): string | null {
  if (ordinary.kind !== overloaded.kind) return 'ordinary and overloaded effects must use the same primitive';
  if (canonicalJson(withoutSelectionFields(ordinary)) !== canonicalJson(withoutSelectionFields(overloaded))) {
    return 'Overload may replace the selected cohort but may not change the effect payload';
  }
  if (ordinary.kind === 'counterSpell' && overloaded.kind === 'counterSpell') {
    return 'spellSelection' in overloaded && overloaded.spellSelection === 'spellsYouDontControl'
      ? null
      : 'the overloaded counter must select opposing spells';
  }
  const selectionEffect = effectChoosesTarget(ordinary)
    ? ordinary
    : hasTarget(ordinary) && ordinary.target.kind === 'thatCreature'
      ? ordinaryEffects[referentSourceIndex(ordinaryEffects, index) ?? -1]
      : undefined;
  if (selectionEffect === undefined || !hasTarget(selectionEffect) || !effectChoosesTarget(selectionEffect)) {
    return 'the ordinary effect must choose exactly one target or retain that same creature';
  }
  if (!hasTarget(ordinary) || !('target' in overloaded)) {
    return 'this Overload pair needs a typed ordinary target and an untargeted replacement';
  }
  const expected = expectedGroup(selectionEffect.target);
  if (expected === null) return 'the ordinary target has no supported structured Overload cohort';
  if (overloaded.target?.kind !== 'noTarget') return 'the overloaded replacement must use noTarget';
  if (
    !('scope' in overloaded) ||
    !('scopeFilter' in overloaded) ||
    overloaded.scope !== expected.scope ||
    canonicalJson(overloaded.scopeFilter) !== canonicalJson(expected.filter)
  ) {
    return 'the overloaded scope and filter must be the exact cohort denoted by the ordinary target';
  }
  return null;
}

/** Every Overload invariant that spans the card and both effect lists. */
export function checkOverload(card: Card): Violation[] {
  if ((card.kind !== 'instant' && card.kind !== 'sorcery') || card.overload === undefined) return [];
  const profile = card.overload;
  const found: Violation[] = [];
  const incompatible =
    card.alternativeCost !== undefined ||
    card.modes !== undefined ||
    card.may !== undefined ||
    card.unless !== undefined;
  if (incompatible) {
    found.push(
      violation(
        'INVALID_OVERLOAD_PAIR',
        'overload',
        'Overload is the spell alternate profile and cannot be combined with another alternate or conditional effect-list choice',
      ),
    );
  }
  if (profile.effects.length !== card.effects.length) {
    found.push(
      violation(
        'INVALID_OVERLOAD_PAIR',
        'overload.effects',
        'ordinary and overloaded forms must contain the same number of structured instructions',
      ),
    );
  }
  for (const [index, overloaded] of profile.effects.entries()) {
    const ordinary = card.effects[index];
    if (ordinary === undefined) continue;
    const error = pairError(ordinary, overloaded, card.effects, index);
    if (error !== null)
      found.push(violation('INVALID_OVERLOAD_PAIR', `overload.effects[${String(index)}]`, error));
  }
  const usesX = profile.effects.some(effectUsesChosenX);
  if (profile.xSymbols !== undefined && !profile.cost.hasX) {
    found.push(
      violation(
        'INVALID_OVERLOAD_PAIR',
        'overload.xSymbols',
        'multiple X symbols require X in the overload cost',
      ),
    );
  }
  if (usesX !== profile.cost.hasX) {
    found.push(
      violation(
        'INVALID_OVERLOAD_PAIR',
        'overload.cost.hasX',
        'the overload cost contains X exactly when its replacement effects read the one chosen X value',
      ),
    );
  }
  return found;
}
