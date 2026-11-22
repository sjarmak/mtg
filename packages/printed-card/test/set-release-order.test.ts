import { describe, expect, it } from 'vitest';
import { releaseDateOf } from '../src/set-release-order';

describe('set release order', () => {
  it('answers the recorded release date for an onboarded set, case-insensitively', () => {
    expect(releaseDateOf('AKH')).toBe('2017-04-28');
    expect(releaseDateOf('akh')).toBe('2017-04-28');
    expect(releaseDateOf('HOU')).toBe('2017-07-14');
    expect((releaseDateOf('AKH') ?? '') < (releaseDateOf('HOU') ?? '')).toBe(true);
  });

  it('leaves a set nobody has onboarded, or no set at all, unresolved rather than guessing', () => {
    expect(releaseDateOf('XLN')).toBeUndefined();
    expect(releaseDateOf(undefined)).toBeUndefined();
  });
});
