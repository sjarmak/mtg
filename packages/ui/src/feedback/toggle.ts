/**
 * Whether the feedback helper is on, kept across reloads.
 *
 * `mtg-fvuyq.1`. Off is the default and off draws nothing: the helper is a
 * floating button above every route, and a person playing a game did not ask
 * for one. The switch is a preference like foil or pace, so it goes through the
 * same guarded store (`../routes/deck/local-store.ts` says why every access is
 * wrapped) under a key beside theirs. A store that cannot keep it is not worth a
 * word: the helper simply starts off at the next reload.
 */
import { useCallback, useState } from 'react';
import { readStored, writeStored } from '../routes/deck/local-store';

export const FEEDBACK_ENABLED_KEY = 'mtg.feedback.enabled';

export function readFeedbackEnabled(): boolean {
  return readStored(FEEDBACK_ENABLED_KEY) === 'on';
}

/** Records the switch; false means the setting will not survive a reload. */
export function writeFeedbackEnabled(enabled: boolean): boolean {
  return writeStored(FEEDBACK_ENABLED_KEY, enabled ? 'on' : 'off');
}

export interface FeedbackToggleHandle {
  readonly enabled: boolean;
  setEnabled(enabled: boolean): void;
}

export function useFeedbackToggle(): FeedbackToggleHandle {
  const [enabled, setState] = useState<boolean>(readFeedbackEnabled);
  const setEnabled = useCallback((next: boolean): void => {
    writeFeedbackEnabled(next);
    setState(next);
  }, []);
  return { enabled, setEnabled };
}
