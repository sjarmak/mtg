/**
 * The second acceptance clause as a measurement: every card choice traces to a
 * stated criterion.
 *
 * The tracing itself is built — `verify.ts` refuses a proposal that cites
 * nothing or cites an id the user never stated, and `report.ts` prints the ids
 * beside every card. What this file adds is the check that says so. A property
 * that holds only because of how the code happens to be arranged is a property
 * nothing keeps, and the eval is where a clause of the acceptance criteria has
 * to become a number somebody can read.
 *
 * ## What counts as a choice
 *
 * The spells and the nonbasic lands. Both are named by the model, both carry
 * citations through `verifyProposals`, and both are cards a reader can ask "why
 * is this here" about.
 *
 * Basic lands are not choices and are counted separately. Nobody picks them:
 * `assemble.ts` apportions them across the colors from the pip demand of the
 * cards that *were* chosen, inside a land count `land-plan.ts` decided. Asking a
 * Mountain which criterion it serves has no answer, because the question is
 * addressed to the wrong card — the trace runs through the spells whose pips put
 * it there. Counting basics as untraced would report a violation on every deck
 * for doing exactly what the design says to do.
 *
 * ## Why this is not a `Violation`
 *
 * `auditDeck` measures both builders' decks with one function, and that is the
 * point of it: legality and budget are facts about a decklist, so the informed
 * pipeline and the generic agent are held to identical standards. Citations are
 * not. The baseline is asked for a decklist and nothing else, so folding an
 * uncited card into `DeckAudit.violations` would score every one of its cards a
 * violation for failing to produce a field it was never asked for — a measure
 * the informed side wins by definition, which is the failure mode an evaluation
 * harness can least afford. So tracing is reported on its own, over the informed
 * build only, and the conformance table stays a comparison of like with like.
 */
import { COLORS } from '@mtg/dsl';
import type { AssembledDeck } from './assemble';
import type { DeckCriteria } from './criteria';
import { criterionIds } from './criteria';

export type TraceFindingKind = 'no-criterion' | 'unstated-criterion';

export interface TraceFinding {
  readonly name: string;
  readonly kind: TraceFindingKind;
  readonly detail: string;
}

export interface CriterionTrace {
  /** Distinct cards the model chose: the spells and the nonbasic lands. */
  readonly chosenEntries: number;
  /** Of those, the ones citing at least one id the criteria state, and no other. */
  readonly citedEntries: number;
  /** Basic lands the split placed, with multiplicity. Derived, never cited. */
  readonly derivedBasics: number;
  readonly findings: readonly TraceFinding[];
  /** True when every choice traces: the clause holding, for this deck. */
  readonly clean: boolean;
}

/**
 * Traces an assembled deck against the criteria it was built from.
 *
 * A card citing an unstated id fails even when it also cites a stated one, which
 * is how `verifyProposals` already treats it: the claim being checked is that
 * the whole justification is answerable from what the user asked for, not that
 * some part of it is.
 */
export function traceCriteria(deck: AssembledDeck, criteria: DeckCriteria): CriterionTrace {
  const stated = criterionIds(criteria);
  const chosen = [...deck.spells, ...deck.lands];
  const findings: TraceFinding[] = [];
  let citedEntries = 0;

  for (const entry of chosen) {
    const name = entry.card.name;
    if (entry.criteria.length === 0) {
      findings.push({
        name,
        kind: 'no-criterion',
        detail: `${name} cites no criterion at all`,
      });
      continue;
    }

    const unstated = entry.criteria.filter((id) => !stated.has(id));
    if (unstated.length > 0) {
      findings.push({
        name,
        kind: 'unstated-criterion',
        detail: `${name} cites ${unstated.join(', ')}, which the criteria never stated; the stated ids are ${[...stated].join(', ')}`,
      });
      continue;
    }

    citedEntries += 1;
  }

  return {
    chosenEntries: chosen.length,
    citedEntries,
    derivedBasics: COLORS.reduce((sum, color) => sum + deck.manaBase.basics[color], 0),
    findings,
    clean: findings.length === 0,
  };
}
