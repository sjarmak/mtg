/**
 * Two people in one pod, which is what a LAN draft is.
 *
 * `mtg-28bh`. The all-bot loop is the oracle again: feeding two seats' bot
 * transcripts back as two pick logs has to reproduce the same pod, card for
 * card, or the two-person replay is not the same draft the one-person one is.
 *
 * The claim that is only visible with a second person is **the wait**. A pod
 * takes every seat's pick before a pack moves, so a person who has picked is
 * owed nothing and a person who has not holds up the round; that is what stops
 * one player's speed from changing the pack the other one is looking at. Every
 * test below that mentions `owed` is about that.
 *
 * A two-seat pod is the LAN shape and is also the smallest one that passes, so
 * the pod sizes here are 2 and 8 rather than 8 alone.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { DraftError, runDraft, runHumanDraft, runSeatedDraft } from '@mtg/draft-export';
import type { SeatedDraftProgress } from '@mtg/draft-export';

const SET_FIXTURE = fileURLToPath(
  new URL('../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url),
);

function loadSet(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.map((card) => parseCard(card));
}

const SET = loadSet();

/** The LAN pod: two seats, both people, one pack each so a test can finish it. */
const TABLE = { seats: 2, packs: 1, humanSeats: [0, 1] } as const;

function owedBy(progress: SeatedDraftProgress, seat: number): readonly Card[] | null {
  return progress.owed.find((choice) => choice.seat === seat)?.cards ?? null;
}

/** Plays the whole draft out, each seat always taking the last card offered. */
function playOut(seed: string): Readonly<Record<number, readonly string[]>> {
  const picks: Record<number, string[]> = { 0: [], 1: [] };
  for (let guard = 0; guard < 200; guard += 1) {
    const progress = runSeatedDraft(SET, { ...TABLE, seed, picks });
    if (progress.owed.length === 0) return picks;
    for (const choice of progress.owed) {
      const card = choice.cards.at(-1);
      if (card === undefined) throw new Error('a seat was asked to pick from an empty pack');
      picks[choice.seat]?.push(card.id);
    }
  }
  throw new Error('the draft did not finish');
}

describe('a pod with two people in it', () => {
  it('asks both of them for the first pick, each from their own pack', () => {
    const draft = runSeatedDraft(SET, { ...TABLE, seed: 'seated/open' });

    expect(draft.result).toBeNull();
    expect(draft.owed.map((choice) => choice.seat)).toEqual([0, 1]);
    // Each opened their own pack, which is the pack they are looking at.
    expect(draft.owed[0]?.openedBy).toBe(0);
    expect(draft.owed[1]?.openedBy).toBe(1);
    expect(draft.owed[0]?.cards).not.toEqual(draft.owed[1]?.cards);
  });

  it('holds the round open for the seat that has not picked', () => {
    const seed = 'seated/wait';
    const first = runSeatedDraft(SET, { ...TABLE, seed });
    const mine = first.owed[0]?.cards[0]?.id ?? '';

    const waiting = runSeatedDraft(SET, { ...TABLE, seed, picks: { 0: [mine] } });

    // Seat 0 is owed nothing and seat 1 is still on pick 1, so the pack in front
    // of seat 0 has not moved: a player who is quick does not deal themselves
    // the next pack early.
    expect(waiting.owed.map((choice) => choice.seat)).toEqual([1]);
    expect(waiting.owed[0]?.pickNumber).toBe(1);
    expect(waiting.seats[0]?.picks.map((pick) => pick.card.id)).toEqual([mine]);
    expect(waiting.seats[1]?.picks).toEqual([]);
  });

  it('passes the packs once both have picked, and each sees the other one', () => {
    const seed = 'seated/pass';
    const first = runSeatedDraft(SET, { ...TABLE, seed });
    const mine = first.owed[0]?.cards[0]?.id ?? '';
    const theirs = first.owed[1]?.cards[0]?.id ?? '';

    const second = runSeatedDraft(SET, { ...TABLE, seed, picks: { 0: [mine], 1: [theirs] } });

    expect(second.owed.map((choice) => choice.seat)).toEqual([0, 1]);
    expect(second.owed[0]?.pickNumber).toBe(2);
    // Seat 0 now holds the pack seat 1 opened, one card lighter.
    expect(second.owed[0]?.openedBy).toBe(1);
    expect(second.owed[0]?.packSize).toBe((first.owed[1]?.packSize ?? 0) - 1);
    expect(owedBy(second, 0)?.some((card) => card.id === theirs)).toBe(false);
  });

  it('reproduces the all-bot pod from two pick logs, which is what a replay is', () => {
    const seed = 'seated/replay';
    const bots = runDraft(SET, { seats: 2, packs: 1, seed });
    const picks = {
      0: bots.seats[0]?.picks.map((pick) => pick.card.id) ?? [],
      1: bots.seats[1]?.picks.map((pick) => pick.card.id) ?? [],
    };

    const seated = runSeatedDraft(SET, { ...TABLE, seed, picks });

    expect(seated.owed).toEqual([]);
    expect(seated.result?.seats).toEqual(bots.seats);
  });

  it('finishes when the packs are empty, and every card is drafted once', () => {
    const seed = 'seated/finish';
    const picks = playOut(seed);
    const done = runSeatedDraft(SET, { ...TABLE, seed, picks });

    expect(done.owed).toEqual([]);
    expect(done.result).not.toBeNull();
    const drafted = done.seats.flatMap((seat) => seat.picks.map((pick) => pick.card.id));
    expect(drafted).toHaveLength((picks[0]?.length ?? 0) + (picks[1]?.length ?? 0));
    expect(new Set(drafted).size).toBe(drafted.length);
  });

  it('seats bots beside the people, so a pod need not be all human', () => {
    const draft = runSeatedDraft(SET, { seats: 8, packs: 1, humanSeats: [0, 3], seed: 'seated/mixed' });
    expect(draft.owed.map((choice) => choice.seat)).toEqual([0, 3]);
    expect(draft.seats).toHaveLength(8);
  });

  it('is the loop the one-person draft runs, rather than a second one beside it', () => {
    const seed = 'seated/facade';
    const alone = runHumanDraft(SET, { seed, seats: 2, packs: 1 });
    const seated = runSeatedDraft(SET, { seed, seats: 2, packs: 1, humanSeats: [0] });

    expect(seated.owed).toHaveLength(1);
    expect(seated.owed[0]?.cards).toEqual(alone.nextPick?.cards);
    expect(seated.owed[0]?.openedBy).toBe(alone.nextPick?.openedBy);
  });

  it('refuses a pick that is not in the pack in front of that seat', () => {
    const seed = 'seated/bad';
    const first = runSeatedDraft(SET, { ...TABLE, seed });
    // A card of the set that this seat's pack does not hold. It has to be
    // chosen rather than borrowed from the other seat: packs are drawn
    // independently from the same sheets, so a card in one is frequently in the
    // other, and the interesting refusal is about *this* pack.
    const held = new Set((owedBy(first, 0) ?? []).map((card) => card.id));
    const elsewhere = SET.find((card) => !held.has(card.id))?.id ?? '';
    expect(elsewhere).not.toBe('');
    expect(() => runSeatedDraft(SET, { ...TABLE, seed, picks: { 0: [elsewhere] } })).toThrow(DraftError);
    // And it is refused while the other seat is still owed, rather than when
    // the round finally advances: the person who sent it is there to be told.
    expect(() => runSeatedDraft(SET, { ...TABLE, seed, picks: { 0: [elsewhere] } })).toThrow(
      /not in round 1, pick 1/i,
    );
  });

  it('refuses picks after the draft has finished', () => {
    const seed = 'seated/extra';
    const picks = playOut(seed);
    const overrun = { 0: [...(picks[0] ?? []), 'extra'], 1: picks[1] ?? [] };
    expect(() => runSeatedDraft(SET, { ...TABLE, seed, picks: overrun })).toThrow(
      /pick log has 1 extra entry/i,
    );
  });

  it('bounds every seat a person claims to sit in', () => {
    expect(() => runSeatedDraft(SET, { ...TABLE, humanSeats: [0, 2] })).toThrow(/human seat/);
    expect(() => runSeatedDraft(SET, { ...TABLE, humanSeats: [-1] })).toThrow(/human seat/);
    expect(() => runSeatedDraft(SET, { ...TABLE, humanSeats: [0, 0] })).toThrow(/twice/);
  });
});
