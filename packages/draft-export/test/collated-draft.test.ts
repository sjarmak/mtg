/**
 * A draft dealt off a printing's own sheets rather than off DSL rarities.
 *
 * `mtg-nmqp`: the Play tab opened a staged printing's real packs and this pod
 * opened a rarity recipe, so one lab dealt two different packs from one set. The
 * claims worth pinning are the ones the recipe cannot make — the pack is the
 * size the configuration says, a weighted sheet is drawn at its weights rather
 * than evenly, and a card the collation never names is never picked — plus the
 * two facts that make it usable at all: it is still seeded, and it still refuses
 * a collation that does not describe this set.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PackCollation } from '@mtg/deckbuild';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { DraftError, runDraft, runHumanDraft } from '@mtg/draft-export';

const SET_FIXTURE = fileURLToPath(
  new URL('../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url),
);

function loadSet(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.map((card) => parseCard(card));
}

const SET = loadSet();

function idsOf(rarity: string, count: number): readonly string[] {
  return SET.filter((card) => card.rarity === rarity)
    .slice(0, count)
    .map((card) => card.id);
}

function evenWeights(ids: readonly string[]): Record<string, number> {
  return Object.fromEntries(ids.map((id) => [id, 1]));
}

const COMMONS = idsOf('common', 12);
const UNCOMMONS = idsOf('uncommon', 6);

/** Six commons and two uncommons, one configuration, every card at even odds. */
const PLAIN: PackCollation = {
  sheets: [
    { name: 'common', weights: evenWeights(COMMONS) },
    { name: 'uncommon', weights: evenWeights(UNCOMMONS) },
  ],
  boosters: [{ contents: { common: 6, uncommon: 2 }, weight: 1 }],
};

describe('a pod dealt from a collation', () => {
  it('opens the pack that configuration describes, not the rarity recipe', () => {
    const draft = runHumanDraft(SET, { seed: 'collated/size', collation: PLAIN });

    expect(draft.nextPick?.packSize).toBe(8);
  });

  it('deals only cards the collation names', () => {
    const named = new Set([...COMMONS, ...UNCOMMONS]);
    const drafted = runDraft(SET, { seed: 'collated/pool', collation: PLAIN });

    for (const seat of drafted.seats) {
      for (const pick of seat.picks) expect(named.has(pick.card.id)).toBe(true);
    }
  });

  it('draws a sheet at its own weights, which a rarity recipe cannot do', () => {
    const first = COMMONS[0];
    const rest = COMMONS.slice(1);
    if (first === undefined) throw new Error('the fixture prints no commons');
    const weighted: PackCollation = {
      sheets: [{ name: 'common', weights: { [first]: 200, ...evenWeights(rest) } }],
      boosters: [{ contents: { common: 1 }, weight: 1 }],
    };
    const drafted = runDraft(SET, { seed: 'collated/weights', collation: weighted, packs: 3 });
    const picks = drafted.seats.flatMap((seat) => seat.picks);

    // One card at 200 against eleven at 1: it is in nearly every pack, and every
    // pack is one card, so it is nearly every pick. An even sheet would put it in
    // one pick in twelve.
    const share = picks.filter((pick) => pick.card.id === first).length / picks.length;
    expect(share).toBeGreaterThan(0.8);
  });

  it('is seeded: one seed deals one pod', () => {
    const first = runDraft(SET, { seed: 'collated/same', collation: PLAIN });
    const second = runDraft(SET, { seed: 'collated/same', collation: PLAIN });

    expect(second.seats.map((seat) => seat.picks.map((pick) => pick.card.id))).toEqual(
      first.seats.map((seat) => seat.picks.map((pick) => pick.card.id)),
    );
  });

  it('refuses a collation that names a card this set does not print', () => {
    const stale: PackCollation = {
      sheets: [{ name: 'common', weights: { 'not-a-card': 1 } }],
      boosters: [{ contents: { common: 1 }, weight: 1 }],
    };

    expect(() => runDraft(SET, { seed: 'collated/stale', collation: stale })).toThrowError(DraftError);
  });

  it('refuses a recipe and a collation together rather than choosing one', () => {
    expect(() =>
      runDraft(SET, {
        seed: 'collated/both',
        collation: PLAIN,
        recipe: [{ rarity: 'common', count: 1 }],
      }),
    ).toThrowError(/not both/);
  });
});
