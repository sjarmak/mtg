// @vitest-environment node
/**
 * Every land a route puts on the table is a card the set prints.
 *
 * `mtg-aqxi.9`, and the complaint it came from is a photograph: half the lands
 * on a played board drew the labeled ART PENDING frame while the Plains beside
 * them drew its illustration, for the whole game.
 *
 * The cause is one function handed two different card lists. `@mtg/dsl`'s
 * `setBasics` prefers the set's own printed Swamp and mints the canonical
 * `<code>-swamp` when the set prints none, and it is the single derivation of
 * that id — which holds only while every caller passes the same list.
 * the art pipeline's `artSurfaces` passes the *set*, so the manifest is keyed by
 * `m11-238`. `@mtg/deckbuild`'s mana base passed the *pool*, which is six
 * boosters, so whether it found a printed Swamp depended on the seed. When it
 * did not it minted `m11-swamp`, the manifest has no such key, and the renderer
 * drew a pending frame on every copy. the art pipeline's governance check reported the set
 * clean throughout, because it was asking about the other list.
 *
 * So this is a sweep and not a case: the bug is seed-dependent, and one seed
 * that happens to open a Swamp proves nothing. `SEEDS` pools are opened, built
 * and dealt, and every land id in every finished deck — the person's and the
 * seat across the table's — has to be an id the set itself accounts for.
 *
 * **The fixture prints its basics under ids that are not the minted ones**,
 * which is the whole point of it and is what a real printing looks like: M11's
 * Swamp is `m11-238`, never `m11-swamp`. A fixture whose printed basics carried
 * the canonical ids would pass this test with the bug still in place, so
 * `mintsWhatThePoolMisses` measures the fixture as well as the code and fails
 * when the sweep has stopped being able to tell the two derivations apart.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { BASIC_LAND_COLOR, BASIC_LAND_TYPES, parseCard, setBasics } from '@mtg/dsl';
import { deckFor, openSealed } from '../../src/routes/play/sealed';
import { dealSealedGame } from '../../src/routes/play/deal';

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

/**
 * The fixture set, plus the five basics it does not print, printed.
 *
 * Collector numbers after the last card and ids in the printing's own scheme,
 * so that `setBasics` over this set answers `tgr-231` and `setBasics` over a
 * pool that missed the Swamp answers `tgr-swamp`. Those two strings are the
 * entire defect.
 */
function loadSet(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  const printed = cards.map((card) => parseCard(card));
  const first = printed[0];
  if (first === undefined) throw new Error('the fixture set is empty');
  const code = first.set.code;
  const basics = BASIC_LAND_TYPES.map((type, index) =>
    parseCard({
      kind: 'land',
      id: `${code.toLowerCase()}-${String(231 + index)}`,
      name: type,
      rarity: 'common',
      set: { code, collectorNumber: 231 + index },
      supertypes: ['basic'],
      basicLandType: type,
      producesMana: [BASIC_LAND_COLOR[type]],
    }),
  );
  return [...printed, ...basics];
}

const SET = loadSet();

/**
 * What the art pipeline's `artSurfaces` accounts for: the set's own cards, and the
 * basics `setBasics` derives from the set. Restated here rather than imported
 * because `@mtg/ui` does not depend on the art pipeline and should not start to for a
 * test; the load-bearing half is the argument list, and it is the set's.
 */
const ACCOUNTED: ReadonlySet<string> = new Set([
  ...SET.map((card) => card.id),
  ...setBasics(SET).map((card) => card.id),
]);

const SEEDS = 40;

function seedAt(index: number): string {
  return `mtg-aqxi.9/sweep/${String(index)}`;
}

function landIds(deck: readonly Card[]): readonly string[] {
  return deck.filter((card) => card.kind === 'land').map((card) => card.id);
}

function unaccounted(deck: readonly Card[]): readonly string[] {
  return [...new Set(landIds(deck))].filter((id) => !ACCOUNTED.has(id));
}

describe('the mana base a route builds', () => {
  it('draws only lands the set accounts for, at every seat, across the sweep', () => {
    const bad: string[] = [];
    for (let index = 0; index < SEEDS; index += 1) {
      const seed = seedAt(index);
      const build = openSealed(SET, seed);
      const yours = deckFor(build);
      const missing = unaccounted(yours.deck);
      if (missing.length > 0) bad.push(`${seed} you: ${missing.join(', ')}`);

      const dealt = dealSealedGame(yours.deck, SET, { seed });
      const theirs = dealt.config.setup.decks[1];
      if (theirs === undefined) throw new Error(`${seed}: the deal seated no opponent`);
      const theirMissing = unaccounted(theirs.cards);
      if (theirMissing.length > 0) bad.push(`${seed} them: ${theirMissing.join(', ')}`);
    }
    expect(bad, `lands no art manifest of this set can be keyed by:\n${bad.join('\n')}`).toEqual([]);
  });

  it('is measured against a set whose pools do miss a printed basic', () => {
    let mintsWhatThePoolMisses = 0;
    for (let index = 0; index < SEEDS; index += 1) {
      const pool = openSealed(SET, seedAt(index)).pool;
      const fromPool = setBasics(pool).map((card) => card.id);
      if (fromPool.some((id) => !ACCOUNTED.has(id))) mintsWhatThePoolMisses += 1;
    }
    expect(
      mintsWhatThePoolMisses,
      'every pool in the sweep printed all five basics, so the sweep cannot tell the set from the pool',
    ).toBeGreaterThan(0);
  });
});
