/**
 * The page's side of `/feedback-api`.
 *
 * Modeled on `../net/gameplay.ts`: never throws, a 404 is a lab that files no
 * feedback (a Vite started by hand, or a launcher without the server), and a
 * refusal is the server's own sentence. `fetchImpl` is injectable for tests.
 */
import { BeadDraftSchema } from './wire';
import type { BeadDraft, FeedbackReport } from './wire';

export const DEFAULT_FEEDBACK_BASE = '/feedback-api';

export interface FeedbackStatus {
  /** What the launcher staged, in its words: the set stem or the deck path. */
  readonly staged: string;
  /** Whether `gh` can file an issue from this checkout; without it a report is a directory and no issue. */
  readonly issues: boolean;
  /** Whether a model round is armed (`--feedback-model`). */
  readonly model: boolean;
}

export type FeedbackStatusRead =
  { readonly ok: true; readonly status: FeedbackStatus } | { readonly ok: false; readonly reason: string };

export type FeedbackFiled =
  | {
      readonly status: 'filed';
      /** The issue URL, or null when `gh issue create` was not run or failed; `note` says which. */
      readonly issue: string | null;
      /** Where the report was written, relative to the repository. */
      readonly directory: string;
      readonly note: string;
    }
  | { readonly status: 'refused'; readonly reason: string };

export type FeedbackDrafted =
  | { readonly status: 'drafted'; readonly draft: BeadDraft }
  | { readonly status: 'refused'; readonly reason: string };

export interface FeedbackClient {
  status(): Promise<FeedbackStatusRead>;
  /** The model round: one call, armed only when the status says `model`. */
  draft(report: FeedbackReport): Promise<FeedbackDrafted>;
  file(report: FeedbackReport): Promise<FeedbackFiled>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function refusalOf(status: number, body: unknown): string {
  if (isRecord(body) && typeof body['message'] === 'string') return body['message'];
  return `the lab answered ${String(status)}`;
}

function unreachable(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return `the lab could not be reached (${message})`;
}

export const NOT_FILING = 'this lab files no feedback: start it with npm run play or npm run lab';

const NOT_JSON = Symbol('not json');

function bodyOf(response: Response): Promise<unknown> {
  return response.json().catch(() => NOT_JSON);
}

function servedThePage(response: Response, body: unknown): boolean {
  return response.ok && body === NOT_JSON;
}

type Fetch = typeof globalThis.fetch;

export function httpFeedbackClient(
  base: string = DEFAULT_FEEDBACK_BASE,
  fetchImpl: Fetch = (input, init) => fetch(input, init),
): FeedbackClient {
  return {
    async status(): Promise<FeedbackStatusRead> {
      let response: Response;
      try {
        response = await fetchImpl(`${base}/status`, { method: 'GET' });
      } catch (cause: unknown) {
        return { ok: false, reason: unreachable(cause) };
      }
      const body = await bodyOf(response);
      if (response.status === 404 || servedThePage(response, body)) return { ok: false, reason: NOT_FILING };
      if (!response.ok) return { ok: false, reason: refusalOf(response.status, body) };
      if (
        !isRecord(body) ||
        typeof body['staged'] !== 'string' ||
        typeof body['issues'] !== 'boolean' ||
        typeof body['model'] !== 'boolean'
      ) {
        return { ok: false, reason: 'the lab answered without a status' };
      }
      return { ok: true, status: { staged: body['staged'], issues: body['issues'], model: body['model'] } };
    },
    async draft(report: FeedbackReport): Promise<FeedbackDrafted> {
      let response: Response;
      try {
        // The screenshot stays on the page: the round reads sentences, not pixels.
        response = await fetchImpl(`${base}/draft`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...report, image: null }),
        });
      } catch (cause: unknown) {
        return { status: 'refused', reason: unreachable(cause) };
      }
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 404) return { status: 'refused', reason: 'this lab has no model round armed' };
      if (!response.ok) return { status: 'refused', reason: refusalOf(response.status, body) };
      const parsed = BeadDraftSchema.safeParse(isRecord(body) ? body['draft'] : undefined);
      if (!parsed.success) return { status: 'refused', reason: 'the lab answered without a usable draft' };
      return { status: 'drafted', draft: parsed.data };
    },
    async file(report: FeedbackReport): Promise<FeedbackFiled> {
      let response: Response;
      try {
        response = await fetchImpl(`${base}/reports`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(report),
        });
      } catch (cause: unknown) {
        return { status: 'refused', reason: unreachable(cause) };
      }
      const body = await bodyOf(response);
      if (response.status === 404 || servedThePage(response, body)) {
        return { status: 'refused', reason: NOT_FILING };
      }
      if (!response.ok) return { status: 'refused', reason: refusalOf(response.status, body) };
      if (!isRecord(body) || typeof body['directory'] !== 'string' || typeof body['note'] !== 'string') {
        return { status: 'refused', reason: 'the lab filed the report and said nothing about where' };
      }
      const issue = typeof body['issue'] === 'string' ? body['issue'] : null;
      return { status: 'filed', issue, directory: body['directory'], note: body['note'] };
    },
  };
}
