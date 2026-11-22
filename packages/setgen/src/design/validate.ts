/**
 * A brief draft in, either the parsed brief or every refusal it earned out.
 *
 * `mtg-yddw.1`. `parseBrief` throws, which is right for a CLI reading a file it
 * was pointed at: the run stops and the message names the field. An editor wants
 * the opposite shape — a draft is invalid most of the time it is being written,
 * that is what writing is — so this returns the issues as data and never throws
 * for an invalid draft.
 *
 * # Every issue, not the first
 *
 * `safeParse` collects the whole tree, and the whole tree is what an editor
 * needs: a field that is refused only after the field above it is fixed makes
 * the form feel like it is inventing new objections. The one place that is not
 * true is a `superRefine` that runs only when the object parse succeeded, which
 * is Zod's own ordering and not something to work around here.
 *
 * # The path is the point
 *
 * An issue carries `path` as Zod's array of keys and indices, and the editor
 * keys its field markers off it: `['mechanics', 2, 'keywords']` is a marker on
 * one mechanic's keyword picker rather than a sentence at the top of the page.
 * It is also flattened to a dotted string, because a marker keyed by array
 * identity is a marker nothing can look up.
 */
import { normalizeParsedBrief, SetBriefSchema, tertiaryBudgetFor } from '../brief';
import type { SetBrief } from '../brief';

/** One refusal, addressed to the field that earned it. */
export interface BriefIssue {
  /** Zod's own path: object keys and array indices, outermost first. */
  readonly path: readonly (string | number)[];
  /** The same path as `mechanics.2.keywords`, which is what a marker is keyed by. */
  readonly pointer: string;
  readonly message: string;
}

/**
 * What a valid draft resolves to beside the brief itself.
 *
 * `tertiaryBudget` is defaulted from the set size when the brief does not state
 * it, and a designer reading the form has no way to work that out from a blank
 * field. So the *derived* value is reported next to the stated one, which is the
 * whole of what this block is for: it says what the run will use, not what was
 * typed.
 */
export interface BriefDerivation {
  readonly tertiaryBudget: number;
  readonly requiredCards: number;
  readonly authoredCards: number;
  readonly mechanics: number;
}

export type BriefValidation =
  | { readonly ok: true; readonly brief: SetBrief; readonly derived: BriefDerivation }
  | { readonly ok: false; readonly issues: readonly BriefIssue[] };

function pointerOf(path: readonly (string | number)[]): string {
  return path.length === 0 ? '' : path.join('.');
}

/** Validate a draft from any source. Never throws for invalid input. */
export function validateBrief(draft: unknown): BriefValidation {
  const parsed = SetBriefSchema.safeParse(draft);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => {
        const path = issue.path.filter(
          (key): key is string | number => typeof key === 'string' || typeof key === 'number',
        );
        return { path, pointer: pointerOf(path), message: issue.message };
      }),
    };
  }
  const brief = normalizeParsedBrief(parsed.data);
  return {
    ok: true,
    brief,
    derived: {
      tertiaryBudget: tertiaryBudgetFor(brief),
      requiredCards: brief.requiredCards.length,
      authoredCards: brief.authoredCards.length,
      mechanics: brief.mechanics.length,
    },
  };
}
