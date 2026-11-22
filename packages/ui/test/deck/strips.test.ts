import { describe, expect, it } from 'vitest';
import { CARD_TRIM_MM, FULL_FACE_WIDTH_REM } from '@mtg/card-geometry';
import {
  CARD_TRIM_RATIO,
  DECK_STACK_BOX,
  DRAFT_STACK_BOX,
  FULL_BAND_SHARE,
  FULL_COLUMN_MAX_PX,
  FULL_COLUMN_MIN_PX,
  FULL_MIN_PITCH_PX,
  STRIP_COLUMN_GAP_PX,
  type StackBox,
  type StripFacts,
  fullColumnWidth,
  fullStackBox,
  openedStack,
  stackMetrics,
  stripLabel,
  stripsOf,
} from '../../src/routes/deck/strips';

interface Entry {
  readonly name: string;
  readonly count: number;
}

const factsOf = (entry: Entry): StripFacts => ({
  key: entry.name,
  name: entry.name,
  manaCost: '{R}',
  colorIdentity: 'R',
  copies: entry.count,
});

describe('one strip per copy', () => {
  it('draws a four-of as four strips, which is what the head counts', () => {
    const strips = stripsOf([{ name: 'Bolt', count: 4 }], factsOf);
    expect(strips).toHaveLength(4);
    expect(strips.map((strip) => strip.copy)).toEqual([1, 2, 3, 4]);
    expect(strips.every((strip) => strip.of === 4)).toBe(true);
  });

  it('keys each copy distinctly so a click lands on one of them', () => {
    const strips = stripsOf([{ name: 'Bolt', count: 3 }], factsOf);
    expect(new Set(strips.map((strip) => strip.key)).size).toBe(3);
  });

  it('hands the member straight back, so a click needs no lookup', () => {
    const bolt = { name: 'Bolt', count: 2 };
    expect(stripsOf([bolt], factsOf).every((strip) => strip.member === bolt)).toBe(true);
  });

  it('draws only the bottom strip of the whole column full', () => {
    const strips = stripsOf(
      [
        { name: 'Bolt', count: 2 },
        { name: 'Shock', count: 2 },
      ],
      factsOf,
    );
    expect(strips.map((strip) => strip.full)).toEqual([false, false, false, true]);
  });

  it('draws a column of one as a face and nothing else', () => {
    const strips = stripsOf([{ name: 'Bolt', count: 1 }], factsOf);
    expect(strips).toHaveLength(1);
    expect(strips[0]?.full).toBe(true);
  });

  it('is empty for an empty column rather than drawing a face of nothing', () => {
    expect(stripsOf([], factsOf)).toEqual([]);
  });

  it('keeps the members in the order the group sorted them', () => {
    const strips = stripsOf(
      [
        { name: 'Assault', count: 1 },
        { name: 'Bolt', count: 2 },
      ],
      factsOf,
    );
    expect(strips.map((strip) => strip.name)).toEqual(['Assault', 'Bolt', 'Bolt']);
  });

  it('says which copy it is, and says nothing extra when there is one', () => {
    const [only] = stripsOf([{ name: 'Bolt', count: 1 }], factsOf);
    const four = stripsOf([{ name: 'Bolt', count: 4 }], factsOf);
    expect(only && stripLabel(only)).toBe('Bolt');
    expect(four[1] && stripLabel(four[1])).toBe('Bolt, copy 2 of 4');
  });
});

describe('the pitch that fits a column into a fixed box', () => {
  const box: StackBox = { boxHeight: 360, stripHeight: 26, faceHeight: 132, minPitch: 13 };

  it('does not overlap at all when the column has room', () => {
    // Four strips: 3 * 26 + 132 = 210, well inside 360.
    const seen = stackMetrics(4, box);
    expect(seen.pitch).toBe(26);
    expect(seen.height).toBe(210);
    expect(seen.clipped).toBe(false);
  });

  it('tightens the pitch rather than growing the box', () => {
    const loose = stackMetrics(4, box);
    const tight = stackMetrics(16, box);
    expect(tight.pitch).toBeLessThan(loose.pitch);
    expect(tight.height).toBeLessThanOrEqual(box.boxHeight);
    expect(tight.clipped).toBe(false);
  });

  it('holds the box height across every depth that fits', () => {
    for (let strips = 2; strips <= 18; strips += 1) {
      const seen = stackMetrics(strips, box);
      expect(seen.height, `${String(strips)} strips`).toBeLessThanOrEqual(box.boxHeight + 1);
    }
  });

  it('floors the pitch and reports the column clipped past it', () => {
    // 40 strips would need (360 - 132) / 39 = 5.8px, well under the floor.
    const seen = stackMetrics(40, box);
    expect(seen.pitch).toBe(box.minPitch);
    expect(seen.height).toBe(13 * 39 + 132);
    expect(seen.clipped).toBe(true);
  });

  it('is a face and no pitch for a column of one, and nothing for none', () => {
    expect(stackMetrics(1, box)).toEqual({ pitch: 26, height: 132, clipped: false });
    expect(stackMetrics(0, box)).toEqual({ pitch: 26, height: 0, clipped: false });
  });

  it('does not call a column that fits exactly clipped', () => {
    // Chosen so the division lands on the box height exactly.
    const exact = stackMetrics(20, { ...box, boxHeight: 132 + 19 * 12, minPitch: 1 });
    expect(exact.clipped).toBe(false);
  });

  it('ships a box whose bottom strip is one strip tall', () => {
    // mtg-mxkrk: a compact column draws no pictures, so the bottom strip is one
    // more name bar and the box may not reserve a card's height for it. Both
    // shipped boxes are compact boxes; the full density derives its own from
    // the column width (`fullStackBox`).
    expect(DECK_STACK_BOX.faceHeight).toBe(DECK_STACK_BOX.stripHeight);
    expect(DRAFT_STACK_BOX.faceHeight).toBe(DRAFT_STACK_BOX.stripHeight);
    expect(DECK_STACK_BOX.minPitch).toBeLessThan(DECK_STACK_BOX.stripHeight);
    expect(DRAFT_STACK_BOX.minPitch).toBeLessThan(DRAFT_STACK_BOX.stripHeight);
    expect(DECK_STACK_BOX.boxHeight).toBeGreaterThan(DECK_STACK_BOX.faceHeight);
    expect(DRAFT_STACK_BOX.boxHeight).toBeGreaterThan(DRAFT_STACK_BOX.faceHeight);
  });
});

describe('the width a full-density column is drawn at', () => {
  it('does not squeeze full cards when the region would divide into narrower columns', () => {
    expect(fullColumnWidth(836, 4)).toBe(FULL_COLUMN_MIN_PX);
  });

  it('keeps a face readable rather than dividing the pane all the way down', () => {
    expect(fullColumnWidth(400, 8)).toBe(FULL_COLUMN_MIN_PX);
  });

  it('stops widening at the width a full face was measured at', () => {
    expect(fullColumnWidth(4000, 2)).toBe(FULL_COLUMN_MAX_PX);
    expect(FULL_COLUMN_MAX_PX).toBe(FULL_FACE_WIDTH_REM * 16);
  });

  it('draws the floor where nothing has measured the region', () => {
    expect(fullColumnWidth(null, 4)).toBe(FULL_COLUMN_MIN_PX);
    expect(fullColumnWidth(1200, 0)).toBe(FULL_COLUMN_MIN_PX);
  });

  it('floors to a whole pixel rather than laying columns out on a fraction', () => {
    expect(Number.isInteger(fullColumnWidth(1001, 3))).toBe(true);
  });

  it('states the gap the sheet writes between two columns', () => {
    expect(STRIP_COLUMN_GAP_PX).toBe(12);
  });
});

describe('the box a column of whole faces is laid out against', () => {
  it('takes the card trim rather than a second statement of it', () => {
    expect(CARD_TRIM_RATIO).toBe(CARD_TRIM_MM.height / CARD_TRIM_MM.width);
  });

  it('is one face tall, at the trim of the width it was given', () => {
    const box = fullStackBox(240);
    expect(box.faceHeight).toBe(Math.round(240 * CARD_TRIM_RATIO));
    expect(box.boxHeight).toBe(box.faceHeight);
  });

  it('shows the title bar and the art band of the card under the next one', () => {
    const box = fullStackBox(240);
    expect(box.stripHeight).toBe(Math.round(box.faceHeight * FULL_BAND_SHARE));
    expect(box.stripHeight).toBeLessThan(box.faceHeight);
  });

  it('floors the pitch at the same height a compact strip is drawn at', () => {
    expect(fullStackBox(240).minPitch).toBe(FULL_MIN_PITCH_PX);
    expect(FULL_MIN_PITCH_PX).toBe(DECK_STACK_BOX.stripHeight);
  });
});

describe('opening one card in place', () => {
  const box = fullStackBox(240);

  it('slides the cards below it down by what the face does not already show', () => {
    const metrics = stackMetrics(4, box);
    const open = openedStack(metrics, box, 4, 1);
    expect(open.push).toBe(box.faceHeight - metrics.pitch);
    expect(open.height).toBe(metrics.height + open.push);
  });

  it('moves nothing when nothing is open', () => {
    const metrics = stackMetrics(4, box);
    expect(openedStack(metrics, box, 4, null)).toEqual({
      push: 0,
      height: metrics.height,
      clipped: metrics.clipped,
    });
  });

  it('costs nothing to open the bottom card, which is whole already', () => {
    const metrics = stackMetrics(4, box);
    expect(openedStack(metrics, box, 4, 3).push).toBe(0);
    expect(openedStack(metrics, box, 1, 0).push).toBe(0);
  });

  it('ignores an index that is not a strip of this column', () => {
    const metrics = stackMetrics(4, box);
    expect(openedStack(metrics, box, 4, -1).push).toBe(0);
    expect(openedStack(metrics, box, 4, 9).push).toBe(0);
  });

  it('reports the column clipped once the open card runs past the box', () => {
    const roomy: StackBox = { ...box, boxHeight: box.faceHeight * 2 };
    const metrics = stackMetrics(3, roomy);
    expect(metrics.clipped).toBe(false);
    expect(openedStack(metrics, roomy, 3, 0).clipped).toBe(true);
  });
});
