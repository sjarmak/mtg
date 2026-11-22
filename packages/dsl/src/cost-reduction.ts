/**
 * A permanent's printed cost-reduction rule (CR 601.2f, CR 118.9): while this
 * permanent is on the battlefield, spells of the named class cost less to
 * cast.
 *
 * ## Why this is a field on `Card`, not a `StaticModification`
 *
 * Every `StaticModification` becomes exactly one CR 613 `ContinuousEffect`
 * (`@mtg/kernel`'s `effectForModification`), and five files across four
 * packages narrow on `StaticModification['kind']` with an `assertNever`
 * default: `deckbuild/evaluate.ts`, `sim/evaluate.ts`,
 * `forge-export/ability-script.ts`, `dsl/validate/abilities.ts` and
 * `dsl/oracle.ts`. Cost modification is not a CR 613 layer — it changes what a
 * spell costs before the spell is ever an object the layer walk can see — so
 * folding it into that union would either corrupt `effectForModification`'s
 * one-modification-one-effect invariant or force a `case` into five files
 * whose real subject is a permanent's *characteristics*, not what a player
 * owes to cast something. A card-level field says the same thing a static
 * ability would, without asking either question.
 *
 * `@mtg/kernel`'s `cost.ts` is the seam that reads this field and turns it
 * into a registered, expiring effect the way `abilities.ts` does for
 * `StaticModification` — same registration/lookup shape, parallel array,
 * different bucket.
 */
import { z } from 'zod';
import { CardKindSchema } from './vocabulary';

const ReductionAmountSchema = z.int().positive();

const MultipleCardKindsSchema = z
  .array(CardKindSchema)
  .min(2)
  .superRefine((kinds, context) => {
    const duplicate = kinds.find((kind, index) => kinds.indexOf(kind) !== index);
    if (duplicate !== undefined) {
      context.addIssue({
        code: 'custom',
        message: `cardTypes repeats ${duplicate}`,
      });
    }
  });

export const CostReductionSchema = z.union([
  z.strictObject({
    /** CR 118.9: how much less, in generic mana. Never reduces a pip below 0. */
    amount: ReductionAmountSchema,
    /** Which one spell type this reaches; `null` reaches every spell cast. */
    cardType: CardKindSchema.nullable(),
  }),
  z.strictObject({
    amount: ReductionAmountSchema,
    /** A disjunction of two or more exact spell types. */
    cardTypes: MultipleCardKindsSchema,
  }),
]);

export type CostReduction = z.infer<typeof CostReductionSchema>;
export type CostReductionInput = z.input<typeof CostReductionSchema>;

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function listSpellTypes(cardTypes: readonly string[]): string {
  const [first, ...rest] = cardTypes;
  if (first === undefined) throw new Error('a cost reduction has no spell types');
  if (rest.length === 0) return capitalize(first);
  if (rest.length === 1) return `${capitalize(first)} and ${rest[0] ?? ''}`;
  return `${capitalize(first)}, ${rest.slice(0, -1).join(', ')}, and ${rest.at(-1) ?? ''}`;
}

/**
 * `Spells you cast cost {1} less to cast.` or, scoped to a card type,
 * `Creature spells you cast cost {2} less to cast.`
 */
export function describeCostReduction(reduction: CostReduction): string {
  const subject =
    'cardTypes' in reduction
      ? `${listSpellTypes(reduction.cardTypes)} spells`
      : reduction.cardType === null
        ? 'Spells'
        : `${capitalize(reduction.cardType)} spells`;
  return `${subject} you cast cost {${reduction.amount}} less to cast.`;
}
