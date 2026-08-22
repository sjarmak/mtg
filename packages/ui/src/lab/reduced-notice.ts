/**
 * The reduction record a reduced reference build carries, and the one line the
 * shell says about it.
 *
 * A reduced build (`@mtg/data`'s `reducedReferenceSetDocument`, written by
 * `npm run reference:reduced`) is a real set with collector positions missing:
 * every card in it is a card the kernel proved, and the ones it could not prove
 * were dropped rather than approximated. On the page that is invisible — a
 * hundred and thirty-four cards look like a set — so the document names itself
 * and the shell repeats it on every route.
 *
 * # Why the parser lives here rather than in `tools/`
 *
 * It was in `tools/describe-reduction.ts`, which runs in the launcher and prints
 * to stdout, and a person handed the URL of a server somebody else started never
 * sees stdout. The browser needs the same block, and a second structural reader
 * of the same JSON is a second chance to disagree with the first about what
 * counts as malformed — which is exactly the disagreement nobody would notice,
 * because both directions of it are silence.
 *
 * So there is one reader and it lives in `src/`, because the arrow between these
 * two directories already points one way: `packages/ui/tools/*` imports
 * `../src/*` (`board-budget.ts`, `art-preference-order.ts` and five more), while
 * nothing under `src/` imports `tools/` — `tools/` is Node-only, it reaches
 * `node:fs`, and `src/` is what Vite bundles. Moving the reader down is
 * therefore free; moving the browser's import up would have put `node:fs` in a
 * browser bundle. `describe-reduction.ts` keeps the launcher's multi-line prose,
 * which is the half only stdout wants, and calls this for the parse.
 *
 * # Read structurally, and a malformed block is `null`
 *
 * The block is read field by field rather than through a schema, for the reason
 * `setIdentityOf` reads the set's code and name that way: `@mtg/ui` does not
 * depend on `@mtg/data` and should not start, since that package carries
 * `better-sqlite3` and this repository keeps native modules out of anything Vite
 * can reach.
 *
 * `null` is safe in the only direction that matters: it means the shell says
 * nothing extra. Completeness is never decided here — a set is not complete
 * because this function returned `null`, it is complete because of which builder
 * made the artifact, decided upstream and in the type system. An ordinary
 * generated set has no `reduction` block and is `null` as the normal case.
 */

export interface ReductionDrop {
  readonly collectorNumber: number;
  readonly name: string;
  readonly rarity: string;
  readonly colors: readonly string[];
  /** The identity-level refusal code, or the position-level one when that is all there is. */
  readonly code: string;
  readonly detail: string;
}

export interface SetReduction {
  readonly sourceName: string;
  readonly sourcePositions: number;
  readonly kept: number;
  readonly dropped: number;
  readonly keptByRarity: readonly (readonly [string, number])[];
  readonly droppedByRarity: readonly (readonly [string, number])[];
  readonly sheets: readonly (readonly [string, number, number])[];
  /**
   * The distinct pack sizes the printing's booster configurations deal, ascending.
   *
   * Empty for a document whose collation names no configuration, which is what an
   * emitter older than `mtg-nhyv.40` wrote. The launcher used to say "a 15-card
   * pack" whatever the printing collates; fifteen is M11's number and nothing in
   * the document said so, so the number is read now rather than assumed.
   */
  readonly packSizes: readonly number[];
  readonly fillsAPack: boolean;
  readonly drops: readonly ReductionDrop[];
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function censusByRarity(value: unknown): readonly (readonly [string, number])[] {
  const census = asObject(value);
  const rows = census?.['byRarity'];
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown) => {
    const record = asObject(row);
    const rarity = asString(record?.['rarity']);
    const positions = asCount(record?.['positions']);
    return rarity === null || positions === null ? [] : [[rarity, positions] as const];
  });
}

/**
 * One refused position's reason, preferring the identity-level refusal.
 *
 * The reduced builder only ever sees an absent evidence row, so its own code is
 * always `MISSING_POSITION` and its prose is "position N has no coverage row",
 * which is true and tells a reader nothing. The emitter joins the coverage
 * materializer's per-identity refusal onto the position when it has one, and
 * that is the sentence worth printing.
 */
function dropReason(record: Record<string, unknown>): { readonly code: string; readonly detail: string } {
  const refusal = asObject(record['refusal']);
  const code = asString(refusal?.['code']) ?? asString(record['code']) ?? 'REFUSED';
  const detail = asString(refusal?.['detail']) ?? asString(record['reason']) ?? 'no reason recorded';
  const missing = refusal?.['missing'];
  const gaps = Array.isArray(missing) ? missing.filter((gap): gap is string => typeof gap === 'string') : [];
  return { code, detail: gaps.length === 0 ? detail : `${detail} (${gaps.join('; ')})` };
}

/**
 * The reduction record a parsed set document carries, or `null` for any other
 * document.
 *
 * The four fields the notice is composed from — the source set's name and
 * position count, `kept` and `dropped` — are required, and a document missing
 * any of them is `null` rather than a partial sentence. The rest is optional
 * detail the launcher prints and the page does not: a census that failed to
 * parse leaves an empty list, because a missing rarity breakdown is not a reason
 * to stop saying how many positions are gone.
 */
export function readReduction(raw: unknown): SetReduction | null {
  const document = asObject(raw);
  if (document?.['kind'] !== 'position-reduced-reference-set-document') return null;
  const reduction = asObject(document['reduction']);
  if (reduction === null) return null;
  const source = asObject(reduction['source']);
  const sourceName = asString(source?.['name']);
  const sourcePositions = asCount(source?.['mainSetPositions']);
  const kept = asCount(reduction['kept']);
  const dropped = asCount(reduction['dropped']);
  if (sourceName === null || sourcePositions === null || kept === null || dropped === null) return null;
  const census = asObject(reduction['census']);
  const collation = asObject(reduction['collation']);
  const sheetRows = collation?.['sheets'];
  const boosterRows = collation?.['boosters'];
  const drops = reduction['drops'];
  return {
    sourceName,
    sourcePositions,
    kept,
    dropped,
    keptByRarity: censusByRarity(census?.['kept']),
    droppedByRarity: censusByRarity(census?.['dropped']),
    sheets: !Array.isArray(sheetRows)
      ? []
      : sheetRows.flatMap((row: unknown) => {
          const record = asObject(row);
          const name = asString(record?.['name']);
          const cards = asCount(record?.['cards']);
          const sourceCards = asCount(record?.['sourceCards']);
          return name === null || cards === null || sourceCards === null
            ? []
            : [[name, cards, sourceCards] as const];
        }),
    packSizes: !Array.isArray(boosterRows)
      ? []
      : [
          ...new Set(
            boosterRows.flatMap((row: unknown) => {
              const size = asCount(asObject(row)?.['packSize']);
              return size === null || size === 0 ? [] : [size];
            }),
          ),
        ].sort((left, right) => left - right),
    fillsAPack: collation?.['fillsAPack'] === true,
    drops: !Array.isArray(drops)
      ? []
      : drops.flatMap((row: unknown) => {
          const record = asObject(row);
          if (record === null) return [];
          const collectorNumber = asCount(record['collectorNumber']);
          const name = asString(record['name']);
          if (collectorNumber === null || name === null) return [];
          const colors = record['colors'];
          return [
            {
              collectorNumber,
              name,
              rarity: asString(record['rarity']) ?? 'unknown',
              colors: Array.isArray(colors)
                ? colors.filter((color): color is string => typeof color === 'string')
                : [],
              ...dropReason(record),
            },
          ];
        }),
  };
}

/**
 * The one line the shell shows: which set, how much of it, and what a drop is.
 *
 * Composed from the counts rather than read out of the document. A producer that
 * wrote its own prose could write a comforting one, and prose is not checkable;
 * a count of dropped positions can be held against the card list. The last
 * clause is the part a person actually needs before they deal a pool — a card
 * that is missing here is missing, not stood in for by something similar.
 */
export function reducedNoticeText(reduction: SetReduction): string {
  const refused =
    reduction.dropped === 0
      ? 'No collector position was refused'
      : `The other ${String(reduction.dropped)} were refused by the translation gate ` +
        'and are not in this set';
  return (
    `Reduced build: ${String(reduction.kept)} of ${reduction.sourceName}'s ` +
    `${String(reduction.sourcePositions)} collector positions. ${refused}; ` +
    'nothing was approximated or substituted.'
  );
}
