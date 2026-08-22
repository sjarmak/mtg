/**
 * The playable document cut from a reduced reference set: what it says on its
 * face, what it carries about the cards that are not in it, and what it refuses.
 *
 * The document is the only thing a play surface sees, so every question a person
 * can ask about the reduction has to be answerable from it alone. That is why
 * the drop record is a list of positions rather than a count, and why these
 * tests read the record rather than its length.
 *
 * Same five-position fixture as `partial-executable-reference.test.ts`, from the
 * shared module, so the artifact and the document cut from it cannot disagree.
 */
import { describe, expect, it } from 'vitest';
import {
  REDUCED_REFERENCE_SET_DOCUMENT_VERSION,
  ReducedReferenceSetDocumentSchema,
  buildPartialExecutableReferenceSet,
  reducedReferenceSetDocument,
  type ReducedPositionRefusal,
} from '@mtg/data';
import { validateCards } from '@mtg/dsl';
import { SPECS, copyEvidence, corpus, evidence, withRefusedRed } from './fixtures/reduced-reference-set';

/** The identity-level reason a coverage materializer would hand down for the red common. */
const RED_REFUSAL: ReducedPositionRefusal = {
  collectorNumber: 3,
  code: 'NONEXACT_EVIDENCE',
  detail: 'the translation approximated the printed text',
  missing: ['triggeredAbility: attack triggers are not in the vocabulary'],
};

const reducedSet = (): ReturnType<typeof buildPartialExecutableReferenceSet> =>
  buildPartialExecutableReferenceSet(corpus(), withRefusedRed());

describe('reduced reference set document', () => {
  it('names itself reduced on its face, in the field a surface prints', () => {
    const document = reducedReferenceSetDocument(reducedSet(), [RED_REFUSAL]);

    expect(ReducedReferenceSetDocumentSchema.parse(document)).toEqual(document);
    expect(document.formatVersion).toBe(REDUCED_REFERENCE_SET_DOCUMENT_VERSION);
    expect(document.kind).toBe('position-reduced-reference-set-document');
    expect(document.set).toEqual({ code: 'RDC', name: 'Reduced Test Set (reduced)', reduced: true });
    // The source keeps its own name, so a reader can tell what this was cut from.
    expect(document.reduction.source.name).toBe('Reduced Test Set');
    expect(document.reduction.source.mainSetPositions).toBe(SPECS.length);
    expect([document.reduction.kept, document.reduction.dropped]).toEqual([4, 1]);
  });

  it('carries every refused position with its identity and both levels of reason', () => {
    const { reduction } = reducedReferenceSetDocument(reducedSet(), [RED_REFUSAL]);

    expect(reduction.drops).toEqual([
      {
        collectorNumber: 3,
        name: 'Ember Runner',
        rarity: 'common',
        colors: ['R'],
        code: 'NONEXACT_OUTCOME',
        reason: expect.stringContaining('untranslatable'),
        refusal: {
          code: 'NONEXACT_EVIDENCE',
          detail: 'the translation approximated the printed text',
          missing: ['triggeredAbility: attack triggers are not in the vocabulary'],
        },
      },
    ]);
  });

  it('records a drop with no identity-level reason as one, rather than leaving it out', () => {
    const { reduction } = reducedReferenceSetDocument(reducedSet(), []);

    expect(reduction.drops.map((drop) => [drop.collectorNumber, drop.refusal])).toEqual([[3, null]]);
    // The position-level reason is still there: absence of the richer reason is
    // not absence of a reason.
    expect(reduction.drops[0]?.code).toBe('NONEXACT_OUTCOME');
  });

  it('keeps the census of both halves and the sheet depths that changed', () => {
    const { reduction } = reducedReferenceSetDocument(reducedSet(), [RED_REFUSAL]);

    expect(reduction.census.dropped.byColor).toEqual([{ color: 'R', positions: 1 }]);
    expect(reduction.collation).toEqual({
      fillsAPack: true,
      // Keyed by the card id this document prints, never by the printing uuid
      // it left behind, which is what lets a play surface deal from these.
      sheets: [
        { name: 'basic', sourceCards: 1, cards: 1, weights: { 'rdc-1': 1 } },
        { name: 'common', sourceCards: 2, cards: 1, weights: { 'rdc-2': 1 } },
        { name: 'rare', sourceCards: 1, cards: 1, weights: { 'rdc-5': 1 } },
        { name: 'uncommon', sourceCards: 1, cards: 1, weights: { 'rdc-4': 1 } },
      ],
      emptiedSheets: [],
      // The five-card booster no longer fits; the four-card one does, and the
      // document carries the configuration rather than only its size.
      boosters: [{ contents: { basic: 1, common: 1, uncommon: 1, rare: 1 }, weight: 1, packSize: 4 }],
      unfillableBoosters: 1,
      // The same two drops the sheet depths record, said in the terms a drafter
      // would notice. This fixture is four cards, so both fire at once: the
      // common sheet halved, and the only red card on it was the one dropped.
      slotFindings: [
        {
          kind: 'concentrated',
          sheet: 'common',
          need: 1,
          sourceCards: 2,
          cards: 1,
          sourceTotalWeight: 2,
          totalWeight: 1,
          concentration: 2,
          detail:
            'the common sheet fell from 2 distinct cards to 1 and from 2 weight to 1, so a card off ' +
            'this slot repeats 2 times as often as it did; the slot deals 1 per pack and still fills',
        },
        {
          kind: 'colorAbsent',
          sheet: 'common',
          need: 1,
          colors: ['R'],
          sourceCounts: { R: 1 },
          detail:
            'the common sheet deals no R card at all, against 1 R on the source sheet; a drafter in ' +
            'that color can never open one',
        },
      ],
    });
  });

  it('holds cards the DSL validator accepts, and drops the evidence and the source set', () => {
    const document = reducedReferenceSetDocument(reducedSet(), [RED_REFUSAL]);

    expect(validateCards(document.cards)).toEqual([]);
    expect(document.cards.map((card) => card.id)).toEqual(['rdc-1', 'rdc-2', 'rdc-4', 'rdc-5']);
    // The two heavy fields the docblock says are left behind, named here so a
    // later widening has to change a test rather than a comment.
    expect(Object.keys(document)).toEqual(['formatVersion', 'kind', 'set', 'reduction', 'cards']);
    expect(Object.keys(document)).not.toContain('coverage');
    expect(Object.keys(document)).not.toContain('sourceSet');
  });

  it('refuses a refusal for a position that was not dropped', () => {
    expect(() =>
      reducedReferenceSetDocument(reducedSet(), [{ ...RED_REFUSAL, collectorNumber: 2 }]),
    ).toThrowError(/collector position 2, which is not a dropped position/);
  });

  it('refuses a reduction that kept nothing, in words rather than as a shape error', () => {
    const input = copyEvidence();
    for (const row of input.rows) row.outcome = 'unreached';
    const nothing = buildPartialExecutableReferenceSet(corpus(), input);

    expect(() => reducedReferenceSetDocument(nothing, [])).toThrowError(/kept no collector position/);
  });

  it('is still a reduced document when nothing was dropped at all', () => {
    const whole = buildPartialExecutableReferenceSet(corpus(), evidence());
    const document = reducedReferenceSetDocument(whole, []);

    expect(document.reduction.dropped).toBe(0);
    expect(document.reduction.drops).toEqual([]);
    // Nothing was lost and it still does not claim to be the printing: the
    // discriminant is about which builder made it, not about what it lost.
    expect(document.kind).toBe('position-reduced-reference-set-document');
    expect(document.set.reduced).toBe(true);
  });
});
