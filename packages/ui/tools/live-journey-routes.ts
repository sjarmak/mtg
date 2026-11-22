import { routeHash, UI_SUBS } from '../src/app/router';
import type { PlayFormat } from '../src/routes/play/availability';
import { playSources } from '../src/routes/play/sources';
import type { StagedSources } from '../src/routes/play/sources';
import type { PrintedFormatRow } from '../src/lab/printed-format';

const PROBE_AVAILABILITY: PrintedFormatRow['availability'] = {
  browse: 'available',
  draft: 'unavailable',
  sealed: 'unavailable',
  play: { status: 'supported', reason: 'probed for its Play section only' },
};

export function sectionForPrecon(variant: NonNullable<PrintedFormatRow['variant']>): PlayFormat {
  const row: PrintedFormatRow = {
    id: 'route-probe',
    name: 'route-probe',
    kind: 'constructed',
    variant,
    availability: PROBE_AVAILABILITY,
    formatUrl: 'route-probe.json',
    catalogs: [{ code: 'X', url: 'route-probe.json' }],
  };
  const staged: StagedSources = { kernel: [], printed: [row], cube: false };
  const section = UI_SUBS.play.find((sub) =>
    playSources(sub, staged).some(
      (source) => source.kind === 'printed' && source.stem === 'printed:route-probe',
    ),
  );
  if (section === undefined) throw new Error(`no Play section lists a ${variant} constructed format`);
  return section;
}

/** The hash that opens one Play section on one source, with any further params. */
export function playHash(section: PlayFormat, params: Readonly<Record<string, string>>): string {
  return routeHash({ mode: 'play', sub: section, params });
}

/**
 * Matches the accessible name of a card's face-flip button and nothing else.
 * The journey once matched any button starting `Show `, which is also a card
 * named Show of Valor in Magic 2014, so the gallery step clicked a tile and
 * waited for a toggle that a set with no double-faced card never draws.
 */
export const FACE_FLIP_LABEL_SOURCE = '^Show .+ face of ';
