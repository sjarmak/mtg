/**
 * The cube draft you left, offered back from the cube's own chooser.
 *
 * `mtg-bc2.154.4.30` put a Continue on the Draft tab's cube row, because a tab
 * press navigates with `params: {}` and drops `cube`, `seed` and `picks`
 * together; `./session.ts` argues the loss. `mtg-a982g.1` took that row away,
 * and `mtg-a982g.5` settled where it went instead: the cube is one of the sets
 * the Draft section offers, and its landing is the landing every draft has
 * (`../draft/DraftChooser.ts`). This is the offer that landing puts in it, so
 * the Continue reads the same here as it does over a staged set.
 *
 * Checked before it is drawn, and no further: the stored catalog hash against
 * this catalog's, then the transcript decoded against the pool the session
 * named. It never calls `runLegacyCubeDraft`, which deals 24 packs to eight
 * seats on a screen that rerenders on every hash change; the note counts
 * against the format's own rounds and pack size instead.
 */
import { PHYSICAL_CUBE_DEFAULT_PACK_SIZE, PHYSICAL_CUBE_DEFAULT_ROUNDS } from '@mtg/draft-export';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { legacyCubeDraftPool } from './model';
import type { LegacyCubeForgeReadyPool } from './model';
import type { DraftOffer } from '../draft/DraftChooser';
import { readLegacyCubeSession, resumeLegacyCube } from './session';

/**
 * The line under Continue: how far the stored draft got, out of the whole draft.
 *
 * The denominator is the format's own, three packs of fifteen as
 * `@mtg/draft-export` states them, rather than a number this would have to
 * deal a draft to learn.
 */
export function draftCubeResumeNote(picksMade: number): string {
  const total = PHYSICAL_CUBE_DEFAULT_ROUNDS * PHYSICAL_CUBE_DEFAULT_PACK_SIZE;
  return `${String(picksMade)} of ${String(total)} picks made.`;
}

/**
 * Reads the stored draft against this catalog and the pool it was dealt from.
 *
 * Resuming writes the pool mode, the seed and the transcript and nothing else:
 * the route drawing this chooser is already the cube's, so the source is in the
 * hash before the press.
 */
export function cubeResume(
  catalog: PrintedCardCatalog,
  forgeReady: LegacyCubeForgeReadyPool,
  onSetParams: (params: Readonly<Record<string, string>>) => void,
): DraftOffer {
  const session = readLegacyCubeSession();
  if (session === null) return { kind: 'none' };
  const pool =
    session.mode === 'forge-ready'
      ? legacyCubeDraftPool(catalog, 'forge-ready', forgeReady)
      : legacyCubeDraftPool(catalog, 'full');
  const read = resumeLegacyCube(session, pool);
  if (!read.ok) return { kind: 'stale' };
  return {
    kind: 'offer',
    note: draftCubeResumeNote(read.picksMade),
    onResume: (): void => {
      onSetParams({ pool: read.mode, seed: read.seed, picks: read.picks });
    },
  };
}
