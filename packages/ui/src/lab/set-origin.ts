/**
 * Where a set came from: this lab made it, or Magic printed it.
 *
 * `mtg-tewc.1`. The lab now holds sets of two kinds and a person choosing one
 * cares about the difference before they care about anything else: *The Hidden
 * Kingdom* is a set this project generated, and *Magic 2011* and *Magic 2013*
 * are real printings cut down to the positions this kernel can run. They are
 * browsed, drafted and played through the same screens, so the distinction has
 * to be a property of a set rather than two applications.
 *
 * # Declared, or read off what the document already carries
 *
 * A set document may say `origin` outright, and if it does that is the answer:
 * the point of the field is that a set added later needs metadata rather than a
 * change to the UI. `@mtg/data`'s reference emitter declares `origin:
 * 'official'` on every build it writes, complete or not (`mtg-uzacz`: `reduced`
 * is measured from what a build dropped, so it can no longer stand in for
 * "real printing"). Nothing else declares it, so the rest of this module is the
 * fallback, and it reads one field the documents already carry rather than a
 * list of three set codes.
 *
 * There are exactly two producers of a playable set document in this workspace
 * and each writes a field the other cannot. `@mtg/setgen`'s `SetFileSchema`
 * requires `theme`, the brief's sentence about what the set is about, and only a
 * generated set has a brief. `@mtg/data`'s `ReducedReferenceSetDocumentSchema`
 * requires `origin: 'official'`, and a build exists *because* a real printing's
 * rules text is not a DSL card. A document staged before the emitter declared it
 * carries `reduced: true` instead, and that is still the fallback's whole test:
 * `true` means official, anything else means custom.
 *
 * `custom` is also the safer default for a document that is neither, such as one
 * written by hand. Calling a generated set official would put it under a heading
 * that claims Wizards printed it; calling an official set custom understates a
 * set that is, in this lab, a build somebody made. Add `origin` to the document
 * to settle it either way.
 *
 * # The label is not the value
 *
 * `official` is the value and **Magic** is what a person reads, which is
 * The playtester's instruction: "use the human-friendly label Magic or Official Sets
 * in the UI rather than exposing implementation terminology". The label lives
 * here so a heading, a filter and a picker cannot each invent their own.
 */

export const SET_ORIGINS = ['custom', 'official'] as const;
export type SetOrigin = (typeof SET_ORIGINS)[number];

/** What each origin is called on screen. */
export const SET_ORIGIN_LABELS: Readonly<Record<SetOrigin, string>> = {
  custom: 'Custom',
  official: 'Magic',
};

/** The order the groups are drawn in: what this lab made comes first. */
export const SET_ORIGIN_ORDER: readonly SetOrigin[] = ['custom', 'official'];

/**
 * What a single set's origin reads as beside its name, as opposed to what a
 * group of them reads as above a list.
 *
 * A heading over a shelf says *Custom*; a line under one set's name says
 * *Custom set*, because on its own the adjective has nothing to attach to.
 * The playtester's example for the Play header is `Seraphine / Custom Set`, and this is
 * the half of it that is not the set's own name.
 */
export function setKindLabel(origin: SetOrigin): string {
  return `${SET_ORIGIN_LABELS[origin]} set`;
}

function isOrigin(value: unknown): value is SetOrigin {
  return typeof value === 'string' && (SET_ORIGINS as readonly string[]).includes(value);
}

/** The `set` block of a set document, as much of it as this decision reads. */
export interface SetOriginEvidence {
  readonly origin?: unknown;
  readonly reduced?: unknown;
}

/** What a set document says it is, or what its own fields already say. */
export function setOrigin(set: SetOriginEvidence): SetOrigin {
  if (isOrigin(set.origin)) return set.origin;
  return set.reduced === true ? 'official' : 'custom';
}

export interface SetGroup<Row> {
  readonly origin: SetOrigin;
  /** The heading: `Custom`, `Magic`. */
  readonly label: string;
  readonly rows: readonly Row[];
}

/**
 * The rows in their groups, in `SET_ORIGIN_ORDER`, with each group's own order
 * left as it arrived.
 *
 * An empty group is dropped rather than drawn with nothing under it — a
 * standing instruction in the spec this came from, and the reason a checkout
 * with only a generated set staged shows one heading and not two. Which also
 * means a single group is still a group: the heading is what says *custom*, and
 * a lab holding only custom sets should still say so.
 */
export function groupSetsByOrigin<Row extends { readonly origin: SetOrigin }>(
  rows: readonly Row[],
): readonly SetGroup<Row>[] {
  return SET_ORIGIN_ORDER.map((origin) => ({
    origin,
    label: SET_ORIGIN_LABELS[origin],
    rows: rows.filter((row) => row.origin === origin),
  })).filter((group) => group.rows.length > 0);
}
