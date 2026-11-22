import { describe, expect, it } from 'vitest';
import {
  describePrintedReleaseDates,
  formatReleaseDate,
  NO_RELEASE_DATES,
  releaseDateLookup,
} from '../../tools/printed-release-dates';
import type { PrintedFormatIndex } from '../../src/lab/printed-format';

const dates = releaseDateLookup({ AKH: '2017-04-28', HOU: '2017-07-14', MP2: null });

describe('formatReleaseDate', () => {
  it('takes the earliest product set, whatever order the catalogs list them in', () => {
    expect(formatReleaseDate(['HOU', 'AKH'], dates)).toBe('2017-04-28');
  });

  it('looks codes up without regard to case', () => {
    expect(formatReleaseDate(['hou'], dates)).toBe('2017-07-14');
  });

  it('is undated when any product set has no date, rather than dated from the rest', () => {
    expect(formatReleaseDate(['AKH', 'MP2'], dates)).toBeUndefined();
    expect(formatReleaseDate(['SCD'], dates)).toBeUndefined();
    expect(formatReleaseDate([], dates)).toBeUndefined();
    expect(formatReleaseDate(['AKH'], NO_RELEASE_DATES)).toBeUndefined();
  });
});

describe('describePrintedReleaseDates', () => {
  const index = (
    rows: readonly { readonly id: string; readonly releaseDate?: string }[],
  ): PrintedFormatIndex => ({ schemaVersion: 2, formats: rows }) as unknown as PrintedFormatIndex;

  it('names every undated format and whether the store was there to ask', () => {
    const staged = index([{ id: 'ktk', releaseDate: '2014-09-26' }, { id: 'scd' }, { id: 'momir-basic' }]);
    expect(describePrintedReleaseDates(staged, { releaseDateOf: dates, storePresent: true })).toBe(
      'Printed formats without a release date (listed last on Play; no product set has a date in the card store): scd, momir-basic.',
    );
    expect(
      describePrintedReleaseDates(staged, { releaseDateOf: NO_RELEASE_DATES, storePresent: false }),
    ).toBe(
      'Printed formats without a release date (listed last on Play; the card store is absent): scd, momir-basic.',
    );
  });

  it('says so when nothing is undated', () => {
    expect(
      describePrintedReleaseDates(index([{ id: 'ktk', releaseDate: '2014-09-26' }]), {
        releaseDateOf: dates,
        storePresent: true,
      }),
    ).toBe('Printed formats: every format carries a release date.');
  });
});
