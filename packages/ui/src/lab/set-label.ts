/**
 * What a set is called on screen, and the one word that says what is missing.
 *
 * Two surfaces name a set — the picker in the bar and the Play header — and
 * before this module each of them said it differently
 * and one of them said it in the launcher's words. the playtester's instruction is
 * the reason it moved here: "Magic 2011 (reduced) — 162 cards, the reduced
 * reference build in out/reference/m11" should read `Magic 2011` with
 * `162 cards · Partial set` under it. A person choosing a set is not choosing a
 * build directory.
 *
 * # The name is the name, minus the disclosure
 *
 * `@mtg/data`'s reduced emitter appends ` (reduced)` to the set's own name, and
 * that was the right call for a *document*: a file on disk that claims to be
 * Magic 2011 and holds 162 of its positions should say so in the one field
 * anything reads. It is the wrong call for a *label*, because the shell already
 * carries the completeness notice, the list already carries the badge, and the
 * name then says it a third time in parentheses. So the suffix comes off here,
 * from the display name only; `row.name` is untouched and still what a fixture,
 * a log line or a bug report quotes.
 *
 * # Partial, not reduced
 *
 * *Reduced* is this repository's word for a real printing cut down to what the
 * kernel can run, and it means nothing to somebody who has not read the decision
 * that dropped translating arbitrary printed cards. *Partial* is what the fact
 * is: this set is missing cards. The badge is the short form and `setFacts` is the long
 * one, and both are drawn from `row.reduced`, which is a field of the staged
 * index rather than a guess made from the name.
 */
import { setKindLabel } from './set-origin';
import type { StagedSetRow } from './set-index';

/** The suffix the reduced emitter appends to a set's name. */
const REDUCED_SUFFIX = ' (reduced)';

/** The compact badge a partial set carries beside its name. */
export const SET_PARTIAL_BADGE = 'Partial';

/**
 * The set's name as a person reads it: its own name without the parenthetical
 * the badge beside it already says.
 */
export function setDisplayName(row: Pick<StagedSetRow, 'name'>): string {
  return row.name.endsWith(REDUCED_SUFFIX) ? row.name.slice(0, -REDUCED_SUFFIX.length) : row.name;
}

/**
 * What kind of set this is, in the two or three words that go under its name:
 * `Custom set`, `Magic set`, `Magic set · Partial`.
 */
export function setKindFact(row: Pick<StagedSetRow, 'origin' | 'reduced'>): string {
  const kind = setKindLabel(row.origin);
  return row.reduced ? `${kind} · ${SET_PARTIAL_BADGE}` : kind;
}

/**
 * The one line of facts under a set's name in a list: how many cards, and what
 * kind of set they are. `162 cards · Partial set`, `371 cards · Custom set`.
 *
 * A partial set says *Partial set* rather than *Magic set · Partial*, because in
 * a list grouped under a *Magic* heading the origin is already overhead.
 */
export function setFacts(row: Pick<StagedSetRow, 'cardCount' | 'origin' | 'reduced'>): string {
  const kind = row.reduced ? `${SET_PARTIAL_BADGE} set` : setKindLabel(row.origin);
  return `${String(row.cardCount)} cards · ${kind}`;
}
