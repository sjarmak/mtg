/**
 * The pool of genuinely model-generated entries this bead's sample is drawn
 * from: the recorded Tideglass Reach run, replayed.
 *
 * `mtg-bc2.152.9` needs a held-out sample of generated (Slot, Card) pairs, and
 * this pipeline generates rather than translates, so there is no separate
 * "source text" file to sample from — the closest thing to it is the set of
 * entries `validateGeneratedSet` already builds while a run is in progress
 * (`../validate/index.ts`), which pairs every filled slot with the card the
 * model wrote for it and is exactly what the existing design-critique pass
 * reads too.
 *
 * The committed 79-card flagship set ships no `slots.json` sidecar, so its
 * entries would have to be reconstructed by re-running `allocateSlots` against
 * its brief and joining on collector number — fragile, since nothing proves
 * the committed set file and a fresh allocation still agree slot-for-slot.
 * Tideglass Reach does not have this problem: `fixtures/llm/` holds the
 * complete recorded request/response trace
 * of the one live run that produced it (`../../test/recorded-set.test.ts`
 * already replays this exact run for its own assertions), so `generateSet` run
 * against the replay reconstructs the *exact* in-memory `SetValidation` the
 * live run produced — the real entries, not an approximation of them — for
 * the cost of a fixture read. Ninety cards, zero authored (the brief states
 * none), so the whole pool is model-written.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixtureProvider } from '@mtg/llm';
import { parseBrief } from '../brief';
import type { SetBrief } from '../brief';
import { generateSet } from '../generate';
import type { RevisionRecord } from '../report';
import type { Entry } from '../validate/index';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TIDEGLASS_BRIEF_PATH = join(PACKAGE_ROOT, 'briefs', 'tideglass-reach.json');
export const TIDEGLASS_FIXTURE_DIR = join(PACKAGE_ROOT, 'fixtures', 'llm');

export interface EntryPool {
  readonly brief: SetBrief;
  readonly entries: readonly Entry[];
  /** The full revision report, applied and reverted alike; see `intent.ts`. */
  readonly revisions: readonly RevisionRecord[];
}

/**
 * Replays the recorded Tideglass Reach run and returns its entries. Makes no
 * network call and spends nothing: `createFixtureProvider({ record: false })`
 * throws on any request the fixture directory does not already hold, so this
 * is exactly as hermetic as `recorded-set.test.ts`.
 */
export async function loadTideglassEntryPool(): Promise<EntryPool> {
  const brief = parseBrief(JSON.parse(readFileSync(TIDEGLASS_BRIEF_PATH, 'utf8')) as unknown);
  const provider = createFixtureProvider({ dir: TIDEGLASS_FIXTURE_DIR, record: false });
  const result = await generateSet({ provider, brief });
  return { brief, entries: result.validation.entries, revisions: result.report.critique.revisions };
}
