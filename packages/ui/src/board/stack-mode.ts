/**
 * What a modal object on the stack says it is (CR 700.2), for both producers.
 *
 * `mtg-dwlr`. `./StackZone.ts`'s `StackItem` carries `modeLabel`, and two files
 * build that item: `../routes/play/position.ts` off the kernel's own state and
 * `../routes/replay/frame.ts` off a recorded log. This function lived in the
 * replay's file, so the same modal spell said which spell it was when you
 * watched the replay and said nothing while you were playing it, which is the
 * surface where the answer changes what you do next.
 *
 * It is here rather than in either producer because a fact about a stack entry
 * belongs beside the type that carries it. It reads `@mtg/dsl` and nothing else:
 * no kernel state, no log schema, so neither producer has to go through the
 * other's shape to ask.
 */
import type { Card } from '@mtg/dsl';
import { renderEffectList } from '@mtg/dsl';

/**
 * The chosen mode's own text, preferred over its bare index: the DSL never
 * stores a mode's oracle line as a string (`ModeSchema` in `@mtg/dsl`'s
 * `modal.ts` carries only `effects`), but `renderEffectList` is the same
 * renderer a spell's own effect paragraph is built from, over the exact effect
 * list `effectsFor(card, mode)` would resolve -- so the chosen mode's sentence
 * is reachable without a second, narrower text field.
 *
 * `null` when the entry names no mode. The bare index when the card or the
 * indexed activated ability carries no `modes` at all -- a state the kernel's
 * own invariant says should not happen, and a replay viewer over a log the
 * kernel did not enforce it for is exactly the surface that should fail soft
 * rather than throw. The live table reaches the same line for the same reason:
 * a projection that threw would take the whole board down over one row.
 */
export function stackModeLabel(card: Card, mode: number | null, abilityIndex?: number): string | null {
  if (mode === null) return null;
  const ability = abilityIndex === undefined ? undefined : card.abilities[abilityIndex];
  const modes =
    abilityIndex === undefined ? card.modes : ability?.kind === 'activated' ? ability.modes : undefined;
  const chosen = modes?.[mode];
  if (chosen === undefined) return `mode ${String(mode)}`;
  return renderEffectList(chosen.effects, card.name).join(' ');
}
