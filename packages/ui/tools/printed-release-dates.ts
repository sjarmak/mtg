import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { PrintedFormatIndex } from '../src/lab/printed-format';

export type ReleaseDateLookup = (setCode: string) => string | undefined;

export const RELEASE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const SetReleaseDatesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  releaseDates: z.record(z.string().regex(/^[A-Z0-9]+$/u), z.string().regex(RELEASE_DATE_PATTERN).nullable()),
});

export function releaseDateLookup(dates: Readonly<Record<string, string | null>>): ReleaseDateLookup {
  return (setCode) => dates[setCode.toUpperCase()] ?? undefined;
}

export const NO_RELEASE_DATES: ReleaseDateLookup = () => undefined;

export function cardStorePath(repoRoot: string): string {
  return join(repoRoot, 'data', 'store', 'mtg.sqlite');
}

export interface StoreReleaseDates {
  readonly releaseDateOf: ReleaseDateLookup;
  readonly storePresent: boolean;
}

export function storeReleaseDates(repoRoot: string, setCodes: readonly string[]): StoreReleaseDates {
  const store = cardStorePath(repoRoot);
  if (!existsSync(store)) return { releaseDateOf: NO_RELEASE_DATES, storePresent: false };
  if (setCodes.length === 0) return { releaseDateOf: NO_RELEASE_DATES, storePresent: true };
  const temporary = mkdtempSync(join(tmpdir(), 'mtg-set-release-dates-'));
  const output = join(temporary, 'release-dates.json');
  try {
    execFileSync(
      join(repoRoot, 'node_modules', '.bin', 'tsx'),
      [
        join(repoRoot, 'packages', 'data', 'tools', 'set-release-dates.ts'),
        '--database',
        store,
        '--out',
        output,
        ...setCodes,
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
    return {
      releaseDateOf: releaseDateLookup(
        SetReleaseDatesSchema.parse(JSON.parse(readFileSync(output, 'utf8'))).releaseDates,
      ),
      storePresent: true,
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function formatReleaseDate(
  productCodes: readonly string[],
  releaseDateOf: ReleaseDateLookup,
): string | undefined {
  if (productCodes.length === 0) return undefined;
  const dates = productCodes.map(releaseDateOf);
  return dates.every((date): date is string => date !== undefined) ? [...dates].sort()[0] : undefined;
}

export function describePrintedReleaseDates(index: PrintedFormatIndex, store: StoreReleaseDates): string {
  const undated = index.formats.filter((row) => row.releaseDate === undefined).map((row) => row.id);
  if (undated.length === 0) return 'Printed formats: every format carries a release date.';
  const because = store.storePresent
    ? 'no product set has a date in the card store'
    : 'the card store is absent';
  return `Printed formats without a release date (listed last on Play; ${because}): ${undated.join(', ')}.`;
}
