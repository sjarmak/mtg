/**
 * What a Play section can be played with, worked out from what is staged.
 *
 * `mtg-a982g.5`. Which set a game uses was the header picker's answer for every
 * tab at once, so Play inherited a choice made for Cards and every landing drew
 * whatever the last link had selected: a commander deck in the set dropdown, a
 * printed format offered under Draft that deals no draft. The four Play
 * sections do not offer the same things, so each one lists its own, and the
 * chips above the landing (`./SourceChoice.ts`) are that list.
 *
 * Pure: no React, no fetch, no router. `../../dev/LabApp.ts` hands it the three
 * things the lab has staged and takes back the list and the resolution.
 */
import type { PrintedFormatRow } from '../../lab/printed-format';
import type { StagedSetRow } from '../../lab/set-index';
import type { SetOrigin } from '../../lab/set-origin';
import { LEGACY_CUBE_FORMAT } from '../legacy-cube/model';
import { PRINTED_DRAFT_UNAVAILABLE_REASON, PRINTED_SEALED_UNAVAILABLE_REASON } from './availability';
import type { PlayFormat } from './availability';

/** One thing a Play section can be played with. */
export type PlaySource =
  | { readonly kind: 'kernel'; readonly stem: string; readonly name: string; readonly origin: SetOrigin }
  | {
      readonly kind: 'printed';
      readonly stem: `printed:${string}`;
      readonly name: string;
      readonly unavailableReason?: string;
    }
  | { readonly kind: 'cube'; readonly stem: typeof LEGACY_CUBE_FORMAT; readonly name: string };

/** How a printed format is addressed; `../printed/use-printed-format.ts` parses the same. */
export const PRINTED_PREFIX = 'printed:';

/** The cube's name as a source row states it; `../legacy-cube/CubeCardsRoute.ts` draws the same. */
export const CUBE_SOURCE_NAME = 'MTGO Legacy Cube';

/**
 * What the lab has staged.
 *
 * `kernel` is the generated-set index's rows, narrowed to what a chip needs so
 * the flat launcher props (a set given without an index) can supply one row.
 */
export interface StagedSources {
  readonly kernel: readonly Pick<StagedSetRow, 'stem' | 'name' | 'origin'>[];
  readonly printed: readonly PrintedFormatRow[];
  readonly cube: boolean;
}

/** A printed row's kind; the field is optional and absent reads as limited. */
function printedKind(row: PrintedFormatRow): 'limited' | 'constructed' {
  return row.kind ?? 'limited';
}

function printedSource(row: PrintedFormatRow, unavailableReason?: string): PlaySource {
  return {
    kind: 'printed',
    stem: `${PRINTED_PREFIX}${row.id}`,
    name: row.name,
    ...(unavailableReason === undefined ? {} : { unavailableReason }),
  };
}

function kernelSources(staged: StagedSources): readonly PlaySource[] {
  return staged.kernel
    .filter((row) => row.origin === 'custom')
    .map((row): PlaySource => ({ kind: 'kernel', stem: row.stem, name: row.name, origin: row.origin }));
}

function byReleaseNewestFirst(left: PrintedFormatRow, right: PrintedFormatRow): number {
  if (left.releaseDate !== right.releaseDate) {
    if (left.releaseDate === undefined) return 1;
    if (right.releaseDate === undefined) return -1;
    return left.releaseDate < right.releaseDate ? 1 : -1;
  }
  if (left.name === right.name) return 0;
  return left.name < right.name ? -1 : 1;
}

export function orderPrintedFormats(rows: readonly PrintedFormatRow[]): readonly PrintedFormatRow[] {
  return [...rows].sort(byReleaseNewestFirst);
}

function canBePlayed(row: PrintedFormatRow): boolean {
  return row.availability.play.status !== 'unavailable';
}

/** Whether a printed row is Momir Basic, which is a section of its own (issue 308). */
function isMomir(row: PrintedFormatRow): boolean {
  return printedKind(row) === 'constructed' && row.variant === 'momir';
}

/** Playable rows first, then the ones that can only be read, each newest first. */
function playableFirst(rows: readonly PrintedFormatRow[]): readonly PlaySource[] {
  const ordered = orderPrintedFormats(rows);
  return [...ordered.filter(canBePlayed), ...ordered.filter((row) => !canBePlayed(row))].map((row) =>
    printedSource(row),
  );
}

export function playSources(sub: PlayFormat, staged: StagedSources): readonly PlaySource[] {
  if (sub === 'commander') {
    return playableFirst(staged.printed.filter((row) => printedKind(row) === 'constructed' && !isMomir(row)));
  }
  if (sub === 'momir') return playableFirst(staged.printed.filter(isMomir));
  const kernel = kernelSources(staged);
  if (sub === 'constructed') {
    const printed = orderPrintedFormats(
      staged.printed.filter(
        (row) => printedKind(row) === 'limited' && row.constructedFormatUrl !== undefined,
      ),
    ).map((row) => printedSource(row));
    return [...kernel, ...printed];
  }
  const limited = orderPrintedFormats(staged.printed.filter((row) => printedKind(row) === 'limited'));
  const unavailableReason =
    sub === 'draft' ? PRINTED_DRAFT_UNAVAILABLE_REASON : PRINTED_SEALED_UNAVAILABLE_REASON;
  const printed = limited.map((row) =>
    printedSource(
      row,
      (sub === 'draft' ? row.availability.draft : row.availability.sealed) === 'available'
        ? undefined
        : unavailableReason,
    ),
  );
  const cube: readonly PlaySource[] =
    sub === 'draft' && staged.cube
      ? [{ kind: 'cube', stem: LEGACY_CUBE_FORMAT, name: CUBE_SOURCE_NAME }]
      : [];
  return [...kernel, ...printed, ...cube];
}

/** The two sources a Forge table over the network is seated for. */
export type ForgeSource = Extract<PlaySource, { readonly kind: 'printed' | 'cube' }>;

/**
 * The format id the lab's Forge advertises for this source, which is what the
 * health answer is matched against (`../../net/observed-table.ts`).
 *
 * The cube's stem is already that id; a printed format's carries the prefix the
 * hash addresses it by, and the lab knows it by the row's own id. A kernel set
 * has no id here at all, which is why this takes the narrowed type: Forge seats
 * printed cards, and a generated set is not printed.
 */
export function forgeFormatId(source: ForgeSource): string {
  return source.kind === 'cube' ? source.stem : source.stem.slice(PRINTED_PREFIX.length);
}

/**
 * The stem a link names, narrowed to a format this section lists.
 *
 * `printed:akh-hou:HOU` is a Cards address for one set of a format; under Play
 * it means the format, so a deep link kept from the Cards tab still lands.
 */
function listed(stem: string, sources: readonly PlaySource[]): PlaySource | null {
  const exact = sources.find((source) => source.stem === stem);
  if (exact !== undefined) return exact;
  const format = stem.startsWith(PRINTED_PREFIX) ? stem.split(':').slice(0, 2).join(':') : null;
  return format === null ? null : (sources.find((source) => source.stem === format) ?? null);
}

/**
 * Which listed source this page is showing.
 *
 * The hash wins when it names something this section offers; a stem it does not
 * offer is not an error, it is a link made on another tab, so the launcher's
 * own set answers next and the head of the list after that. Only an empty
 * section has no answer.
 */
export function resolvePlaySource(
  params: Readonly<Record<string, string>>,
  sources: readonly PlaySource[],
  preferredStem: string | null,
): PlaySource | null {
  if (sources.length === 0) return null;
  const asked = params['cube'] ?? params['source'];
  const fromHash = asked === undefined ? null : listed(asked, sources);
  if (fromHash !== null) return fromHash;
  const preferred = preferredStem === null ? null : listed(preferredStem, sources);
  return preferred ?? sources[0] ?? null;
}

/**
 * Where a link that names Momir Basic under another section now belongs.
 *
 * Momir Basic was listed under Commander until 2026-10-10 and under
 * Constructed until issue 308 gave it a section of its own, so a link kept from
 * either names it under a section that no longer lists it. Only the address a
 * page was opened at is read this way (`../../dev/LabApp.ts`): a section link
 * carries `source` across, and following one from Momir to Constructed is a
 * choice to leave, not an old link.
 */
export function movedPlaySource(
  sub: PlayFormat,
  params: Readonly<Record<string, string>>,
  printed: readonly PrintedFormatRow[],
): PlayFormat | null {
  if (sub !== 'constructed' && sub !== 'commander') return null;
  const asked = params['source'];
  if (asked === undefined || !asked.startsWith(PRINTED_PREFIX)) return null;
  const id = asked.slice(PRINTED_PREFIX.length).split(':')[0];
  const row = printed.find((candidate) => candidate.id === id);
  return row !== undefined && isMomir(row) ? 'momir' : null;
}
