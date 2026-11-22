/**
 * Reading the printed-format index, and the one format a link selects.
 *
 * Selection-scoped loading: a prior format never survives a new selection's
 * loading state.
 *
 * `mtg-a982g.5` split the index read out of the selection. The index is what
 * the lab offers -- the Play sections list their sources out of it
 * (`../play/sources.ts`) -- and the selection is one row of it loaded; reading
 * it inside the selection hook meant a section could not ask what was staged
 * without first naming something to load.
 */
import { useEffect, useState } from 'react';
import { PrintedFormatIndexSchema, loadPrintedFormat } from '../../lab/printed-format';
import type { LoadedPrintedFormat, PrintedFormatIndex, PrintedFormatRow } from '../../lab/printed-format';
import { loadPrintedConstructedFormat } from '../../lab/printed-constructed-format';
import type { LoadedPrintedConstructedFormat } from '../../lab/printed-constructed-format';
import type { SetPickerRow } from '../../app/SetPicker';

type Resource<T> =
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'loading' }
  | { readonly status: 'failed' | 'absent'; readonly message: string };
export type PrintedFormatState = Resource<LoadedPrintedFormat>;
/**
 * What a selected row loaded into, by the kind of format it is.
 *
 * A Limited row prepares packs and a constructed row prepares none, so the two
 * loaders return different values and a surface narrows on `kind` before it
 * reads either; `PrintedSelectionRoute` is the one place that narrows.
 */
export type LoadedPrintedSelection =
  | {
      readonly kind: 'limited';
      readonly loaded: LoadedPrintedFormat;
      readonly constructed?: LoadedPrintedConstructedFormat;
    }
  | { readonly kind: 'constructed'; readonly loaded: LoadedPrintedConstructedFormat };
export type PrintedSelectionState = Resource<LoadedPrintedSelection>;
/** The index itself, read once and handed to everything that asks what is staged. */
export type PrintedFormatIndexState = Resource<PrintedFormatIndex>;
const PREFIX = 'printed:';
class NotStaged extends Error {}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (response.status === 404) throw new NotStaged('Printed formats are not staged.');
  if (!response.ok) throw new Error(`Reading ${url} failed (HTTP ${response.status})`);
  if (response.headers.get('content-type')?.includes('text/html')) {
    throw new NotStaged('Printed formats are not staged.');
  }
  return response.json() as Promise<unknown>;
}

function useResource<T>(key: string | undefined, read: () => Promise<T>): Resource<T> {
  const [state, setState] = useState<{ readonly key: string; readonly resource: Resource<T> } | null>(null);
  useEffect(() => {
    if (key === undefined) return;
    let live = true;
    setState({ key, resource: { status: 'loading' } });
    void read()
      .then((value) => {
        if (live) setState({ key, resource: { status: 'ready', value } });
      })
      .catch((cause: unknown) => {
        if (live)
          setState({
            key,
            resource: {
              status: cause instanceof NotStaged ? 'absent' : 'failed',
              message: cause instanceof Error ? cause.message : String(cause),
            },
          });
      });
    return () => {
      live = false;
    };
    // The key is the complete request identity; callers do not close over other mutable inputs.
  }, [key]);
  if (key === undefined) return { status: 'absent', message: 'Printed formats are not staged.' };
  return state?.key === key ? state.resource : { status: 'loading' };
}

/**
 * The sets in a format somebody would pick: those a product opens a pack of.
 *
 * The Invocations ride inside Amonkhet and Hour of Devastation packs and no
 * product opens an Invocations pack, so they are not a set to play and get no
 * row (`mtg-cz6kp`). An index staged before the role existed states none, and
 * every set on it is taken as a product.
 */
function pickableSets(row: PrintedFormatRow): PrintedFormatRow['catalogs'] {
  return row.catalogs.filter((source) => source.role !== 'supplement');
}

function soloCatalogStems(index: PrintedFormatIndex): ReadonlyMap<string, string> {
  const stems = new Map<string, string>();
  for (const row of index.formats) {
    if (row.kind === 'constructed') continue;
    const sets = pickableSets(row);
    const [only] = sets;
    if (only !== undefined && sets.length === 1) stems.set(only.code, `${PREFIX}${row.id}`);
  }
  return stems;
}

/**
 * One row per limited format, and one per pickable set inside it only when
 * there is more than one to choose between.
 *
 * A set row narrows the Cards gallery to that set's printings, which is worth
 * a row when a format is Amonkhet and Hour of Devastation together. A one-set
 * format's set row showed the same cards under the same name, so Innistrad was
 * listed twice (`mtg-u7fpr`).
 *
 * A constructed format is not a row at all (`mtg-a982g.5`). This picker names a
 * card source for Cards, Customize and Analysis, and the Starter Commander
 * decks are decks rather than a set to browse: they belong to the Commander
 * section, which lists them itself (`../play/sources.ts`).
 */
export function pickerRows(index: PrintedFormatIndex): readonly SetPickerRow[] {
  const solo = soloCatalogStems(index);
  const shared = new Set<string>();
  return index.formats.flatMap((row) => {
    if (row.kind === 'constructed') return [];
    const sets = pickableSets(row);
    const shares =
      sets.length > 1
        ? sets.flatMap((source) => {
            if (solo.has(source.code) || shared.has(source.code)) return [];
            shared.add(source.code);
            return [
              {
                stem: `${PREFIX}${row.id}:${source.code}`,
                name: source.name ?? source.code,
                origin: 'official' as const,
              },
            ];
          })
        : [];
    return [{ stem: `${PREFIX}${row.id}`, name: row.name, origin: 'official' as const }, ...shares];
  });
}

async function loadSelection(
  row: PrintedFormatRow,
  read: (url: string) => Promise<unknown>,
): Promise<LoadedPrintedSelection> {
  if (row.kind === 'constructed') {
    return { kind: 'constructed', loaded: await loadPrintedConstructedFormat(row, read) };
  }
  const [loaded, constructed] = await Promise.all([
    loadPrintedFormat(row, read),
    row.constructedFormatUrl === undefined ? undefined : loadPrintedConstructedFormat(row, read),
  ]);
  return {
    kind: 'limited',
    loaded,
    ...(constructed === undefined ? {} : { constructed }),
  };
}

/** The staged printed formats, read once per lab. */
export function usePrintedFormatIndex(indexUrl: string | undefined): PrintedFormatIndexState {
  return useResource(indexUrl, async () => PrintedFormatIndexSchema.parse(await fetchJson(indexUrl!)));
}

/** The staged rows, or none while the index is still being read. */
export function printedFormatRows(index: PrintedFormatIndexState): readonly PrintedFormatRow[] {
  return index.status === 'ready' ? index.value.formats : [];
}

export function usePrintedSelection(index: PrintedFormatIndexState, source: string | null) {
  const selected = source?.startsWith(PREFIX) === true;
  const selection = selected ? /^printed:([a-z0-9][a-z0-9-]*)(?::([A-Z0-9]+))?$/.exec(source) : null;
  const formatId = selection?.[1];
  const sourceCode = selection?.[2];
  const row =
    index.status === 'ready' ? index.value.formats.find((entry) => entry.id === formatId) : undefined;
  const key = row === undefined ? undefined : JSON.stringify(row);
  const loaded = useResource(key, () => loadSelection(row!, fetchJson));
  const state: PrintedSelectionState =
    selected && selection === null
      ? { status: 'failed', message: `Invalid printed format selection: ${source}` }
      : index.status !== 'ready'
        ? index
        : row === undefined
          ? { status: 'failed', message: `Printed format ${formatId ?? ''} is not staged.` }
          : sourceCode !== undefined && !row.catalogs.some((entry) => entry.code === sourceCode)
            ? { status: 'failed', message: `Printed source ${sourceCode} is not in ${row.name}.` }
            : loaded;
  const title = selectedTitle(row, sourceCode) ?? source ?? 'Printed format';
  const rows = index.status === 'ready' ? pickerRows(index.value) : [];
  const solo = index.status === 'ready' ? soloCatalogStems(index.value) : undefined;
  const stem = row !== undefined && sourceCode !== undefined ? (solo?.get(sourceCode) ?? source) : source;
  return {
    selected,
    state,
    /** The selected format's id, which is the evidence snapshot's join key for a printed format. */
    formatId: selected ? (formatId ?? null) : null,
    sourceCode,
    title,
    /** The picker row this selection lights, which for a stale link is the link itself. */
    stem,
    rows:
      selected && stem !== null && !rows.some((entry) => entry.stem === stem)
        ? [...rows, { stem, name: title, origin: 'official' as const }]
        : rows,
  };
}

function selectedTitle(row: PrintedFormatRow | undefined, code: string | undefined): string | undefined {
  return code === undefined ? row?.name : (row?.catalogs.find((entry) => entry.code === code)?.name ?? code);
}
