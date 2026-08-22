/**
 * The launcher saying out loud that the set it is about to open is a reduced
 * one, and which cards are not in it.
 *
 * A reduced M11 prints about half of the printing's 249 collector positions and
 * the missing half is not a random half. A person who deals a pool from it and
 * cannot find Llanowar Elves has to be able to learn from the launcher whether
 * the card was refused, and by what — the alternative is a set that looks like a
 * broken M11 rather than a working reduction. So the test that matters here is
 * that a refused card's name and reason survive to stdout, not that a count does.
 *
 * The reader is structural on purpose: `@mtg/ui` does not depend on `@mtg/data`,
 * so these fixtures are the JSON shape rather than the schema's type, which is
 * also what a stale file on disk would look like.
 */
import { describe, expect, it } from 'vitest';
import { REDUCTION_DROPS_SHOWN, describeReduction, readSetReduction } from '../../tools/describe-reduction';
import type { ResolvedSet } from '../../tools/resolve-set';

function resolved(document: unknown): ResolvedSet {
  return {
    ok: true,
    path: '/tmp/out/reference/m11/set.json',
    what: 'the reduced M11',
    cardCount: 2,
    json: JSON.stringify(document),
  };
}

function drop(collectorNumber: number, name: string, refusal: unknown = null): unknown {
  return {
    collectorNumber,
    name,
    rarity: 'common',
    colors: ['G'],
    code: 'MISSING_POSITION',
    reason: `Executable reference MISSING_POSITION: M11 collector position ${String(collectorNumber)} has no coverage row`,
    refusal,
  };
}

/** A sheet's card-to-weight map, as deep as the sheet says it is. */
function sheetWeights(code: string, cards: number): Record<string, number> {
  return Object.fromEntries(Array.from({ length: cards }, (_, index) => [`${code}-${String(index + 1)}`, 1]));
}

function reducedDocument(drops: readonly unknown[]): unknown {
  return {
    formatVersion: 1,
    kind: 'position-reduced-reference-set-document',
    set: { code: 'M11', name: 'Magic 2011 (reduced)', reduced: true },
    reduction: {
      source: {
        code: 'M11',
        name: 'Magic 2011',
        releaseDate: '2010-07-15',
        sourceSha256: 'a'.repeat(64),
        mainSetPositions: 249,
      },
      kept: 249 - drops.length,
      dropped: drops.length,
      census: {
        kept: { positions: 249 - drops.length, byRarity: [{ rarity: 'common', positions: 82 }], byColor: [] },
        dropped: { positions: drops.length, byRarity: [{ rarity: 'rare', positions: 43 }], byColor: [] },
      },
      collation: {
        fillsAPack: true,
        sheets: [{ name: 'rareMythic', sourceCards: 68, cards: 13, weights: sheetWeights('m11', 13) }],
        emptiedSheets: [],
        boosters: [
          { contents: { rareMythic: 1 }, weight: 31, packSize: 15 },
          { contents: { rareMythic: 1 }, weight: 9, packSize: 15 },
        ],
        unfillableBoosters: 0,
      },
      drops,
    },
    cards: [],
  };
}

describe('readSetReduction', () => {
  it('reads the record off a reduced document', () => {
    const reduction = readSetReduction(
      resolved(
        reducedDocument([
          drop(191, 'Llanowar Elves', {
            code: 'NONEXACT_EVIDENCE',
            detail: 'the translation approximated the printed text',
            missing: ['activationCost: tap for mana of any one color'],
          }),
        ]),
      ),
    );

    expect(reduction).not.toBeNull();
    expect(reduction?.sourceName).toBe('Magic 2011');
    expect(reduction?.sourcePositions).toBe(249);
    expect([reduction?.kept, reduction?.dropped]).toEqual([248, 1]);
    expect(reduction?.sheets).toEqual([['rareMythic', 13, 68]]);
    expect(reduction?.fillsAPack).toBe(true);
    // The identity-level refusal wins over the position-level one, and its named
    // vocabulary gaps come with it.
    expect(reduction?.drops[0]).toEqual({
      collectorNumber: 191,
      name: 'Llanowar Elves',
      rarity: 'common',
      colors: ['G'],
      code: 'NONEXACT_EVIDENCE',
      detail: 'the translation approximated the printed text (activationCost: tap for mana of any one color)',
    });
  });

  it('falls back to the position-level reason when no identity-level one was recorded', () => {
    const reduction = readSetReduction(resolved(reducedDocument([drop(1, 'Ajani Goldmane')])));

    expect(reduction?.drops[0]?.code).toBe('MISSING_POSITION');
    expect(reduction?.drops[0]?.detail).toContain('has no coverage row');
  });

  it.each([
    ['an ordinary generated set', { formatVersion: 1, set: { code: 'XMP' }, cards: [{ id: 'xmp-1' }] }],
    ['a document with no reduction block', { kind: 'position-reduced-reference-set-document' }],
    ['a reduction missing its source', { kind: 'position-reduced-reference-set-document', reduction: {} }],
  ])('reads no reduction from %s', (_what, document) => {
    expect(readSetReduction(resolved(document))).toBeNull();
  });

  it('reads no reduction from a file that is not JSON', () => {
    expect(readSetReduction({ ...resolved({}), json: 'not json at all' })).toBeNull();
  });
});

describe('describeReduction', () => {
  it('says nothing at all about a set that was not reduced', () => {
    expect(describeReduction(null)).toBe('');
  });

  it('names the reduction, the sheet that lost its depth, and the cards that are gone', () => {
    const printed = describeReduction(
      readSetReduction(
        resolved(
          reducedDocument([
            drop(191, 'Llanowar Elves', {
              code: 'NONEXACT_EVIDENCE',
              detail: 'the translation approximated the printed text',
              missing: [],
            }),
            drop(1, 'Ajani Goldmane'),
          ]),
        ),
      ),
    );

    expect(printed).toContain('REDUCED');
    expect(printed).toContain("247 of Magic 2011's 249 collector positions");
    expect(printed).toContain('rareMythic 13/68');
    expect(printed).toContain('15-card packs still fill, and the lab deals them from these sheets.');
    // Both refusal codes are tallied, and the named card is printed with its reason.
    expect(printed).toContain('NONEXACT_EVIDENCE 1');
    expect(printed).toContain('MISSING_POSITION 1');
    expect(printed).toContain('#191 Llanowar Elves (common, G): the translation approximated');
    // And the launcher says where the rest of the record is.
    expect(printed).toContain('reduction.drops');
  });

  it('prints a bounded sample and says how many it did not print', () => {
    const drops = Array.from({ length: REDUCTION_DROPS_SHOWN + 5 }, (_unused, index) =>
      drop(index + 1, `Refused Card ${String(index + 1)}`),
    );
    const printed = describeReduction(readSetReduction(resolved(reducedDocument(drops))));

    expect(printed).toContain(
      `#${String(REDUCTION_DROPS_SHOWN)} Refused Card ${String(REDUCTION_DROPS_SHOWN)}`,
    );
    expect(printed).not.toContain(`#${String(REDUCTION_DROPS_SHOWN + 1)} Refused Card`);
    expect(printed).toContain('…and 5 more.');
    expect(printed).toContain(`All ${String(drops.length)} refused positions are in the staged document`);
  });

  // A document written before the collation carried its configurations. The
  // launcher used to claim a fifteen-card pack whatever the printing collates,
  // and there is no fifteen in a block like this to claim it from.
  it('does not promise a pack size when the document names no configuration', () => {
    const document = reducedDocument([]) as {
      reduction: { collation: { boosters?: unknown } };
    };
    delete document.reduction.collation.boosters;

    const printed = describeReduction(readSetReduction(resolved(document)));

    expect(printed).toContain('carries no booster configuration, so the lab deals its own');
    expect(printed).not.toContain('15-card packs');
  });

  it('says plainly when the reduced pool cannot fill a pack', () => {
    const document = reducedDocument([drop(1, 'Ajani Goldmane')]) as {
      reduction: { collation: { fillsAPack: boolean } };
    };
    document.reduction.collation.fillsAPack = false;

    expect(describeReduction(readSetReduction(resolved(document)))).toContain('No pack configuration fills.');
  });
});
