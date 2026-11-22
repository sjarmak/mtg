/** Countering one stack object, with the spell/ability zone difference owned once. */
import type { ObjectId } from './ids';
import type { RulesSource } from './rules-source';
import { rulesSourceQualities } from './rules-source';
import type { GameState } from './state';
import type { Trace } from './trace';
import { emit, withState } from './trace';
import { moveObject } from './zones';
import { clearSiegeDefeatPending } from './siege';
import { spellCard } from './stack-spell';

/** Whether the named stack entry can be countered by this rules source now. */
export function canCounterStackEntry(state: GameState, oid: ObjectId, source: RulesSource): boolean {
  const entry = state.stack.find((candidate) => candidate.oid === oid);
  if (entry === undefined) return false;
  if (entry.ability !== null) return true;
  const card = spellCard(state, entry);
  if (card?.cannotBeCountered === true) return false;
  const qualities = rulesSourceQualities(state, source);
  return !(
    qualities?.kind === 'spell' &&
    state.turnPlayerRules.some(
      (rule) =>
        rule.rule === 'spellsCantBeCounteredBySpellColors' &&
        rule.player === entry.controller &&
        qualities.colors.some((color) => rule.colors.includes(color)),
    )
  );
}

export function counterStackEntry(
  trace: Trace,
  oid: ObjectId,
  by: ObjectId,
  source: RulesSource = by,
  destination: 'graveyard' | 'exile' = 'graveyard',
): Trace {
  const entry = trace.state.stack.find((candidate) => candidate.oid === oid);
  if (entry === undefined) return trace;
  if (!canCounterStackEntry(trace.state, oid, source)) return trace;
  if (entry.ability !== null) {
    const countered = emit(trace, { type: 'abilityCountered', oid, by });
    const withoutEntry = {
      ...countered.state,
      stack: countered.state.stack.filter((candidate) => candidate.oid !== oid),
    };
    return withState(
      countered,
      entry.siegeDefeat === true
        ? clearSiegeDefeatPending(withoutEntry, entry.ability.sourceOid, entry.sourceBattlefieldIncarnation)
        : withoutEntry,
    );
  }
  const countered = emit(trace, { type: 'spellCountered', oid, by });
  if (entry.copiedSpell !== undefined) {
    return withState(countered, {
      ...countered.state,
      stack: countered.state.stack.filter((candidate) => candidate.oid !== oid),
    });
  }
  return moveObject(countered, oid, destination);
}
