/**
 * One human seat inside the deterministic pod.
 *
 * The all-bot loop is the oracle for packs, passing and bot choices. Feeding
 * seat zero's bot transcript back as the human transcript must therefore
 * reproduce the full pod, while withholding the next entry must stop on the
 * exact pack the person needs to see.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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

describe('a human seat in the pod', () => {
  it('pauses before the first simultaneous pick with the whole pack and context', () => {
    const draft = runHumanDraft(SET, { seed: 'human/pause' });

    expect(draft.result).toBeNull();
    expect(draft.nextPick?.round).toBe(1);
    expect(draft.nextPick?.pickNumber).toBe(1);
    expect(draft.nextPick?.packSize).toBe(draft.nextPick?.cards.length);
    expect(draft.nextPick?.openedBy).toBe(0);
    expect(draft.seats[0]?.picks).toEqual([]);
  });

  it('reproduces every pack and pool from seed plus a validated human pick log', () => {
    const seed = 'human/replay';
    const bot = runDraft(SET, { seed });
    const picks = bot.seats[0]?.picks.map((pick) => pick.card.id) ?? [];
    const human = runHumanDraft(SET, { seed, picks });

    expect(human.result).not.toBeNull();
    expect(human.nextPick).toBeNull();
    expect(human.result?.seats).toEqual(bot.seats);
    expect(human.seats).toEqual(bot.seats);
    expect(human.picks).toEqual(picks);
  });

  it('advances one pick at a time and shows the pack passed to the human next', () => {
    const first = runHumanDraft(SET, { seed: 'human/step' });
    const chosen = first.nextPick?.cards.at(-1);
    if (chosen === undefined) throw new Error('the first pack is empty');

    const second = runHumanDraft(SET, { seed: first.seed, picks: [chosen.id] });

    expect(second.seats[0]?.picks.map((pick) => pick.card.id)).toEqual([chosen.id]);
    expect(second.nextPick?.pickNumber).toBe(2);
    expect(second.nextPick?.packSize).toBe((first.nextPick?.packSize ?? 0) - 1);
    expect(second.nextPick?.openedBy).not.toBe(first.nextPick?.openedBy);
  });

  it('refuses a card that is not in the current pack and names the log entry', () => {
    expect(() => runHumanDraft(SET, { seed: 'human/bad', picks: ['not-in-this-pack'] })).toThrow(DraftError);
    expect(() => runHumanDraft(SET, { seed: 'human/bad', picks: ['not-in-this-pack'] })).toThrow(
      /human pick 1.*not in round 1, pick 1/i,
    );
  });

  it('refuses extra picks after the draft has finished', () => {
    const seed = 'human/extra';
    const bot = runDraft(SET, { seed });
    const picks = [...(bot.seats[0]?.picks.map((pick) => pick.card.id) ?? []), 'extra'];
    expect(() => runHumanDraft(SET, { seed, picks })).toThrow(/pick log has 1 extra entry/i);
  });

  it('bounds the human seat to the pod', () => {
    expect(() => runHumanDraft(SET, { humanSeat: -1 })).toThrow(/human seat/);
    expect(() => runHumanDraft(SET, { humanSeat: 8 })).toThrow(/human seat/);
  });
});
