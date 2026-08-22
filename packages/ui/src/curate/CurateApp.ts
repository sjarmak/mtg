/**
 * The curation page's one stateful component: taps in, files on disk out.
 *
 * It holds the ranking (`ranking.ts`), draws the grid (`CurateGrid.ts`) and
 * writes through the endpoint (`client.ts`) after every gesture. Writing per
 * tap rather than on a Save button is deliberate: the page is opened on a
 * tablet, left, and come back to, and a save control is a way to lose an
 * afternoon of looking to a locked screen.
 *
 * A refused write is not swallowed and not retried. The reason is drawn above
 * the grid until the next write succeeds, because the failure a refusal
 * actually indicates — a stale tab against a restaged index — is one only the
 * person holding the tablet can resolve.
 */
import { createElement as h, Fragment, useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { CurationCandidate, CurationIndex } from '../lab/curation-index';
import { CurateGrid } from './CurateGrid';
import type { RegenerationEdit } from './CurateGrid';
import { CURATE_CSS } from './styles';
import { readRemoteState, writePreference, writeRegeneration } from './client';
import type { RegenerationRow, WriteOutcome } from './client';
import { EMPTY_CURATION_STATE, stateFromPreferences, tap, undo } from './ranking';
import type { CurationState } from './ranking';

export interface CurateAppProps {
  readonly index: CurationIndex;
}

/** Card id to its recorded flag, mirroring the rows the server hands back. */
function requestedByCard(rows: readonly RegenerationRow[]): ReadonlyMap<string, RegenerationRow> {
  return new Map(rows.map((row) => [row.cardId, row]));
}

export function CurateApp(props: CurateAppProps): ReactElement {
  const [state, setState] = useState<CurationState>(EMPTY_CURATION_STATE);
  const [requested, setRequested] = useState<ReadonlyMap<string, RegenerationRow>>(new Map());
  const [comparing, setComparing] = useState<CurationCandidate | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // What is already on disk. A page that opened blank over an existing
  // preferences file would invite somebody to rank a card they already ranked
  // and quietly replace the earlier answer.
  useEffect(() => {
    let live = true;
    void readRemoteState().then((remote) => {
      if (!live || remote === null) return;
      setState(stateFromPreferences(remote.preferences));
      setRequested(requestedByCard(remote.regenerations));
    });
    return () => {
      live = false;
    };
  }, []);

  const report = useCallback((outcome: WriteOutcome): void => {
    setProblem(outcome.ok ? null : outcome.reason);
  }, []);

  // The three handlers read the current state rather than a `setState` updater,
  // and the reason is the POST inside them: React invokes an updater twice under
  // StrictMode, so a write placed in one is a write made twice, which on the
  // regeneration control is a request toggled back off by its own echo.
  const onTap = useCallback(
    (cardId: string, digest: string): void => {
      const change = tap(state, cardId, digest);
      setState(change.state);
      void writePreference(change.cardId, change.hashes).then(report);
    },
    [report, state],
  );

  const onUndo = useCallback((): void => {
    const change = undo(state);
    if (change === null) return;
    setState(change.state);
    void writePreference(change.cardId, change.hashes).then(report);
  }, [report, state]);

  const onRegenerate = useCallback(
    (edit: RegenerationEdit): void => {
      const next = new Map(requested);
      if (edit.requested) {
        next.set(edit.cardId, {
          cardId: edit.cardId,
          causes: edit.causes,
          ...(edit.note === undefined ? {} : { note: edit.note }),
        });
        void writeRegeneration(edit.cardId, true, edit.causes, edit.note).then(report);
      } else {
        next.delete(edit.cardId);
        void writeRegeneration(edit.cardId, false).then(report);
      }
      setRequested(next);
    },
    [report, requested],
  );

  return h(
    Fragment,
    null,
    h('style', null, CURATE_CSS),
    h(CurateGrid, {
      index: props.index,
      state,
      requested,
      onTap,
      onUndo,
      onRegenerate,
      onCompare: setComparing,
      comparing,
      canUndo: state.history.length > 0,
      problem,
    }),
  );
}
