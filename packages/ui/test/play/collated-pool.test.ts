/**
 * A staged set that carries its printing's collation is dealt from it.
 *
 * `npm run reference:reduced` writes a set document whose `reduction.collation`
 * holds the reweighted sheets and the booster configurations that still fill.
 * Without a reader for it the lab dealt `@mtg/deckbuild`'s rarity recipe — nine
 * commons, three uncommons, a rare — at every set it was ever handed, so a
 * reduced M11 opened thirteen cards with no basic and no foil slot, which is not
 * a pack M11 has ever printed.
 *
 * The document here is synthetic and its sheets are cut from a committed
 * fixture's own card ids, because what these tests check is the wire from the
 * staged JSON to the dealt pool. Whether a real M11 reduces to sheets that fill
 * is checked where those sheets are produced.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { basicLand, BASIC_LAND_TYPES, parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { readStagedCollation } from '../../src/lab/staged-collation';
import { COLLATION_UNUSABLE_TITLE, PlayRoute } from '../../src/routes/PlayRoute';
import type { PlaySetState } from '../../src/routes/PlayRoute';
import { PLAY_GENERATE_LABEL } from '../../src/routes/play/SealedChooser';
import { openSealed } from '../../src/routes/play/sealed';

const SET_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'setgen',
  'fixtures',
  'sets',
  'tideglass-reach.set.json',
);

const RAW = JSON.parse(readFileSync(SET_FIXTURE, 'utf8')) as { readonly cards: readonly unknown[] };
const SET: readonly Card[] = RAW.cards.map((card) => parseCard(card));
const idsOf = (rarity: string): readonly string[] =>
  SET.filter((card) => card.rarity === rarity).map((card) => card.id);

function weights(cardIds: readonly string[]): Record<string, number> {
  return Object.fromEntries(cardIds.map((id) => [id, 1]));
}

/** Two configurations of eleven cards, one of which deals the thin sheet. */
function collationBlock(): Record<string, unknown> {
  const commons = idsOf('common');
  const uncommons = idsOf('uncommon');
  return {
    fillsAPack: true,
    sheets: [
      { name: 'common', sourceCards: commons.length, cards: commons.length, weights: weights(commons) },
      {
        name: 'uncommon',
        sourceCards: uncommons.length,
        cards: uncommons.length,
        weights: weights(uncommons),
      },
      { name: 'thin', sourceCards: 30, cards: 2, weights: weights(commons.slice(0, 2)) },
    ],
    emptiedSheets: [],
    boosters: [
      { contents: { common: 8, uncommon: 3 }, weight: 3, packSize: 11 },
      { contents: { common: 7, uncommon: 3, thin: 1 }, weight: 1, packSize: 11 },
    ],
    unfillableBoosters: 0,
    slotFindings: [],
  };
}

function document(collation: unknown): unknown {
  return {
    formatVersion: 1,
    kind: 'position-reduced-reference-set-document',
    set: { code: 'TDG', name: 'Tideglass Reach (reduced)', reduced: true },
    reduction: { kept: SET.length, dropped: 3, collation },
    cards: RAW.cards,
  };
}

describe('reading the staged collation', () => {
  it('accepts a document whose sheets name cards this set prints', () => {
    const read = readStagedCollation(document(collationBlock()), SET);

    expect(read.kind).toBe('ready');
    if (read.kind !== 'ready') return;
    expect(read.collation.sheets.map((sheet) => sheet.name)).toEqual(['common', 'uncommon', 'thin']);
    expect(read.collation.boosters.map((booster) => booster.weight)).toEqual([3, 1]);
  });

  // The state every ordinary set is in, and the whole of what this change does
  // to one: nothing. `@mtg/setgen`'s own fixture carries no reduction block.
  it('reads no collation off an ordinary generated set, so it deals as it always did', () => {
    expect(readStagedCollation(RAW, SET).kind).toBe('none');
    expect(readStagedCollation({ cards: [], reduction: {} }, SET).kind).toBe('none');
    expect(readStagedCollation(null, SET).kind).toBe('none');
  });

  it('refuses a sheet naming a card this set does not print, and says which', () => {
    const stale = collationBlock();
    stale['sheets'] = [{ name: 'common', sourceCards: 1, cards: 1, weights: { 'tdg-nope': 1 } }];
    stale['boosters'] = [{ contents: { common: 1 }, weight: 1, packSize: 1 }];

    const read = readStagedCollation(document(stale), SET);

    expect(read.kind).toBe('unusable');
    if (read.kind !== 'unusable') return;
    expect(read.message).toContain('tdg-nope');
  });

  it('refuses a collation block that carries no booster configuration', () => {
    const empty = collationBlock();
    empty['boosters'] = [];

    expect(readStagedCollation(document(empty), SET).kind).toBe('unusable');
  });

  // A document written before the collation was dealable: the block is there,
  // the sheets have no weights, and re-running the emitter is the fix.
  it('refuses a collation block from an older emitter rather than reading half of it', () => {
    const older = {
      fillsAPack: true,
      sheets: [{ name: 'common', sourceCards: 60, cards: 40 }],
      emptiedSheets: [],
      packSizes: [15],
      unfillableBoosters: 0,
    };

    const read = readStagedCollation(document(older), SET);

    expect(read.kind).toBe('unusable');
    if (read.kind !== 'unusable') return;
    expect(read.message).toContain('reference:reduced');
  });
});

/**
 * The same document with the printing's basic-land slot on it.
 *
 * M11's shape, in the two places a basic reaches a pack: a sheet of nothing but
 * basics that a slot draws one off, and a foil sheet that is the whole card list
 * and so deals a basic about one pack in eight.
 */
const BASICS: readonly Card[] = BASIC_LAND_TYPES.map((type, index) => basicLand(type, 'TDG', 900 + index));
const LANDED: readonly Card[] = [...SET, ...BASICS];

function landedBlock(): Record<string, unknown> {
  const block = collationBlock();
  const basicIds = BASICS.map((card) => card.id);
  block['sheets'] = [
    ...(block['sheets'] as readonly unknown[]),
    { name: 'basic', sourceCards: 5, cards: 5, weights: weights(basicIds) },
    { name: 'foil', sourceCards: 1, cards: 1, weights: weights(LANDED.map((card) => card.id)) },
  ];
  block['boosters'] = [
    { contents: { basic: 1, common: 8, uncommon: 3 }, weight: 3, packSize: 12 },
    { contents: { basic: 1, common: 7, uncommon: 3, foil: 1 }, weight: 1, packSize: 12 },
  ];
  return block;
}

function landedDocument(): unknown {
  return {
    formatVersion: 1,
    kind: 'position-reduced-reference-set-document',
    set: { code: 'TDG', name: 'Tideglass Reach (reduced)', reduced: true },
    reduction: { kept: LANDED.length, dropped: 3, collation: landedBlock() },
    cards: [...RAW.cards, ...BASICS],
  };
}

describe('the basic lands a printing collates', () => {
  it('comes back without the land slot, and without the basics on the mixed sheet', () => {
    const read = readStagedCollation(landedDocument(), LANDED);
    if (read.kind !== 'ready') throw new Error(`expected a readable collation, got ${read.kind}`);

    expect(read.basicLands.droppedSheets).toEqual(['basic']);
    expect(read.basicLands.thinnedSheets).toEqual(['foil']);
    expect(read.collation.sheets.map((sheet) => sheet.name)).not.toContain('basic');
    expect(read.basicLands.printedPackSizes).toEqual([12]);
    expect(read.basicLands.dealtPackSizes).toEqual([11]);
  });

  it('deals a pool with no basic land in it', () => {
    const read = readStagedCollation(landedDocument(), LANDED);
    if (read.kind !== 'ready') throw new Error(`expected a readable collation, got ${read.kind}`);

    const build = openSealed(LANDED, 'collated/basics', { collation: read.collation });

    expect(build.pool).toHaveLength(66);
    expect(build.pool.filter((card) => card.kind === 'land' && card.basicLandType !== undefined)).toEqual([]);
  });

  it('names the basic lands when taking them off is what left nothing to deal', () => {
    const block = landedBlock();
    block['boosters'] = [{ contents: { basic: 1 }, weight: 1, packSize: 1 }];

    const read = readStagedCollation(
      { ...(landedDocument() as Record<string, unknown>), reduction: { collation: block } },
      LANDED,
    );

    expect(read.kind).toBe('unusable');
    if (read.kind !== 'unusable') return;
    expect(read.message).toContain('basic lands');
  });

  // `mtg-i0pc`. A slot deeper than its own sheet is the other way to deal
  // nothing, and this document holds no basic land at all, so a sentence about
  // basic lands sends the reader looking for a land slot that was never here.
  it('blames the sheet depth, not the basics, on a document that prints no basic', () => {
    const shallow = collationBlock();
    shallow['boosters'] = [{ contents: { thin: 15 }, weight: 1, packSize: 15 }];

    const read = readStagedCollation(document(shallow), SET);

    expect(read.kind).toBe('unusable');
    if (read.kind !== 'unusable') return;
    expect(read.message).not.toContain('basic');
    expect(read.message).toContain('more cards off a sheet than the sheet holds');
  });

  // The route says nothing about it, which is `mtg-rgc.20` and a reversal.
  // `mtg-5of3`'s claim was that a surface printing twelve while dealing eleven
  // is the failure this repository keeps meeting, and the answer was a note
  // above the pool; the note grew to eight sentences and the playtester read it above
  // a table. The claim is settled the other way now: the page states no pack
  // size at all, so there is no number on it for the deal to disagree with, and
  // the two sizes are printed by the launcher that staged the document.
  it('deals the shrunken pack without a word about it, and still opens a pool', () => {
    const markup = markupFor({
      status: 'ready',
      cards: LANDED,
      collation: readStagedCollation(landedDocument(), LANDED),
    });

    expect(markup).not.toContain('dealt without basic lands');
    expect(markup).not.toContain('Packs hold');
    expect(markup).not.toContain(COLLATION_UNUSABLE_TITLE);
    // The chooser is what is left, alone at the top of the page, which is the
    // point of taking the note off it.
    expect(markup).toContain('Generate sealed pool');
  });
});

describe('opening a pool from a staged collation', () => {
  it('deals the configurations packs rather than the rarity recipe', () => {
    const read = readStagedCollation(document(collationBlock()), SET);
    if (read.kind !== 'ready') throw new Error(`expected a readable collation, got ${read.kind}`);

    const build = openSealed(SET, 'collated/lab', { collation: read.collation });

    // Six packs of eleven, where the rarity recipe would have dealt twelve.
    expect(build.pool).toHaveLength(66);
    const uncommons = build.pool.filter((card) => card.rarity === 'uncommon');
    expect(uncommons).toHaveLength(18);
  });

  it('deals the rarity recipe when the set carries no collation, exactly as before', () => {
    expect(openSealed(SET, 'collated/lab').pool).toHaveLength(72);
  });
});

/**
 * The route, rendered to markup rather than to a DOM: nothing here clicks, and
 * the two facts under test are both present in the first paint — whether the
 * note is drawn, and whether the builder is drawn under it.
 */
function markupFor(state: PlaySetState): string {
  return renderToStaticMarkup(h(PlayRoute, { sub: 'sealed', set: state, seed: 'collated/route' }));
}

describe('the play route on a set that collates its own packs', () => {
  it('says a collation it cannot deal out loud, and still deals a pool', () => {
    const stale = collationBlock();
    stale['sheets'] = [{ name: 'common', sourceCards: 1, cards: 1, weights: { 'tdg-nope': 1 } }];
    stale['boosters'] = [{ contents: { common: 1 }, weight: 1, packSize: 1 }];
    const read = readStagedCollation(document(stale), SET);

    const markup = markupFor({ status: 'ready', cards: SET, collation: read });

    // Both halves matter. Silence would hand somebody who staged a printing the
    // lab's own packs with nothing to read; refusing to deal at all would take a
    // playable set away over a block the pool does not need.
    //
    // "Still deals a pool" is now read off the offer rather than off a dealt
    // pool: `mtg-tewc.5` made Play a chooser, so what a set that can be dealt
    // draws is the button that deals it.
    expect(markup).toContain(COLLATION_UNUSABLE_TITLE);
    expect(markup).toContain('tdg-nope');
    expect(markup).toContain(PLAY_GENERATE_LABEL);
  });

  it('draws no note at all for the collation it dealt, or for a set with none', () => {
    const dealt = markupFor({
      status: 'ready',
      cards: SET,
      collation: readStagedCollation(document(collationBlock()), SET),
    });
    const ordinary = markupFor({ status: 'ready', cards: SET });

    for (const markup of [dealt, ordinary]) {
      expect(markup).not.toContain(COLLATION_UNUSABLE_TITLE);
      expect(markup).toContain(PLAY_GENERATE_LABEL);
    }
  });
});
