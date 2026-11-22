/**
 * Whether a card's rating is drawn in the draft rail, kept across reloads.
 *
 * `mtg-1j00i.5`, the playtester's ask: "toggleable on and off ... so I can choose
 * between cards based on general power-level from play data". On is the
 * default here, unlike `../../feedback/toggle.ts`'s off default, because a
 * rating already earned its place on screen the moment a presentation staged
 * one (`../draft/DraftPack.ts`'s `ratingOf` contract) — the switch exists to
 * let it be turned away, not to keep it hidden until asked for. The same
 * guarded store (`../deck/local-store.ts`) under a key beside the feedback
 * one; a store that cannot keep it draws on at the next reload rather than
 * failing loud over a preference.
 */
import { useCallback, useState } from 'react';
import { readStored, writeStored } from '../deck/local-store';

export const DRAFT_RATINGS_ENABLED_KEY = 'mtg.draft.ratings';

/** Anything other than an explicit 'off' reads as on, including a throwing store. */
export function readDraftRatingsEnabled(): boolean {
  return readStored(DRAFT_RATINGS_ENABLED_KEY) !== 'off';
}

/** Records the switch; false means the setting will not survive a reload. */
export function writeDraftRatingsEnabled(enabled: boolean): boolean {
  return writeStored(DRAFT_RATINGS_ENABLED_KEY, enabled ? 'on' : 'off');
}

export interface DraftRatingsSwitchHandle {
  readonly enabled: boolean;
  setEnabled(enabled: boolean): void;
}

export function useDraftRatingsSwitch(): DraftRatingsSwitchHandle {
  const [enabled, setState] = useState<boolean>(readDraftRatingsEnabled);
  const setEnabled = useCallback((next: boolean): void => {
    writeDraftRatingsEnabled(next);
    setState(next);
  }, []);
  return { enabled, setEnabled };
}
