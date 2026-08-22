/**
 * Modal effects (CR 700.2): "Choose one —" and its "choose two", "choose
 * three" siblings. One card, several mutually exclusive effect lists stated
 * at design time; which one resolves is a choice the player makes when the
 * spell is cast.
 *
 * ## Why this is a sibling field and not an `Effect` member
 *
 * `Effect`'s own union is closed over by three separate compile-time gates:
 * the kernel's `EFFECT_EXECUTION` and the validator's `EFFECT_RULES` (both
 * total mapped types over `AnyEffectKind`), and `exhaustive.ts`'s
 * `EffectKindsCovered` mutual-assignability proof against `vocabulary.ts`'s
 * `ALL_EFFECT_KINDS`. Any of those failing to gain a real, working row is a
 * compile error, so adding `modal` as an `Effect` member would force the
 * kernel to actually resolve "which mode did the player pick" as part of
 * this change. That mechanism — threading a choice through casting, the
 * stack and replay — is `mtg-bc2.152.4`'s scope, run deliberately after this
 * one rather than beside it.
 *
 * A `Card`-level field sidesteps all three gates. A mode's own effects are
 * typed `Effect[]`, exactly as `card.effects` is, so every existing check
 * (`checkEffectParams`, `checkEffectTarget`, `checkEffectScope`,
 * `checkDistinctTargets`, `checkDuplicateEffects`) already knows how to read
 * one, and the kernel owes this file nothing until `.152.4` gives it a
 * choice to resolve.
 *
 * ## The bound
 *
 * A mode's effect list is typed with `CardEffectSchema`, which has no
 * `modal` member — modes cannot nest, by construction, the same way
 * `TokenEffectSchema` (`effects.ts:151`) omits `createToken` so a token
 * cannot carry a token. Recursion depth is exactly one, and there is no
 * runtime check for it because there is no code path that could produce a
 * second level: `Mode`'s `effects` field has no `modes` field of its own.
 *
 * `MIN_MODES`/`MAX_MODES` are a width bound, not a depth one, and are
 * measured rather than guessed: of 38,623 oracle cards, 782 print a "Choose
 * one/two/three —" clause with at least one `•`, and the histogram of bullet
 * counts among them is 2 (499 cards), 3 (212), 4 (58), 5 (6), 6 (5). A single
 * 12-bullet outlier (`Into the Story: Assassin Edition`) is a choose-your-
 * own-adventure joke card, not a real modal spell, and is excluded. Six is
 * therefore the ceiling every genuine printed mode count has ever needed, and
 * it is enforced in the schema itself (`.max(MAX_MODES)`) rather than left to
 * a coded violation — the same device `card.ts`'s
 * `abilities: z.array(AbilitySchema).max(2)` uses for its own hand-picked
 * cap. CR 700.2 requires at least two modes, so `MIN_MODES` is 2.
 */
import { z } from 'zod';
import { CardEffectSchema } from './effects';
import type { Effect } from './effects';
import type { Card } from './card';

export const MIN_MODES = 2;
export const MAX_MODES = 6;

/**
 * One of a modal spell's choices: its own effect list, checked exactly as a
 * non-modal spell's `effects` is (see `checkEffectList` in
 * `validate/effects.ts`).
 */
export const ModeSchema = z.strictObject({
  effects: z.array(CardEffectSchema).min(1),
});
export type Mode = z.infer<typeof ModeSchema>;

/**
 * A modal spell's mode list. `card.ts` carries this beside `effects`, and
 * `checkEffects` refuses a card that populates both, or that carries `modes`
 * on anything that is not a spell.
 */
export const ModesSchema = z.array(ModeSchema).min(MIN_MODES).max(MAX_MODES);
export type Modes = z.infer<typeof ModesSchema>;

/**
 * The narrow shape `effectsFor` needs: a printed effect list and, maybe, a
 * mode list beside it. Every `Card` variant satisfies this structurally, and
 * `effectsFor` takes `Card` itself (a type-only import back from `card.ts`,
 * which imports `ModesSchema` from here) rather than a hand-rolled lookalike
 * interface — a second, separately-inferred `{ effects, modes }` shape looks
 * identical to `Card`'s own fields when printed, but is a distinct type as far
 * as structural comparison is concerned, and comparing it against `Card`'s
 * `effects`/`modes` union (`CardEffectSchema` runs to a dozen-plus variants)
 * is exactly the case where `tsc` gives up mid-comparison and reports two
 * textually-identical object types as unrelated rather than proving the
 * subtype relation. Importing the type itself sidesteps the comparison
 * instead of arguing with it: a `Card` (or `CastableCard`, `Extract`'s
 * subset of it) passed to a `Card`-typed parameter is the same declaration on
 * both ends, so there is nothing left to reconcile. The cycle this creates is
 * type-only and erased at compile time; nothing about it reaches runtime.
 */
export type ModalCard = Card;

/**
 * Which effect list is in play: the card's own `effects`, or one mode's, for
 * whichever mode was chosen at cast time (`mtg-bc2.152.4`). Every call site
 * that used to read `card.effects` for a spell reads this instead —
 * `legal.ts`'s `castOptions`/`validateCast` (enumerating and validating a cast)
 * and `stack.ts`'s resolution (`planResolution`, `resolveTop`) — so a modal
 * card and a fixed-effects card resolve through one path.
 *
 * `mode` is `null` for a non-modal card, matching the convention `oid`/`x` use
 * elsewhere in this codebase for "no such choice on this card" rather than
 * `undefined`, since this value is threaded through kernel state
 * (`StackEntry.mode`) that must `structuredClone` and fingerprint cleanly.
 */
export function effectsFor(card: ModalCard, mode: number | null): readonly Effect[] {
  if (card.modes === undefined) return card.effects;
  if (mode === null) {
    throw new Error('effectsFor: a modal card requires a chosen mode');
  }
  const chosen = card.modes[mode];
  if (chosen === undefined) {
    throw new Error(`effectsFor: mode ${mode} is out of range for a ${card.modes.length}-mode card`);
  }
  return chosen.effects;
}
