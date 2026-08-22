/**
 * The faithfulness rubric: what "does the printed card mean what its slot asked
 * for" breaks down into, and the schema a verdict is checked against.
 *
 * `mtg-bc2.152.9` / ADR-0001 §10 argue that a typecheck carries no faithfulness
 * information (GTED, Cohen's κ ≈ 0.000): a card can satisfy every structural
 * validator in `validate/` and still miss the point of the slot it was written
 * for. This rubric is scoped to the part of that gap this pipeline actually
 * has: `checkSlotConformance`, `checkCardPie` and the DSL's own validators
 * already prove a card's keywords, effect kinds, ability kinds, mana value and
 * color pie match its slot, so asking a critic to re-check those would score
 * agreement with a compiler this repo already has. What compiles here and is
 * never checked is the *prose* a slot carries: a brief's mechanic description,
 * a required card's flavor direction, a critique reviewer's revision
 * instruction, and the design *role* a slot was allocated for (`role: string`
 * on `Slot` seeds the fill prompt but nothing structural proves the printed
 * card plays the role its name promises). Those four are where this rubric
 * points the model.
 *
 * ZFC: which criteria apply to a given card is a structural fact (does the slot
 * carry a `requiredCard`, was it touched by an applied revision) and is decided
 * here, in code, from `Slot` and `RevisionRecord` fields. Judging whether the
 * card *satisfies* an applicable criterion is not structural and is never
 * attempted in code — it is the one question this whole module hands to the
 * model. `coversExpectedCriteria` below is a coverage check (did the model
 * answer every criterion it was asked, exactly once), not a judgment.
 */
import { z } from 'zod';
import type { Entry } from '../validate/index';

/** Every card is judged on these three: they need no field beyond the slot itself. */
export const CORE_CRITERIA = ['mechanicIntent', 'roleIntent', 'noInvention'] as const;

/** Judged only when the entry's slot carries the field the criterion is about. */
export const CONDITIONAL_CRITERIA = ['requiredCardIntent', 'revisionIntent'] as const;

export const FAITHFULNESS_CRITERIA = [...CORE_CRITERIA, ...CONDITIONAL_CRITERIA] as const;
export type FaithfulnessCriterion = (typeof FAITHFULNESS_CRITERIA)[number];

export const FAITHFULNESS_LABELS = ['faithful', 'partial', 'unfaithful'] as const;
export type FaithfulnessLabel = (typeof FAITHFULNESS_LABELS)[number];

/** One line per criterion, printed into the critic prompt so the rubric is reviewable here, not buried in prose. */
export const CRITERION_RUBRIC: Readonly<Record<FaithfulnessCriterion, string>> = {
  mechanicIntent:
    "The slot names one or more brief mechanics it was allocated to support. Does the printed card's " +
    "actual behavior serve what each mechanic's description asks for, not merely use a keyword or effect " +
    'kind the mechanic also names?',
  roleIntent:
    'The slot names a design role (for example "removalExpensive" or "creature"). Does the printed card ' +
    'play the way that role promises — a removal spell that actually removes at a cost that reads as the ' +
    "role's tier, a creature whose body and text serve the role rather than merely satisfying its slot's " +
    'numeric window?',
  noInvention:
    "Does the card avoid printing mechanical behavior that the slot's stated intent gives no reason for — " +
    'text that happens to validate but that nothing in the mechanic, role or required-card direction asked ' +
    'for?',
  requiredCardIntent:
    'The slot was reserved for a named required card carrying a one-line flavor direction. Does the printed ' +
    "card's identity and behavior honor that direction, not only its name?",
  revisionIntent:
    'A critique reviewer asked for a specific change on this slot and the change was kept. Does the printed ' +
    'card actually deliver the change the instruction asked for, rather than merely passing validation again?',
};

/**
 * Which criteria this entry is judged on, decided from structure alone.
 *
 * `revisedSlotIds` must carry only slots whose revision was *applied* — a
 * reverted revision's instruction describes a card that was not kept, so
 * asking whether the final card satisfies it would score against an
 * instruction the pipeline itself gave up on.
 */
export function criteriaFor(
  entry: Entry,
  revisedSlotIds: ReadonlySet<string>,
): readonly FaithfulnessCriterion[] {
  const criteria: FaithfulnessCriterion[] = [...CORE_CRITERIA];
  if (entry.slot.requiredCard !== undefined) criteria.push('requiredCardIntent');
  if (revisedSlotIds.has(entry.slot.id)) criteria.push('revisionIntent');
  return criteria;
}

export const CriterionVerdictSchema = z.object({
  criterion: z.enum(FAITHFULNESS_CRITERIA),
  label: z.enum(FAITHFULNESS_LABELS),
  /** One sentence: what in the card supports or contradicts the criterion. */
  reason: z.string().min(1).max(240),
});
export type CriterionVerdict = z.infer<typeof CriterionVerdictSchema>;

/**
 * One card's verdict: a judgment per asked criterion plus one holistic
 * `overall`. `overall` is asked of the model directly rather than derived from
 * the per-criterion labels in code, because reducing three-to-five categorical
 * labels to one is itself a judgment call (is `partial` on `noInvention` worse
 * than `partial` on `mechanicIntent`?) and hard-coding that weighting would be
 * exactly the heuristic scoring ZFC forbids in code.
 */
export const CriticVerdictSchema = z.object({
  criteria: z.array(CriterionVerdictSchema).min(1).max(FAITHFULNESS_CRITERIA.length),
  overall: z.object({
    label: z.enum(FAITHFULNESS_LABELS),
    reason: z.string().min(1).max(240),
  }),
});
export type CriticVerdict = z.infer<typeof CriticVerdictSchema>;

/**
 * True when the verdict judged exactly the criteria this entry was asked
 * about, each once, and named nothing else — a structural check, not a
 * judgment about whether the labels are *right*.
 */
export function coversExpectedCriteria(
  verdict: Pick<CriticVerdict, 'criteria'>,
  expected: readonly FaithfulnessCriterion[],
): boolean {
  const seen = verdict.criteria.map((item) => item.criterion);
  if (seen.length !== expected.length) return false;
  const seenSet = new Set(seen);
  if (seenSet.size !== seen.length) return false;
  const expectedSet = new Set(expected);
  if (expectedSet.size !== expected.length) return false;
  for (const criterion of seen) if (!expectedSet.has(criterion)) return false;
  return true;
}
