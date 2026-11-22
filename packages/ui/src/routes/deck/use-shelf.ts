/**
 * The decks the workbench has built, read off the deck server once per mount.
 *
 * `mtg-yp33.8` put them on the Decks tab, where they were reachable only by
 * opening the workbench and scrolling its left column past the whole form. The
 * Cards tab's deck gallery (`../cards/DeckGallery.ts`) draws the same shelf, so
 * the read lives here rather than in either reader: one hook, two readers, and
 * one place for the rule about what an unreachable server means.
 *
 * Empty is the ordinary state and it draws nothing: `npm run play` alone serves
 * no `/deck-api`, and a shelf drawn empty there would advertise a server that is
 * not running. So a failed fetch leaves the shelf empty rather than reporting,
 * for the reason `./DeckLibrary.ts` gives on the same effect it used to own.
 *
 * `setNames` rides beside the rows because a variation records the *codes* it
 * was cut from and the shelves are keyed by set *name*; without the map every
 * built deck would land under `DECKS_UNPLACED_LABEL`, true of a multi-set deck
 * and wrong about the single-set one that belongs beside the staged set's own
 * precons.
 */
import { useEffect, useState } from 'react';
import { fetchSets, fetchShelf } from './workbench/client';
import type { VariationSummary } from './workbench/client';

export interface Shelf {
  readonly variations: readonly VariationSummary[];
  /** Set code to set name, from the same server. */
  readonly setNames: ReadonlyMap<string, string>;
}

const EMPTY_SHELF: Shelf = { variations: [], setNames: new Map() };

export function useShelf(): Shelf {
  const [shelf, setShelf] = useState<Shelf>(EMPTY_SHELF);
  useEffect(() => {
    let live = true;
    void (async (): Promise<void> => {
      const [rows, sets] = await Promise.all([fetchShelf(), fetchSets()]);
      if (!live) return;
      setShelf({
        variations: rows.kind === 'ok' ? rows.value.variations : [],
        setNames:
          sets.kind === 'ok' ? new Map(sets.value.sets.map((entry) => [entry.code, entry.name])) : new Map(),
      });
    })();
    return (): void => {
      live = false;
    };
  }, []);
  return shelf;
}
