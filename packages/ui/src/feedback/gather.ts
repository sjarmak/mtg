/**
 * Everything the page can say about itself without being asked.
 *
 * `mtg-fvuyq.3`. A report is somebody's sentence plus the machine's, and this
 * is the machine's: where the page was, how big, on what browser, with which
 * preferences set, and what was on the table (`subject.ts`). Pure over the
 * narrow host interface below, so the whole of it is checked under vitest with
 * a stated host rather than whatever jsdom happens to have; `browserHost()`
 * is the runtime check, in the shape `../app/router.ts`'s `hashSource` uses.
 */
import { readStored } from '../routes/deck/local-store';
import { readFeedbackSubjects } from './subject';
import type { FeedbackContext } from './wire';

export interface FeedbackHost {
  readonly location: { readonly hash: string; readonly href: string };
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly devicePixelRatio: number;
  readonly navigator: { readonly userAgent: string };
  readonly document: { readonly title: string };
}

/**
 * The preferences a report reads back. Named here rather than discovered,
 * because a report that dumped every key in the store would carry the saved
 * decks and the draft session with it — kilobytes that answer no UI question.
 */
export const REPORTED_PREFERENCE_KEYS: readonly string[] = [
  'mtg.play.foil',
  'mtg.play.pace',
  'mtg.play.side-panel',
  'mtg.play.game-log',
  'mtg.play.ask-column',
  'mtg.play.commander-card',
  'mtg.draft.viewer',
];

export function browserHost(): FeedbackHost | null {
  const candidate: unknown = (globalThis as { readonly window?: unknown }).window;
  if (typeof candidate !== 'object' || candidate === null) return null;
  const partial = candidate as Partial<FeedbackHost>;
  if (typeof partial.location !== 'object' || partial.location === null) return null;
  if (typeof partial.location.hash !== 'string' || typeof partial.location.href !== 'string') return null;
  if (typeof partial.innerWidth !== 'number' || typeof partial.innerHeight !== 'number') return null;
  if (typeof partial.navigator !== 'object' || partial.navigator === null) return null;
  if (typeof partial.document !== 'object' || partial.document === null) return null;
  return candidate as FeedbackHost;
}

export interface GatherOptions {
  readonly host: FeedbackHost | null;
  readonly now: Date;
  readonly readPreference?: (key: string) => string | null;
  readonly subjects?: () => readonly FeedbackContext['subject'][];
}

export function gatherFeedbackContext(options: GatherOptions): FeedbackContext {
  const read = options.readPreference ?? readStored;
  const preferences: Record<string, string> = {};
  for (const key of REPORTED_PREFERENCE_KEYS) {
    const value = read(key);
    if (value !== null) preferences[key] = value;
  }
  const host = options.host;
  const subjects = (options.subjects ?? readFeedbackSubjects)();
  return {
    capturedAt: options.now.toISOString(),
    hash: host?.location.hash ?? '',
    href: host?.location.href ?? '',
    title: host?.document.title ?? '',
    viewport: {
      width: host?.innerWidth ?? 0,
      height: host?.innerHeight ?? 0,
      devicePixelRatio: typeof host?.devicePixelRatio === 'number' ? host.devicePixelRatio : 1,
    },
    userAgent: host?.navigator.userAgent ?? '',
    preferences,
    subject: subjects[0] ?? null,
  };
}
