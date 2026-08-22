import { describe, expect, it } from 'vitest';
import { readFrameReviewArgs } from '../tools/frame-review-args';

describe('the positional arguments frame-review.ts takes', () => {
  it('leaves every argument unstated when none are given', () => {
    expect(readFrameReviewArgs([])).toEqual({ out: undefined, set: undefined, artManifest: undefined });
  });

  it('reads an output directory alone', () => {
    expect(readFrameReviewArgs(['out/frame-review'])).toEqual({
      out: 'out/frame-review',
      set: undefined,
      artManifest: undefined,
    });
  });

  /**
   * The regression: the tool used to hardcode the fixture set no matter what
   * was passed here, so this is the one assertion that would have failed
   * against the old behavior if the parse had been tested at all.
   */
  it('reads an output directory and a named set, in that order', () => {
    expect(readFrameReviewArgs(['out/frame-review', 'out/XMP/set.json'])).toEqual({
      out: 'out/frame-review',
      set: 'out/XMP/set.json',
      artManifest: undefined,
    });
  });

  it('reads all three positions', () => {
    expect(readFrameReviewArgs(['out/frame-review', 'out/XMP/set.json', 'out/art/xmp/art.json'])).toEqual({
      out: 'out/frame-review',
      set: 'out/XMP/set.json',
      artManifest: 'out/art/xmp/art.json',
    });
  });

  it('rejects a fourth positional argument instead of ignoring a typo', () => {
    expect(() => readFrameReviewArgs(['a', 'b', 'c', 'd'])).toThrow(
      /at most an output directory, a set path, and an art manifest path/,
    );
  });
});
