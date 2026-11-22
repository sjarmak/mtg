/**
 * The decks the workbench built, fetched and resolved for the Play tab.
 *
 * The playtester, 2026-09-01: *"I just want to be able to do a selectable deck like
 * from the play tab the same way we can easily play a paired game of sky
 * islands vs down in the gloom."* The Play tab knows about the set's written
 * decks and nothing else, so this is the leg that puts a described deck beside
 * them.
 *
 * # Why the union pool, and why that is the art answer
 *
 * The playtester, in the same breath: *"we need to make sure the art is available."*
 * A built deck may name cards from more than one staged set — Vessari-v3 states
 * `XMP, M11, M13, RTR` and its lands are M11 printings — and the Play tab
 * browses one set at a time with that set's art resolver. Resolved against the
 * browsed set alone, half of a deck like that would not resolve at all;
 * resolved against the union and drawn with the browsed set's art, every card
 * from another set would wear the pending frame while its picture sat in that
 * set's own manifest. That is `mtg-pzpz`, which `../deck/constructed-pool.ts`
 * already solved for the Decks tab.
 *
 * So both come from the same place: the union's cards resolve the deck, and the
 * union's resolver draws it. A deck is offered only when **every** card in it
 * resolves; one that does not is reported by name rather than dealt short.
 */
import { useEffect, useState } from 'react';
import type { Card } from '@mtg/dsl';
import { fetchShelf, fetchVariation } from '../deck/workbench/client';
import { isMissing, playableVariation } from './playable-deck';
import type { PlayableDeck } from './playable-deck';

/**
 * Whether the deck server offers any built deck at all.
 *
 * One request, asked before anything expensive happens. `npm run play` alone
 * serves no `/deck-api`, so this answers `false` immediately and the Play tab
 * stays exactly the tab it was — which is the whole point of asking: reading
 * every staged set costs a parse of every card in them, and `mtg-tewc.8` bought
 * that cost for the Cards tab on the argument that a lab opened on Play has no
 * reason to pay it. With a shelf of built decks there is now a reason, and
 * without one there still is not.
 */
export function useShelfPresence(): boolean {
  const [present, setPresent] = useState(false);
  useEffect(() => {
    let live = true;
    void fetchShelf().then((answer) => {
      if (live) setPresent(answer.kind === 'ok' && answer.value.variations.length > 0);
    });
    return (): void => {
      live = false;
    };
  }, []);
  return present;
}

export interface BuiltDecks {
  /** Every built deck that resolved, newest first, as the shelf orders them. */
  readonly decks: readonly PlayableDeck[];
  /** Decks the staged sets can no longer deal, by name, so the page can say so. */
  readonly unplayable: readonly { readonly name: string; readonly missing: readonly string[] }[];
}

const NONE: BuiltDecks = { decks: [], unplayable: [] };

/**
 * Reads the deck server's shelf and resolves every deck on it against `pool`.
 *
 * Answers `NONE` while it is reading and `NONE` for good when there is no deck
 * server, which is the ordinary state: `npm run play` alone serves no
 * `/deck-api`, and the picker then draws exactly the decks it always drew.
 */
export function useBuiltDecks(pool: readonly Card[]): BuiltDecks {
  const [built, setBuilt] = useState<BuiltDecks>(NONE);

  useEffect(() => {
    if (pool.length === 0) {
      setBuilt(NONE);
      return;
    }
    let live = true;
    void (async (): Promise<void> => {
      const shelf = await fetchShelf();
      if (!live || shelf.kind !== 'ok') return;
      const decks: PlayableDeck[] = [];
      const unplayable: { name: string; missing: readonly string[] }[] = [];
      // One request per deck, because the shelf sends summaries: a shelf of
      // thirty variations does not carry thirty decklists, by design.
      for (const row of shelf.value.variations) {
        const answer = await fetchVariation(row.id);
        if (!live) return;
        if (answer.kind !== 'ok') continue;
        const resolved = playableVariation(answer.value, pool);
        if (isMissing(resolved)) unplayable.push({ name: row.name, missing: resolved.missing });
        else decks.push(resolved);
      }
      if (live) setBuilt({ decks, unplayable });
    })();
    return (): void => {
      live = false;
    };
  }, [pool]);

  return built;
}

/** What to say about decks the staged sets cannot deal. */
export function unplayableNote(unplayable: BuiltDecks['unplayable']): string | null {
  if (unplayable.length === 0) return null;
  const named = unplayable.map((deck) => `${deck.name} (${deck.missing.slice(0, 3).join(', ')})`);
  return (
    `${named.join('; ')} ${unplayable.length === 1 ? 'is' : 'are'} not offered: the staged sets no ` +
    'longer hold every card. Rebuild against the sets staged now, or stage the set it was cut from.'
  );
}
