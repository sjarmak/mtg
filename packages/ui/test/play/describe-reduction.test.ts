/**
 * The launcher saying out loud that the set it is about to open is a reduced
 * one, and which cards are not in it.
 *
 * A reduced M11 once printed about half of the printing's 249 collector
 * positions (the shipped builds now keep all of them, and the launcher says so),
 * and the missing half was not a random half. A person who deals a pool from a
 * partial build and cannot find Llanowar Elves has to be able to learn from the
 * launcher whether the card was refused, and by what — the alternative is a set that looks like a
 * broken M11 rather than a working reduction. So the test that matters here is
 * that a refused card's name and reason survive to stdout, not that a count does.
 *
 * The reader is structural on purpose: `@mtg/ui` does not depend on `@mtg/data`,
 * so these fixtures are the JSON shape rather than the schema's type, which is
 * also what a stale file on disk would look like.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BASIC_LAND_TYPES, basicLand } from '@mtg/dsl';
import {
  REDUCTION_DROPS_SHOWN,
  describeReduction,
  describeSetReduction,
  readDealtCollation,
  readSetReduction,
} from '../../tools/describe-reduction';
import type { ResolvedSet } from '../../tools/resolve-set';

/**
 * Real cards, because the pack sizes are now read by the reader that deals the
 * pack and that reader checks every sheet against the card list beside it. A
 * sheet naming ids nothing prints is refused, which is the right answer and not
 * the one these fixtures are about. `tideglass-reach` prints 68 commons and no
 * basic land, so the five basics are added here: they are what
 * `withoutBasicLands` takes back out, and without them there is no fourteen.
 */
const CARDS: readonly unknown[] = (
  JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        '..',
        'setgen',
        'fixtures',
        'sets',
        'tideglass-reach.set.json',
      ),
      'utf8',
    ),
  ) as { readonly cards: readonly unknown[] }
).cards;

const BASICS = BASIC_LAND_TYPES.map((type, index) => basicLand(type, 'TDG', 900 + index));
const COMMON_IDS = CARDS.filter(
  (card): card is { id: string; rarity: string } =>
    typeof card === 'object' && card !== null && (card as { rarity?: unknown }).rarity === 'common',
).map((card) => card.id);

function weights(ids: readonly string[]): Record<string, number> {
  return Object.fromEntries(ids.map((id) => [id, 1]));
}

function resolved(document: unknown): ResolvedSet {
  return {
    ok: true,
    path: '/tmp/out/reference/m11/set.json',
    what: 'the reduced M11',
    cardCount: 2,
    json: JSON.stringify(document),
  };
}

/** The block for a printing whose fifteen-card pack spends one slot on a basic. */
function landedCollation(): Record<string, unknown> {
  return {
    fillsAPack: true,
    sheets: [
      { name: 'common', sourceCards: 68, cards: COMMON_IDS.length, weights: weights(COMMON_IDS) },
      {
        name: 'basic',
        sourceCards: 20,
        cards: BASICS.length,
        weights: weights(BASICS.map((card) => card.id)),
      },
    ],
    emptiedSheets: [],
    boosters: [{ contents: { common: 14, basic: 1 }, weight: 1, packSize: 15 }],
    unfillableBoosters: 0,
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

/** The block for a printing whose pack holds no basic land at all. */
function landlessCollation(): Record<string, unknown> {
  const ids = COMMON_IDS.slice(0, 15);
  return {
    fillsAPack: true,
    sheets: [{ name: 'rareMythic', sourceCards: 68, cards: ids.length, weights: weights(ids) }],
    emptiedSheets: [],
    boosters: [
      { contents: { rareMythic: 15 }, weight: 31, packSize: 15 },
      { contents: { rareMythic: 15 }, weight: 9, packSize: 15 },
    ],
    unfillableBoosters: 0,
  };
}

function reducedDocument(drops: readonly unknown[], collation: unknown = landlessCollation()): unknown {
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
      collation,
      drops,
    },
    cards: [...CARDS, ...BASICS],
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
    expect(reduction?.sheets).toEqual([['rareMythic', 15, 68]]);
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

describe('readDealtCollation', () => {
  it('reads the pack the lab will deal, basics already out', () => {
    const dealt = readDealtCollation(resolved(reducedDocument([], landedCollation())));

    expect(dealt.kind).toBe('ready');
    if (dealt.kind !== 'ready') return;
    expect(dealt.basicLands.printedPackSizes).toEqual([15]);
    expect(dealt.basicLands.dealtPackSizes).toEqual([14]);
    expect(dealt.basicLands.droppedSheets).toEqual(['basic']);
  });

  it('is silent about a document it cannot read a card list off', () => {
    expect(readDealtCollation({ ...resolved({}), json: 'not json at all' }).kind).toBe('none');
    expect(readDealtCollation(resolved({ cards: 'not an array' })).kind).toBe('none');
    expect(readDealtCollation(resolved({ cards: [{ kind: 'not a card' }] })).kind).toBe('none');
  });
});

describe('describeReduction', () => {
  it('says nothing at all about a set that was not reduced', () => {
    expect(describeReduction(null, { kind: 'none' })).toBe('');
  });

  it('names the reduction, the sheet that lost its depth, and the cards that are gone', () => {
    const printed = describeSetReduction(
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
    );

    expect(printed).toContain('REDUCED');
    expect(printed).toContain("247 of Magic 2011's 249 collector positions");
    expect(printed).toContain('rareMythic 15/68');
    expect(printed).toContain('15-card packs still fill, and the lab deals them from these sheets.');
    // Both refusal codes are tallied, and the named card is printed with its reason.
    expect(printed).toContain('NONEXACT_EVIDENCE 1');
    expect(printed).toContain('MISSING_POSITION 1');
    expect(printed).toContain('#191 Llanowar Elves (common, G): the translation approximated');
    // And the launcher says where the rest of the record is.
    expect(printed).toContain('reduction.drops');
  });

  it('calls a build that refused nothing complete, and still says what its packs hold', () => {
    const printed = describeSetReduction(resolved(reducedDocument([])));

    expect(printed).toContain('This is a complete build of Magic 2011: all 249 collector positions');
    expect(printed).toContain('15-card packs still fill, and the lab deals them from these sheets.');
    expect(printed).not.toContain('REDUCED');
    expect(printed).not.toContain('refused');
  });

  it('prints a bounded sample and says how many it did not print', () => {
    const drops = Array.from({ length: REDUCTION_DROPS_SHOWN + 5 }, (_unused, index) =>
      drop(index + 1, `Refused Card ${String(index + 1)}`),
    );
    const printed = describeSetReduction(resolved(reducedDocument(drops)));

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

    const printed = describeSetReduction(resolved(document));

    expect(printed).toContain('carries no booster configuration, so the lab deals its own');
    expect(printed).not.toContain('15-card packs');
  });

  /**
   * `mtg-1wk9`. The launcher printed the printing's fifteen and claimed the lab
   * dealt it, while the page above the same packs said fourteen. Both numbers
   * now, and the dealt one comes from the reader that deals it.
   */
  it('prints the dealt pack size beside the printed one when a basic slot is taken out', () => {
    const printed = describeSetReduction(resolved(reducedDocument([], landedCollation())));

    expect(printed).toContain(
      '15-card packs still fill, and the lab deals them from these sheets at 14, without the basic lands.',
    );
  });

  it('keeps the one-number sentence for a printing whose packs hold no basic', () => {
    const printed = describeSetReduction(resolved(reducedDocument([])));

    expect(printed).toContain('15-card packs still fill, and the lab deals them from these sheets.');
    expect(printed).not.toContain('without the basic lands');
  });

  // A stale `set.json` beside a fresh collation is the failure this repository
  // keeps meeting, and the route already prints the reader's own message above
  // the pool it dealt instead. Stdout says the same thing rather than repeating
  // a claim about sheets nothing will deal from.
  it('says the lab cannot deal a collation naming cards the set does not print', () => {
    const stale = landlessCollation() as { sheets: { weights: Record<string, number> }[] };
    // Fifteen of them, so the slot is still shallower than its sheet and what
    // the reader refuses is the ids rather than the depth.
    stale.sheets[0]!.weights = Object.fromEntries(
      Array.from({ length: 15 }, (_unused, index) => [`m11-not-a-card-${String(index)}`, 1]),
    );

    const printed = describeSetReduction(resolved(reducedDocument([], stale)));

    expect(printed).toContain('15-card packs still fill, but the lab cannot deal them:');
    expect(printed).not.toContain('deals them from these sheets');
  });

  it('says plainly when the reduced pool cannot fill a pack', () => {
    const document = reducedDocument([drop(1, 'Ajani Goldmane')]) as {
      reduction: { collation: { fillsAPack: boolean } };
    };
    document.reduction.collation.fillsAPack = false;

    expect(describeSetReduction(resolved(document))).toContain('No pack configuration fills.');
  });
});
