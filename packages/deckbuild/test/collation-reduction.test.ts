/**
 * What a reduction cost a printing's packs, read off the document that says so.
 *
 * `npm run reference:reduced` writes the block and this reads it: which sheets
 * emptied, how many booster configurations no longer fill, and the emitter's own
 * sentence for each slot that still fills and no longer deals what it dealt.
 *
 * The lab used to draw all of it above the pool -- one standing sentence and a
 * fold holding the rest -- and since `mtg-rgc.20` it draws none of it: eight
 * paragraphs of provenance above the screen you play the game on is the screen
 * spent on something nobody reads twice. The evidence did not move, it just
 * stopped being a banner: the launcher prints it on stdout and `reduced.json`
 * holds it position by position. This reader is what a surface that wants it
 * back would call, and the coverage came here with it -- it lived under
 * `@mtg/ui` while the note did.
 *
 * The document is synthetic and holds no cards, because nothing in this read
 * looks at one: the whole subject is `reduction.collation`, and a fixture set
 * would only assert that a real printing reduces this way, which is `@mtg/data`'s
 * question and not this function's.
 */
import { describe, expect, it } from 'vitest';
import { readCollationReduction } from '../src/index';

const DETAIL =
  'the rare sheet fell from 53 distinct cards to 8 and from 53 weight to 8, so a card off this slot ' +
  'repeats 6.63 times as often as it did; the slot deals 1 per pack and still fills';

function document(collation: Record<string, unknown>): unknown {
  return {
    formatVersion: 1,
    kind: 'position-reduced-reference-set-document',
    set: { code: 'TDG', name: 'Tideglass Reach (reduced)', reduced: true },
    reduction: { kept: 134, dropped: 3, collation },
    cards: [],
  };
}

describe('reading what the reduction cost the packs', () => {
  it('reads the losses off the document rather than re-deriving them', () => {
    const read = readCollationReduction(
      document({
        fillsAPack: true,
        emptiedSheets: ['foil', 'token'],
        unfillableBoosters: 2,
        slotFindings: [{ kind: 'concentrated', sheet: 'rare', detail: DETAIL }],
      }),
    );

    expect(read).toEqual({
      fillsAPack: true,
      emptiedSheets: ['foil', 'token'],
      unfillableBoosters: 2,
      slotFindings: [DETAIL],
    });
  });

  // The state every ordinary set and every clean reduction is in. A reduction
  // that cost the packs nothing has nothing to tell anybody, and a reader that
  // returned an empty record instead would make every caller test its fields.
  it('reads nothing off a set with no reduction, or one that cost its packs nothing', () => {
    expect(readCollationReduction({ formatVersion: 1, cards: [] })).toBeNull();
    expect(readCollationReduction(null)).toBeNull();
    expect(
      readCollationReduction(
        document({ fillsAPack: true, emptiedSheets: [], unfillableBoosters: 0, slotFindings: [] }),
      ),
    ).toBeNull();
  });

  it('ignores a count it cannot trust and a finding with no sentence in it', () => {
    const read = readCollationReduction(
      document({
        fillsAPack: false,
        emptiedSheets: ['common', 7],
        unfillableBoosters: -3,
        slotFindings: [{ kind: 'concentrated', sheet: 'rare' }],
      }),
    );

    expect(read).toEqual({
      fillsAPack: false,
      emptiedSheets: ['common'],
      unfillableBoosters: 0,
      slotFindings: [],
    });
  });
});
