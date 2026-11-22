// @vitest-environment jsdom
/**
 * The printed pack reads best rated first, and a card the ranking says nothing
 * about reads after every card it does.
 *
 * The playtester, 2026-09-20: "can we have the pack view ordered by limited rating".
 * The judgments this file holds shut are the three the bead had to decide, not
 * the sort itself:
 *
 * - **No rating is last, not zero.** A rating of 0 is Forge saying the card is
 *   weak; `null` is Forge saying nothing (a Kaladesh Invention or an Amonkhet
 *   Invocation once a partial ranking is staged). Reading it as 0 would invent
 *   a rating, which ADR-0005 (§3) names as the failure.
 * - **Rarity survives as the tiebreak.** Forge's ranks tie often, and the
 *   existing order is what keeps a pack from being arbitrary inside a tie.
 * - **A format with no ranking is not an empty pack.** It draws the order it
 *   drew before, rarest first with the deal order inside a rarity.
 *
 * The pure function is tested on its own; the route is tested on Innistrad,
 * because that is a format whose draft page is already driven with a staged
 * ranking, and because the sort is only worth having if the route hands it the
 * right numbers.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { preparePrintedLimitedFormat, printedSourceFingerprint } from '@mtg/draft-export';
import type { PreparedPrintedLimitedFormat } from '@mtg/draft-export';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import { packOrderBy, packOrderByRating } from '../../src/routes/draft/pack-order';
import { PrintedDraftRatingsSchema } from '../../src/lab/printed-draft-ratings';
import type { PrintedDraftRatings } from '../../src/lab/printed-draft-ratings';
import { PRINTED_LOCAL_SEAT } from '../../src/routes/printed/printed-limited-session';
import { PrintedDraftRoute } from '../../src/routes/printed/PrintedDraftRoute';
import { writeDraftRatingsEnabled } from '../../src/routes/draft/rating-switch';

afterEach(() => {
  cleanup();
  // Leave the switch the way every other test in this file assumes it: on.
  writeDraftRatingsEnabled(true);
});

/** A dealt card for the pure tests: what it is, what Forge says, how rare it is. */
interface Dealt {
  readonly id: string;
  readonly rating: number | null;
  readonly rarity: string | null;
}

const ratingOf = (card: Dealt): number | null => card.rating;
const rarityOf = (card: Dealt): string | null => card.rarity;
const ids = (positions: readonly { readonly card: Dealt }[]): readonly string[] =>
  positions.map((position) => position.card.id);

describe('packOrderByRating', () => {
  it('reads the highest rating first', () => {
    const dealt: readonly Dealt[] = [
      { id: 'a', rating: 1.5, rarity: 'common' },
      { id: 'b', rating: 4, rarity: 'common' },
      { id: 'c', rating: 2.5, rarity: 'common' },
    ];
    expect(ids(packOrderByRating(dealt, ratingOf, rarityOf))).toEqual(['b', 'c', 'a']);
  });

  it('puts a card with no rating after every rating, including a rating of zero', () => {
    const dealt: readonly Dealt[] = [
      { id: 'unranked-mythic', rating: null, rarity: 'mythic' },
      { id: 'zero', rating: 0, rarity: 'common' },
      { id: 'best', rating: 5, rarity: 'common' },
    ];
    expect(ids(packOrderByRating(dealt, ratingOf, rarityOf))).toEqual(['best', 'zero', 'unranked-mythic']);
  });

  it('breaks a tie on rating by rarity, rarest first', () => {
    const dealt: readonly Dealt[] = [
      { id: 'common', rating: 3, rarity: 'common' },
      { id: 'mythic', rating: 3, rarity: 'mythic' },
      { id: 'uncommon', rating: 3, rarity: 'uncommon' },
    ];
    expect(ids(packOrderByRating(dealt, ratingOf, rarityOf))).toEqual(['mythic', 'uncommon', 'common']);
  });

  it('breaks a tie between unranked cards by rarity too', () => {
    const dealt: readonly Dealt[] = [
      { id: 'unranked-common', rating: null, rarity: 'common' },
      { id: 'unranked-rare', rating: null, rarity: 'rare' },
      { id: 'ranked', rating: 0.5, rarity: 'common' },
    ];
    expect(ids(packOrderByRating(dealt, ratingOf, rarityOf))).toEqual([
      'ranked',
      'unranked-rare',
      'unranked-common',
    ]);
  });

  it('keeps the deal order between cards equal in rating and in rarity', () => {
    const dealt: readonly Dealt[] = [
      { id: 'first', rating: 2, rarity: 'common' },
      { id: 'lower', rating: 1, rarity: 'common' },
      { id: 'second', rating: 2, rarity: 'common' },
      { id: 'third', rating: 2, rarity: 'common' },
    ];
    const ordered = packOrderByRating(dealt, ratingOf, rarityOf);
    expect(ids(ordered)).toEqual(['first', 'second', 'third', 'lower']);
    expect(ordered.map((position) => position.index)).toEqual([0, 2, 3, 1]);
  });

  it('draws a pack with nothing ranked exactly as the rarity order draws it', () => {
    const dealt: readonly Dealt[] = [
      { id: 'c1', rating: null, rarity: 'common' },
      { id: 'r1', rating: null, rarity: 'rare' },
      { id: 'u1', rating: null, rarity: 'uncommon' },
      { id: 'c2', rating: null, rarity: 'common' },
    ];
    const byRating = packOrderByRating(dealt, ratingOf, rarityOf);
    expect(byRating).toEqual(packOrderBy(dealt, rarityOf));
    expect(ids(byRating)).toEqual(['r1', 'u1', 'c1', 'c2']);
  });

  it('carries each card back to the position the pack dealt it in', () => {
    const dealt: readonly Dealt[] = [
      { id: 'a', rating: null, rarity: 'common' },
      { id: 'b', rating: 3, rarity: 'rare' },
      { id: 'c', rating: 4.5, rarity: 'common' },
    ];
    for (const position of packOrderByRating(dealt, ratingOf, rarityOf)) {
      expect(dealt[position.index]).toBe(position.card);
    }
  });

  it('does not move the cards that stay when the pack shrinks by a pick', () => {
    // Between picks the pack is redealt without the card that was taken. Each
    // card's place is a function of the cards' own ratings, rarities and deal
    // positions, so the survivors keep the order they were read in.
    const dealt: readonly Dealt[] = [
      { id: 'a', rating: 2, rarity: 'common' },
      { id: 'b', rating: null, rarity: 'rare' },
      { id: 'c', rating: 2, rarity: 'uncommon' },
      { id: 'd', rating: 4, rarity: 'common' },
      { id: 'e', rating: 2, rarity: 'common' },
      { id: 'f', rating: null, rarity: 'common' },
    ];
    const before = ids(packOrderByRating(dealt, ratingOf, rarityOf));
    for (const taken of dealt) {
      const remaining = dealt.filter((card) => card !== taken);
      expect(ids(packOrderByRating(remaining, ratingOf, rarityOf))).toEqual(
        before.filter((id) => id !== taken.id),
      );
    }
  });

  it('reads each rating once per card rather than once per comparison', () => {
    const dealt: readonly Dealt[] = Array.from({ length: 15 }, (_, index) => ({
      id: String(index),
      rating: (index * 7) % 6,
      rarity: 'common',
    }));
    const read = vi.fn(ratingOf);
    packOrderByRating(dealt, read, rarityOf);
    expect(read).toHaveBeenCalledTimes(dealt.length);
  });

  it('sorts a copy and leaves the pack the draft holds alone', () => {
    const dealt: readonly Dealt[] = [
      { id: 'a', rating: 1, rarity: 'common' },
      { id: 'b', rating: 5, rarity: 'common' },
    ];
    packOrderByRating(dealt, ratingOf, rarityOf);
    expect(ids(dealt.map((card) => ({ card })))).toEqual(['a', 'b']);
  });
});

describe('the printed draft pack', () => {
  let innistrad: PreparedPrintedLimitedFormat;
  let catalogSha256: string;
  let cards: ReturnType<typeof parsePrintedCardCatalog>['cards'];
  const playProps = {
    printedCards: [],
    playAvailability: { status: 'unavailable' as const, reason: 'Full Forge admission is incomplete.' },
  };
  const SEED = 'isd-pack-rating-order';

  beforeAll(async () => {
    const read = (name: string): unknown =>
      JSON.parse(readFileSync(`packages/data/data/isd/${name}`, 'utf8'));
    innistrad = await preparePrintedLimitedFormat(
      read('isd-limited-format-v1.json'),
      [read('isd-printed-catalog-v1.json')],
      async (text) => createHash('sha256').update(text).digest('hex'),
    );
    const catalog = parsePrintedCardCatalog(read('isd-printed-catalog-v1.json'));
    catalogSha256 = catalog.contentSha256;
    cards = catalog.cards;
  });

  /** The pack the route asks for at pick 1, in the order the sheets dealt it. */
  function dealtPack(): readonly { readonly physicalId: string; readonly name: string }[] {
    const opened = innistrad
      .openDraftPacks(SEED)
      .find((pack) => pack.round === 1 && pack.openedBy === PRINTED_LOCAL_SEAT);
    if (opened === undefined) throw new Error('the format opened no first pack for the local seat');
    return opened.cards.map((card) => ({
      physicalId: card.payload.printing.physicalId,
      name: card.payload.printing.name,
    }));
  }

  /**
   * A ranking that states `stated` for the printings it names, states nothing
   * (`quality: null`, the source covering the format and missing the card) for
   * the printings in `unranked`, and leaves every other card out of the
   * catalog altogether, which reads the same to the surface.
   */
  function ratingsFor(
    stated: ReadonlyMap<string, number>,
    unranked: ReadonlySet<string>,
  ): PrintedDraftRatings {
    return PrintedDraftRatingsSchema.parse({
      schemaVersion: 1,
      kind: 'printed-draft-ratings',
      source: {
        kind: 'forge-limited-rankings',
        version: 'test',
        bridgeFingerprint: 'c'.repeat(64),
        fingerprint: 'd'.repeat(64),
      },
      catalogs: [
        {
          code: 'ISD',
          catalogSha256,
          cards: cards
            .filter((card) => stated.has(card.physicalId) || unranked.has(card.physicalId))
            .map((card) => ({
              physicalId: card.physicalId,
              sourceFingerprint: printedSourceFingerprint(card),
              quality: stated.get(card.physicalId) ?? null,
            })),
        },
      ],
    });
  }

  function mount(draftRatings?: PrintedDraftRatings): void {
    render(
      h(PrintedDraftRoute, {
        prepared: innistrad,
        seed: SEED,
        onNewDraft: vi.fn(),
        ...playProps,
        ...(draftRatings === undefined ? {} : { draftRatings }),
      }),
    );
  }

  /**
   * The names on the pack's faces in the order they are drawn, read by pressing
   * each one and taking what the commit button offers. That is the reading that
   * matters: the screen and the button have to agree about which card is where.
   */
  function drawnNames(): readonly string[] {
    const pack = screen.getByRole('group', { name: /^Draft pack / });
    const faces = within(pack).getAllByRole('button');
    return faces.map((face) => {
      fireEvent.click(face);
      // No `lib: dom` in this workspace, so the one property read is spelled out.
      const commit = screen.getByRole('button', { name: /^Pick / }) as unknown as {
        readonly textContent: string | null;
      };
      return (commit.textContent ?? '').replace(/^Pick /, '');
    });
  }

  it('draws best rated first, unranked last, and keeps the dealt order inside a tie', () => {
    const dealt = dealtPack();
    // Ratings by dealt slot, chosen so the deal order is nowhere near the answer:
    // a zero and two unranked cards up front, a tie of three stated values, and
    // a printing named twice getting the one rating both copies share.
    const table: readonly (number | null)[] = [null, 0, 2, 5, 2, null, 3.5, 2, 0, 5, 1, null, 4, 2, 3];
    const stated = new Map<string, number>();
    const unranked = new Set<string>();
    dealt.forEach((card, slot) => {
      if (stated.has(card.physicalId) || unranked.has(card.physicalId)) return;
      const rating = table[slot % table.length] ?? null;
      if (rating === null) unranked.add(card.physicalId);
      else stated.set(card.physicalId, rating);
    });
    const rated = dealt.filter((card) => stated.has(card.physicalId)).length;
    expect(rated).toBeGreaterThan(3);
    expect(unranked.size).toBeGreaterThan(0);

    const expected = dealt
      .map((card, slot) => ({ name: card.name, slot, rating: stated.get(card.physicalId) ?? null }))
      .sort((left, right) => {
        if (left.rating === right.rating) return left.slot - right.slot;
        if (left.rating === null) return 1;
        if (right.rating === null) return -1;
        return right.rating - left.rating;
      })
      .map((card) => card.name);
    expect(expected).not.toEqual(dealt.map((card) => card.name));

    mount(ratingsFor(stated, unranked));
    expect(drawnNames()).toEqual(expected);
  });

  it('deals rarest-first rather than by rating once the switch is off (dec-adi1 option (a))', () => {
    const dealt = dealtPack();
    const stated = new Map<string, number>();
    const unranked = new Set<string>();
    dealt.forEach((card, slot) => {
      if (stated.has(card.physicalId) || unranked.has(card.physicalId)) return;
      // Every card gets a distinct, non-trivial rating, so a pack that still
      // read best-rated-first would draw a different order than this one.
      stated.set(card.physicalId, (slot % 5) + 1);
    });
    expect(unranked.size).toBe(0);

    writeDraftRatingsEnabled(false);
    mount(ratingsFor(stated, unranked));
    // `playProps.printedCards` is empty throughout this file, so every card
    // ties on rarity and the rarest-first order collapses to the dealt order
    // (the same shape the "no ranking" tests below assert) — the point here
    // is that a staged rating no longer moves the pack at all.
    expect(drawnNames()).toEqual(dealt.map((card) => card.name));
  });

  it('draws best rated first again once the switch is back on', () => {
    const dealt = dealtPack();
    const stated = new Map<string, number>(dealt.map((card, slot) => [card.physicalId, (slot % 5) + 1]));

    writeDraftRatingsEnabled(false);
    mount(ratingsFor(stated, new Set()));
    expect(drawnNames()).toEqual(dealt.map((card) => card.name));
    cleanup();

    writeDraftRatingsEnabled(true);
    mount(ratingsFor(stated, new Set()));
    const expected = dealt
      .map((card, slot) => ({ name: card.name, slot, rating: stated.get(card.physicalId)! }))
      .sort((left, right) =>
        left.rating === right.rating ? left.slot - right.slot : right.rating - left.rating,
      )
      .map((card) => card.name);
    expect(expected).not.toEqual(dealt.map((card) => card.name));
    expect(drawnNames()).toEqual(expected);
  });

  it('reads a card the ranking leaves out the same way as a card it ranks null', () => {
    const dealt = dealtPack();
    // Three different printings, so no two of them share a rating by being one card.
    const distinct = dealt.filter(
      (card, slot) => dealt.findIndex((other) => other.physicalId === card.physicalId) === slot,
    );
    const [first, second, third] = distinct;
    if (first === undefined || second === undefined || third === undefined)
      throw new Error('the pack is too small');
    // `first` is stated null, `second` is absent from the catalog, `third` is
    // ranked (and dealt after both); only `third` may be read before them.
    const ratings = ratingsFor(new Map([[third.physicalId, 1]]), new Set([first.physicalId]));
    mount(ratings);
    const names = drawnNames();
    expect(names[0]).toBe(third.name);
    expect(names.indexOf(first.name)).toBeGreaterThan(0);
    expect(names.indexOf(second.name)).toBeGreaterThan(0);
  });

  it('draws the dealt order for a format that stages no ranking, not an empty pack', () => {
    mount();
    expect(drawnNames()).toEqual(dealtPack().map((card) => card.name));
  });

  it('draws the dealt order when a staged ranking names none of the pack', () => {
    mount(ratingsFor(new Map(), new Set()));
    expect(drawnNames()).toEqual(dealtPack().map((card) => card.name));
  });
});
