/**
 * Sends a game the moment it ends, once, and says what came of it.
 *
 * The seam `LiveGame` reports through. It watches the session's result: the
 * flip from null to a result is the one moment a game is finished and whole,
 * and the same result object is never reported twice, so a re-render after
 * the send neither repeats it nor loses the answer. A restart puts the result
 * back to null, which clears the answer and arms the next game. A null report
 * is a surface that records nothing, and it sends nothing.
 *
 * The session is read through a ref rather than listed as a dependency: the
 * effect runs on the result, and what it needs from the session is what the
 * session holds at that moment.
 */
import { useEffect, useRef, useState } from 'react';
import type { GameResult, GameSession } from '@mtg/kernel';
import type { GameplayReport, GameplaySent } from '../../net/gameplay';
import type { PlayConfig } from './use-session';

async function send(
  report: GameplayReport,
  session: GameSession,
  config: PlayConfig,
  result: GameResult,
): Promise<GameplaySent> {
  const opened = await report.sender.open();
  if (!opened.ok) return { status: 'refused', reason: opened.reason };
  return report.sender.finish(opened.token, {
    config,
    choices: session.choices,
    result,
    format: report.format,
  });
}

export function useGameplayReport(
  session: GameSession,
  config: PlayConfig,
  report: GameplayReport | null,
): GameplaySent | null {
  const [sent, setSent] = useState<GameplaySent | null>(null);
  const latest = useRef({ session, config });
  latest.current = { session, config };
  const reported = useRef<GameResult | null>(null);
  const result = session.result;

  useEffect(() => {
    if (result === null) {
      reported.current = null;
      setSent((previous) => (previous === null ? previous : null));
      return undefined;
    }
    if (report === null || reported.current === result) return undefined;
    reported.current = result;
    let live = true;
    void send(report, latest.current.session, latest.current.config, result).then((outcome) => {
      if (live) setSent(outcome);
    });
    return (): void => {
      live = false;
    };
  }, [result, report]);

  return sent;
}
