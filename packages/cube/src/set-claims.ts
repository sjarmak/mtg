import type { AvailabilityOptions, CubeAvailability } from './availability';
import { measureAvailability } from './availability';
import type { FormatClaims } from './claims';
import { formatClaims } from './claims';
import { CubeCriteriaSchema } from './criteria';
import type { CubeCriteriaInput } from './criteria';
import { candidateFromDslCard } from './set-pool';
import type { GeneratedSet } from './set-pool';
import type { CubeEntry, CubeValidation } from './validate';
import { validateCube } from './validate';

/**
 * A generated set measured against the capabilities its format states.
 *
 * The list is the whole set. That is the difference from `constructCube`, which
 * asks a model to *choose* a list: a format's claims are about the set that
 * exists, so there is nothing to choose and no proposal round to pay for. What
 * a model is still the only source of is the tagging — which cards serve which
 * archetype — and this function takes it as data it is handed rather than as a
 * call it makes, so the surface that has a key can supply one and the gate that
 * does not can run anyway.
 *
 * When no tagging is handed in, the archetype claims come back `unmeasured`
 * naming the missing half rather than reporting an archetype with zero playable
 * cards. Zero would be a measurement of the absent model, and it would fail a
 * format nobody has judged yet.
 */
export interface SetClaimsInput {
  readonly set: GeneratedSet;
  /**
   * The criteria as the format stated them, **before** `CubeCriteriaSchema`
   * defaults anything. A dial absent here produces no claim: see `claims.ts`.
   */
  readonly stated: CubeCriteriaInput;
  /**
   * Card id to the names of the stated archetypes it serves — the model's half.
   * `null` is the no-key run, and it is a supported one.
   */
  readonly tagging?: ReadonlyMap<string, readonly string[]> | null;
  /**
   * What drafting the set said, from `measureAvailability`. `null` when nothing
   * drafted it, which the claims block reports rather than hides.
   */
  readonly availability?: CubeAvailability | null;
  /**
   * Draft the set here rather than handing the answer in.
   *
   * Ignored when `availability` is supplied, and never used without a tagging:
   * an availability share is per stated archetype, and which cards serve an
   * archetype is the judgment nothing measured. Drafting anyway would produce a
   * seeded, provenanced, precise number about nothing.
   */
  readonly draft?: AvailabilityOptions | undefined;
}

export interface SetClaims {
  readonly claims: FormatClaims;
  /** The validation the claims are a projection of, for a surface that wants both. */
  readonly validation: CubeValidation;
  /** Whether the judgment half was supplied. `false` is the CI run. */
  readonly tagged: boolean;
}

/** Why an untagged run cannot measure an archetype, in the words the block carries. */
export const UNTAGGED_REASON =
  'nothing tagged which cards serve which archetype: that judgment is a model call and no model was run, ' +
  'so this capability is unmeasured rather than measured at zero';

export function claimsForSet(input: SetClaimsInput): SetClaims {
  const criteria = CubeCriteriaSchema.parse(input.stated);
  const tagging = input.tagging ?? null;
  const entries: readonly CubeEntry[] = input.set.cards.map((card) => ({
    card: candidateFromDslCard(card),
    count: 1,
    archetypes: tagging?.get(card.id) ?? [],
    reason: `printed in ${input.set.name} (${input.set.code})`,
  }));

  const availability =
    input.availability ??
    (input.draft === undefined || tagging === null
      ? null
      : measureAvailability(
          entries,
          criteria,
          new Map(input.set.cards.map((card) => [card.id, card])),
          input.draft,
        ));
  const validation = validateCube(entries, criteria, availability);
  const claims = formatClaims(
    input.stated,
    criteria,
    validation,
    tagging === null ? { untaggedReason: UNTAGGED_REASON } : {},
  );
  return { claims, validation, tagged: tagging !== null };
}
