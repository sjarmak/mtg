/**
 * What both launchers do to put `/feedback-api` beside Vite.
 *
 * `npm run play` and `npm run lab` each plan the server (`plan.ts`), start one
 * when the plan says so, hand Vite the port through `MTG_FEEDBACK_PORT`, and
 * close it when Vite exits. That is the same eleven lines twice, so they are
 * here once. `portIsBusy` is the launcher's own probe, passed in because it
 * lives in `../play.ts` and this file must not import a launcher.
 */
import { createBudgetGuard, resolveProvider } from '@mtg/llm';
import { resolveDataDir } from '../data-path';
import { modelDrafter } from './draft';
import { DEFAULT_FEEDBACK_PORT, planFeedbackServer } from './plan';
import type { FeedbackServerPlan } from './plan';
import { feedbackDir } from './report';
import { startFeedbackServer } from './server';
import type { FeedbackServer } from './server';

/** A cap on model rounds per launch: the flag is consent to spend, not to spend without limit. */
export const MAX_DRAFTS = 50;

export interface LaunchedFeedback {
  readonly plan: FeedbackServerPlan;
  /** Null when the plan was `attach` or `inherited`: nothing of ours to close. */
  readonly server: FeedbackServer | null;
  /** What the launcher prints, one line per fact. */
  readonly message: string;
  /** What Vite is handed, spelled even when it equals the default. */
  readonly env: { readonly MTG_FEEDBACK_PORT: string };
  close(): Promise<void>;
}

export async function launchFeedback(options: {
  readonly repoRoot: string;
  readonly staged: string;
  readonly envPort: string | undefined;
  readonly portIsBusy: (port: number, host: string) => Promise<boolean>;
  /** `--feedback-model`: arm the model round. Off unless stated, because it spends. */
  readonly model?: boolean;
}): Promise<LaunchedFeedback> {
  const plan = planFeedbackServer({
    envPort: options.envPort,
    busy:
      options.envPort === undefined ? await options.portIsBusy(DEFAULT_FEEDBACK_PORT, '127.0.0.1') : false,
  });
  const server =
    plan.kind === 'start'
      ? await startFeedbackServer({
          port: plan.port,
          root: resolveDataDir(feedbackDir(options.repoRoot), options.repoRoot),
          repoRoot: options.repoRoot,
          staged: options.staged,
          ...(options.model === true
            ? {
                drafter: modelDrafter(
                  resolveProvider({ budget: createBudgetGuard({ maxCalls: MAX_DRAFTS }) }),
                ),
              }
            : {}),
        })
      : null;
  const notArmed =
    options.model === true && server === null
      ? "\n--feedback-model was stated, but the feedback server this run reports to is not this run's, so its own flags decide whether a model drafts."
      : '';
  return {
    plan,
    server,
    message: `${server === null ? plan.message : `${plan.message}\n${server.message}`}${notArmed}`,
    env: { MTG_FEEDBACK_PORT: String(plan.port) },
    close: () => (server === null ? Promise.resolve() : server.close()),
  };
}
