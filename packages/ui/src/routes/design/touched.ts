/**
 * Which refusals the editor is allowed to draw yet.
 *
 * `mtg-dcxg.3`. A brief has seven fields that are refused the moment it is
 * blank, so the Design tab used to open with every box outlined in red and a
 * banner reading "7 fields are refused, marked above" before a key was pressed.
 * That is the form telling somebody off for not having started. The refusals
 * were correct — the server judges the draft on every edit and always has — so
 * what changes here is not the judgment but when it is shown.
 *
 * A field is shown its refusal once it has been *touched*: left after being
 * focused, or clicked in the case of a chip or a checkbox. That is per field
 * rather than per form, so filling in the set code does not light up the theme
 * somebody has not reached.
 *
 * `revealAll` is the other half. A draft read back off disk or out of storage is
 * not a form somebody is seeing for the first time — it is a document, already
 * written, whose refusals are the reason it was opened. Those are shown at once.
 *
 * The pointer is carried on the element itself (`data-pointer`) and read off the
 * event, so one handler on the column marks every field. The alternative was an
 * `onTouch` prop threaded through six panels and twenty-six call sites, where a
 * field added later silently never reveals its refusal.
 */
import type { BriefIssue } from './client';

/** Every field that has been left or clicked, keyed by the pointer it validates. */
export type Touched = ReadonlySet<string>;

export const NONE_TOUCHED: Touched = new Set<string>();

/**
 * The refusals that may be drawn.
 *
 * A touched pointer reveals its own refusals and anything nested under it: a
 * chip row is touched at `mechanics.0.keywords` and the schema refuses the
 * member at `mechanics.0.keywords.1`.
 */
export function revealedIssues(
  issues: readonly BriefIssue[],
  touched: Touched,
  revealAll: boolean,
): readonly BriefIssue[] {
  if (revealAll) return issues;
  if (touched.size === 0) return [];
  return issues.filter((issue) =>
    [...touched].some((field) => issue.pointer === field || issue.pointer.startsWith(`${field}.`)),
  );
}

/**
 * The field an event happened in, or null when it happened somewhere that is not
 * a field — the heading, the panel, a Remove button.
 *
 * The workspace tsconfig has no `lib: dom`, so the element is read structurally,
 * the way every other event handler in `packages/ui` reads its target.
 */
interface Closest {
  readonly closest?: (selector: string) => { getAttribute(name: string): string | null } | null;
}

export function pointerOf(target: unknown): string | null {
  const found = (target as Closest | null)?.closest?.('[data-pointer]');
  return found?.getAttribute('data-pointer') ?? null;
}

/** The set with one more field in it, or the same set when nothing changed. */
export function withTouched(touched: Touched, pointer: string): Touched {
  if (touched.has(pointer)) return touched;
  return new Set([...touched, pointer]);
}
