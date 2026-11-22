/** Source qualities shared by targeting, protection, countering, and replacement rules. */
import type { Card, Color } from '@mtg/dsl';
import type { ObjectId } from './ids';
import { characteristicsOf } from './layers';
import type { GameState, SourceCharacteristics } from './state';

export type RulesSource = ObjectId | Card | SourceCharacteristics;

export interface RulesSourceQualities {
  readonly kind: 'spell' | 'ability';
  readonly colors: readonly Color[];
  readonly subtypes: readonly string[];
}

/**
 * Reads the qualities a rule sees from a source and whether that source is a
 * spell or an ability.
 *
 * A bare Card reaches this seam only for a copied spell, which has no
 * GameObject. An LKI characteristics record reaches it only for an ability
 * whose source left the battlefield. Object ids retain their zone: a card in
 * hand is a proposed spell, a card in the stack zone is a resolving spell,
 * and a battlefield or departed permanent is an ability source.
 */
export function rulesSourceQualities(state: GameState, source: RulesSource): RulesSourceQualities | null {
  if (typeof source !== 'string') {
    if ('kind' in source) {
      return { kind: 'spell', colors: source.colors, subtypes: source.subtypes };
    }
    return { kind: 'ability', colors: source.colors, subtypes: source.subtypes };
  }
  const object = state.objects[source];
  if (object === undefined) return null;
  const current = characteristicsOf(state, source);
  return {
    kind: object.zone === 'hand' || object.zone === 'stack' ? 'spell' : 'ability',
    colors: current.colors,
    subtypes: current.subtypes,
  };
}
