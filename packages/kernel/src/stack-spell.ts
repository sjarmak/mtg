/** Pure identity and printed-card reads for spells on the stack. */
import type { Card } from '@mtg/dsl';
import type { ObjectId } from './ids';
import type { GameState, StackEntry } from './state';
import { copiableCardOf } from './state';
import { tryObject } from './zones';

/** The card represented by one spell stack entry, excluding lands and abilities. */
export function spellCard(state: GameState, entry: StackEntry): Card | null {
  if (entry.ability !== null) return null;
  const object = tryObject(state, entry.oid);
  const card = entry.copiedSpell?.card ?? (object === undefined ? undefined : copiableCardOf(object));
  return card === undefined || card.kind === 'land' ? null : card;
}

/** The card represented by a spell oid, including copies with no GameObject. */
export function spellCardByOid(state: GameState, oid: ObjectId): Card | null {
  const entry = state.stack.find((candidate) => candidate.oid === oid);
  return entry === undefined ? null : spellCard(state, entry);
}
