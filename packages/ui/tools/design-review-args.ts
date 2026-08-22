/**
 * Everything `design-review.ts` reads before it draws anything: its flags, its
 * thumbnail map, its change notes.
 *
 * Split out for the reason `frame-review-args.ts` states — the tool itself
 * reads `process.argv`, reads files and writes one as a side effect of module
 * load, so nothing inside it can be exercised without running it. What is
 * testable about this tool is almost entirely the refusals: a thumbnail that
 * points at another host, a change note missing a field, a state word nobody
 * defined. Those are the inputs a person assembles by hand and gets wrong, and
 * they belong where a test can hand them over one at a time.
 */
import type { ChangeNote, Thumb } from './design-review-page';

export interface DesignReviewArgs {
  readonly set: string;
  readonly thumbs: string;
  readonly changes: string | undefined;
  readonly out: string;
  readonly title: string | undefined;
  readonly setName: string | undefined;
}

/**
 * Argv, or the one sentence saying what is wrong with it.
 *
 * A string return rather than a throw: every one of these is a person's typo
 * on a command line, and the caller prints it and exits 1 rather than showing
 * a stack trace for a missing flag.
 */
export function readDesignReviewArgs(argv: readonly string[]): DesignReviewArgs | string {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || !flag.startsWith('--')) return `expected a --flag, got ${flag ?? 'nothing'}`;
    if (value === undefined) return `${flag} needs a value`;
    values.set(flag.slice(2), value);
  }
  const set = values.get('set');
  const thumbs = values.get('thumbs');
  const out = values.get('out');
  if (set === undefined) return '--set is required: the path to a set document';
  if (thumbs === undefined) return '--thumbs is required: the path to a card-id to data-URI map';
  if (out === undefined) return '--out is required: the path to write the page to';
  return {
    set,
    thumbs,
    out,
    changes: values.get('changes'),
    title: values.get('title'),
    setName: values.get('set-name'),
  };
}

/**
 * The thumbnail map, refused rather than half-read when an entry is not one.
 *
 * The `data:` check is the load-bearing one and it is not about types. This
 * page's whole purpose is to be one file a reviewer opens somewhere else, and
 * an artifact host's content policy blocks every outside origin anyway, so a
 * thumbnail given as `https://…` produces a page of broken images at the far
 * end and a page that looks correct here. Refusing at the boundary is the only
 * place that difference is visible.
 */
export function readThumbs(document: unknown, source: string): ReadonlyMap<string, Thumb> {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new Error(`${source} is not an object of card id to thumbnail`);
  }
  const thumbs = new Map<string, Thumb>();
  for (const [id, value] of Object.entries(document as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) throw new Error(`${source}: ${id} is not an object`);
    const { src, alt } = value as { src?: unknown; alt?: unknown };
    if (typeof src !== 'string' || !src.startsWith('data:')) {
      throw new Error(`${source}: ${id} has no data: URI, so the page would reach another host for it`);
    }
    thumbs.set(id, { src, alt: typeof alt === 'string' ? alt : '' });
  }
  return thumbs;
}

/** The three words a change note's state may be, in the order the panel sorts them. */
export const CHANGE_STATES: readonly ChangeNote['state'][] = ['done', 'partly', 'open'];

/** The round's feedback notes, refused rather than half-read. */
export function readChanges(document: unknown, source: string): readonly ChangeNote[] {
  if (!Array.isArray(document)) throw new Error(`${source} is not an array of change notes`);
  return document.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null)
      throw new Error(`${source}[${String(index)}] is not an object`);
    const { asked, now, note, state } = raw as Record<string, unknown>;
    for (const [name, value] of [
      ['asked', asked],
      ['now', now],
      ['note', note],
    ] as const) {
      if (typeof value !== 'string' || value === '') {
        throw new Error(`${source}[${String(index)}].${name} must be a non-empty string`);
      }
    }
    if (typeof state !== 'string' || !(CHANGE_STATES as readonly string[]).includes(state)) {
      throw new Error(`${source}[${String(index)}].state must be one of ${CHANGE_STATES.join(', ')}`);
    }
    return {
      asked: asked as string,
      now: now as string,
      note: note as string,
      state: state as ChangeNote['state'],
    };
  });
}
