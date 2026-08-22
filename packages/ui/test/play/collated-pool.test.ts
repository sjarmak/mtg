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
import { parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { readStagedCollation } from '../../src/lab/staged-collation';
import { COLLATION_UNUSABLE_TITLE, PlayRoute } from '../../src/routes/PlayRoute';
import type { PlaySetState } from '../../src/routes/PlayRoute';
import { SEALED_POOL_LABEL } from '../../src/routes/play/SealedBuilder';
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
  return renderToStaticMarkup(h(PlayRoute, { set: state, seed: 'collated/route' }));
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
    expect(markup).toContain(COLLATION_UNUSABLE_TITLE);
    expect(markup).toContain('tdg-nope');
    expect(markup).toContain(SEALED_POOL_LABEL);
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
      expect(markup).toContain(SEALED_POOL_LABEL);
    }
  });
});
