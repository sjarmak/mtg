// @vitest-environment jsdom
/**
 * What the generated-set draft rail says about a card's rating (`mtg-9kp96.1`).
 *
 * `DraftPack` is the executable-set adapter over the shared surface, and this
 * file is about what that adapter supplies as `ratingOf`, not about the sentence
 * the surface writes around it (`rating-line.test.ts` holds that). Three claims.
 *
 * The number is `@mtg/draft-export`'s, scaled over the *whole staged set*. A
 * pack is fifteen cards and a rating is a place between the worst and best spell
 * of the set they are drafted from, so scaling over the pack on screen would
 * hand every pack its own 0 and its own 5. The card is read out of a pack whose
 * own scale would disagree with the set's, so a pack-scoped rating fails here.
 *
 * The source is named, and it is the evaluator's. ADR-0005: a score and a win
 * rate are different quantities, and no generated set has been through a bot-play
 * campaign, so the honest label is `our evaluator` and never `play data`.
 *
 * Without the staged set there is no rating line at all, which is every caller
 * of `DraftPack` that predates this bead; and a card the pool does not hold is
 * *that card* unranked, not the whole set, the fault `rating-line.test.ts`
 * exists to keep from being reported as the other one.
 */
import { createElement as h } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { isLand, parseCard } from '@mtg/dsl';
import * as draftExport from '@mtg/draft-export';
import { rateCards } from '@mtg/draft-export';
import type { HumanDraftChoice, HumanDraftProgress } from '@mtg/draft-export';
import { DraftPack, GENERATED_DRAFT_RATING_SOURCE } from '../../src/routes/draft/DraftPack';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

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

function loadSet(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.map((card) => parseCard(card));
}

const SET = loadSet();

/** No `lib: dom` in this workspace, so the shapes this file reaches for are spelled out. */
interface ElementLike {
  readonly textContent: string | null;
  readonly getAttribute: (name: string) => string | null;
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly querySelectorAll: (selector: string) => {
    readonly length: number;
    readonly [index: number]: ElementLike;
  };
}

function ratingsOf(cards: readonly Card[]): ReadonlyMap<string, number> {
  return new Map(rateCards(cards).map((entry) => [entry.card.id, entry.rating]));
}

/**
 * Two mid-ranked spells. Their rating in this pack alone would be the pack's
 * floor and ceiling; in the set they are neither, so the two scales disagree.
 */
function middleOfTheSet(): readonly [Card, Card] {
  const whole = ratingsOf(SET);
  const spells = SET.filter((card) => !isLand(card))
    .filter((card, index, all) => all.findIndex((other) => other.name === card.name) === index)
    .sort((a, b) => (whole.get(a.id) ?? 0) - (whole.get(b.id) ?? 0));
  const low = spells[Math.floor(spells.length / 3)];
  const high = spells[Math.floor((2 * spells.length) / 3)];
  if (low === undefined || high === undefined) throw new Error('the fixture has too few spells');
  return [low, high];
}

const [PACK_LOW, PACK_HIGH] = middleOfTheSet();
const PACK: readonly Card[] = [PACK_LOW, PACK_HIGH];

const NEXT: HumanDraftChoice = {
  round: 1,
  pickNumber: 1,
  packSize: PACK.length,
  openedBy: 0,
  cards: PACK,
};

const DRAFT: HumanDraftProgress = {
  seed: 'draft-generated-rating',
  humanSeat: 0,
  picks: [],
  seats: [],
  rounds: 3,
  directions: [],
  ratings: [],
  botPolicy: 'native-deck-conditioned/v1',
  nextPick: NEXT,
  result: null,
};

/** The line the rail draws under a read card, or `null` when it draws none. */
function readRatingLine(card: Card, cards: readonly Card[] | undefined): string | null {
  const { container } = render(
    h(DraftPack, {
      draft: DRAFT,
      next: NEXT,
      pool: [],
      onPick: (): void => undefined,
      onNewDraft: (): void => undefined,
      ...(cards === undefined ? {} : { cards }),
    }),
  );
  const root = container as unknown as ElementLike;
  const faces = root.querySelectorAll('.mtg-thumbs > .mtg-card');
  const face = Array.from({ length: faces.length }, (_, index) => faces[index]).find((candidate) =>
    (candidate?.getAttribute('aria-label') ?? '').includes(card.name),
  );
  if (face === undefined) throw new Error(`the pack has no face for ${card.name}`);
  fireEvent.click(face as unknown as Element);
  const line = root.querySelector('.mtg-draft__rating');
  return line === null ? null : line.textContent;
}

describe('the generated-set draft rail rates a card by its place in the whole set', () => {
  it('names the evaluator beside the number', () => {
    const rating = ratingsOf(SET).get(PACK_HIGH.id);
    if (rating === undefined) throw new Error('the set does not rate the pack card');
    expect(readRatingLine(PACK_HIGH, SET)).toBe(`${GENERATED_DRAFT_RATING_SOURCE}: ${rating.toFixed(1)}/5`);
    expect(GENERATED_DRAFT_RATING_SOURCE).toBe('our evaluator');
  });

  it('scales over the set and not over the pack on screen', () => {
    const whole = ratingsOf(SET).get(PACK_LOW.id);
    const packOnly = ratingsOf(PACK).get(PACK_LOW.id);
    if (whole === undefined || packOnly === undefined) throw new Error('a pack card went unrated');
    // The premise: read against its own pack this card would be the floor.
    expect(packOnly.toFixed(1)).not.toBe(whole.toFixed(1));

    expect(readRatingLine(PACK_LOW, SET)).toBe(`our evaluator: ${whole.toFixed(1)}/5`);
  });

  it('draws no rating line when the staged set is not supplied', () => {
    expect(readRatingLine(PACK_HIGH, undefined)).toBeNull();
  });

  it('blames the card, not the set, when the pool does not hold the card', () => {
    const line = readRatingLine(
      PACK_HIGH,
      SET.filter((card) => card.id !== PACK_HIGH.id),
    );
    expect(line).toBe('our evaluator: not ranked for this card.');
    expect(line).not.toBe('No ranking for this set.');
  });

  it('never scans the set for a rating while the switch is off', () => {
    const spy = vi.spyOn(draftExport, 'rateCards');
    localStorage.setItem('mtg.draft.ratings', 'off');
    const { container } = render(
      h(DraftPack, {
        draft: DRAFT,
        next: NEXT,
        pool: [],
        onPick: (): void => undefined,
        onNewDraft: (): void => undefined,
        cards: SET,
      }),
    );
    const root = container as unknown as ElementLike;
    const faces = root.querySelectorAll('.mtg-thumbs > .mtg-card');
    const face = Array.from({ length: faces.length }, (_, index) => faces[index]).find((candidate) =>
      (candidate?.getAttribute('aria-label') ?? '').includes(PACK_HIGH.name),
    );
    if (face === undefined) throw new Error(`the pack has no face for ${PACK_HIGH.name}`);
    fireEvent.click(face as unknown as Element);
    expect(spy).not.toHaveBeenCalled();
    expect(root.querySelector('.mtg-draft__rating')).toBeNull();
  });
});
