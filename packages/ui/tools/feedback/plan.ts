/**
 * Whether a launcher starts the feedback server, and what it says about it.
 *
 * `mtg-fvuyq.4`. The page reaches `/feedback-api` through Vite's proxy, whose
 * target is fixed when Vite boots (`../../vite.config.ts` reads
 * `MTG_FEEDBACK_PORT` and defaults to `DEFAULT_FEEDBACK_PORT`), so the server
 * is a singleton on a known port and every other case is a question of who
 * owns it — the table `../deck-server.ts` draws, for the same reason:
 *
 * | state                           | what the launcher does                    |
 * | ------------------------------- | ----------------------------------------- |
 * | `MTG_FEEDBACK_PORT` already set | nothing: a parent launcher owns that one  |
 * | something answers on the port   | nothing: the other lab's server files it  |
 * | the port is free                | starts one and hands Vite the port        |
 *
 * The middle row is `npm run play` and `npm run lab` open side by side. Both
 * write under the same `data/feedback/`, so which of the two files a report is
 * a matter of indifference; the one thing the second lab loses is its own
 * `--staged` sentence in the report, and the status line says whose it is.
 */

/** Restated in `../../vite.config.ts`; `../../test/tools/feedback-server.test.ts` pins the two. */
export const DEFAULT_FEEDBACK_PORT = 5279;

export type FeedbackServerPlan =
  | { readonly kind: 'start'; readonly port: number; readonly message: string }
  | { readonly kind: 'attach'; readonly port: number; readonly message: string }
  | { readonly kind: 'inherited'; readonly port: number; readonly message: string };

export interface FeedbackServerState {
  readonly envPort: string | undefined;
  readonly busy: boolean;
}

export function planFeedbackServer(state: FeedbackServerState): FeedbackServerPlan {
  const inherited = state.envPort === undefined ? undefined : Number(state.envPort);
  if (inherited !== undefined && Number.isInteger(inherited)) {
    return {
      kind: 'inherited',
      port: inherited,
      message: `UI/UX reports go to the feedback server this lab was started under, on port ${String(inherited)}.`,
    };
  }
  if (state.busy) {
    return {
      kind: 'attach',
      port: DEFAULT_FEEDBACK_PORT,
      message:
        `UI/UX reports go to the feedback server already running on port ${String(DEFAULT_FEEDBACK_PORT)} ` +
        '(another lab in another terminal, usually). This run starts none.',
    };
  }
  return {
    kind: 'start',
    port: DEFAULT_FEEDBACK_PORT,
    message:
      'UI/UX reports from the Feedback helper (the switch in the bar) are written under data/feedback/ and filed as GitHub issues.',
  };
}
