/**
 * One physical singleton cube, dealt once rather than sampled pack by pack.
 *
 * A printed cube does not have DSL rarities or generated-card ratings. Its
 * invariants are physical instead: one stable id per card, one shuffle, and no
 * card in two packs. The scorer is deliberately supplied by the caller so the
 * draft loop neither knows nor guesses what a printed card does.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PhysicalCubeCard, PhysicalCubeDraftProgress, PhysicalCubeDraftResult } from '@mtg/draft-export';
import { DraftError, runPhysicalCubeDraft } from '@mtg/draft-export';

interface FixtureCard {
  readonly ordinal: number;
  readonly label: string;
}

const CUBE: readonly PhysicalCubeCard<FixtureCard>[] = Array.from({ length: 600 }, (_unused, ordinal) => ({
  physicalId: `legacy-${String(ordinal).padStart(3, '0')}`,
  payload: { ordinal, label: `Card ${String(ordinal)}` },
}));

const score = ({ card }: { readonly card: PhysicalCubeCard<FixtureCard> }): number => card.payload.ordinal;

function completed(seed: string): PhysicalCubeDraftResult<FixtureCard> {
  const progress = runPhysicalCubeDraft(CUBE, { seed, score });
  if (progress.result === null) throw new Error('an all-bot cube draft paused');
  return progress.result;
}

function draftedIds(result: PhysicalCubeDraftResult<FixtureCard>): readonly string[] {
  return result.seats.flatMap((seat) => seat.picks.map((pick) => pick.card.physicalId));
}

function packPicks(result: PhysicalCubeDraftResult<FixtureCard>, round: number, openedBy: string) {
  return result.seats
    .flatMap((seat) => seat.picks)
    .filter((pick) => pick.round === round && pick.openedBy === openedBy)
    .sort((left, right) => left.pickNumber - right.pickNumber);
}

describe('a physical singleton cube draft', () => {
  const result = completed('legacy-cube/default');

  it('deals 8 seats three 15-card packs from 600 physical cards and carries the remainder', () => {
    expect(result.seats.map((seat) => seat.seatId)).toEqual([
      'seat-1',
      'seat-2',
      'seat-3',
      'seat-4',
      'seat-5',
      'seat-6',
      'seat-7',
      'seat-8',
    ]);
    expect(result.rounds).toBe(3);
    expect(result.packSize).toBe(15);
    expect(result.packs).toHaveLength(8 * 3);
    expect(result.packs.every((pack) => pack.cards.length === 15)).toBe(true);
    expect(result.undealt).toHaveLength(240);
    for (const seat of result.seats) {
      expect(seat.picks).toHaveLength(45);
      expect(seat.picks.filter((pick) => pick.round === 1)).toHaveLength(15);
      expect(seat.picks.filter((pick) => pick.round === 2)).toHaveLength(15);
      expect(seat.picks.filter((pick) => pick.round === 3)).toHaveLength(15);
    }
  });

  it('uses every dealt physical id exactly once and never also calls it undealt', () => {
    const drafted = draftedIds(result);
    const packed = result.packs.flatMap((pack) => pack.cards.map((card) => card.physicalId));
    const undealt = result.undealt.map((card) => card.physicalId);

    expect(drafted).toHaveLength(360);
    expect(new Set(drafted).size).toBe(360);
    expect(new Set(packed).size).toBe(360);
    expect(new Set(drafted)).toEqual(new Set(packed));
    expect(new Set([...drafted, ...undealt]).size).toBe(600);
  });

  it('passes left, then right, then left around the string-identified seats', () => {
    expect(result.directions).toEqual([1, -1, 1]);
    const seatIds = result.seats.map((seat) => seat.seatId);
    for (const [roundIndex, direction] of [1, -1, 1].entries()) {
      const round = roundIndex + 1;
      for (const [openerIndex, opener] of seatIds.entries()) {
        expect(packPicks(result, round, opener).map((pick) => pick.seatId)).toEqual(
          Array.from(
            { length: 15 },
            (_unused, step) =>
              seatIds[(openerIndex + step * direction + seatIds.length * 15) % seatIds.length],
          ),
        );
      }
    }
  });

  it('uses the caller score and a stable pack-order tie break without another random draw', () => {
    for (const pack of result.packs) {
      const first = packPicks(result, pack.round, pack.openedBy)[0];
      expect(first?.card.payload.ordinal).toBe(Math.max(...pack.cards.map((card) => card.payload.ordinal)));
    }

    const flatScore = (): number => 0;
    const draft = runPhysicalCubeDraft(CUBE, { seed: 'legacy-cube/ties', score: flatScore }).result;
    if (draft === null) throw new Error('an all-bot cube draft paused');

    expect(draft.packs).toEqual(completed('legacy-cube/ties').packs);
    for (const pack of draft.packs) {
      const first = packPicks(draft, pack.round, pack.openedBy)[0];
      expect(first?.card.physicalId).toBe(pack.cards[0]?.physicalId);
    }
  });
});

describe('physical cube replay', () => {
  it('reproduces a byte-identical result at one seed', () => {
    const first = completed('legacy-cube/repeat');
    const second = completed('legacy-cube/repeat');
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('changes the one shuffled deal at another seed', () => {
    const deal = (seed: string): string =>
      completed(seed)
        .packs.flatMap((pack) => pack.cards.map((card) => card.physicalId))
        .join(',');
    expect(deal('legacy-cube/one')).not.toBe(deal('legacy-cube/two'));
  });

  it('pauses and resumes a human by backend-neutral seat id', () => {
    const seatIds = ['bot/north', 'browser:alice', 'bot/south', 'bot/west'];
    const first = runPhysicalCubeDraft(CUBE, {
      seed: 'legacy-cube/human',
      seatIds,
      rounds: 1,
      humanSeatIds: ['browser:alice'],
      score,
    });

    expect(first.result).toBeNull();
    expect(first.owed.map((choice) => choice.seatId)).toEqual(['browser:alice']);
    expect(first.owed[0]?.round).toBe(1);
    expect(first.owed[0]?.pickNumber).toBe(1);
    const chosen = first.owed[0]?.cards.at(-1);
    if (chosen === undefined) throw new Error('the human pack was empty');

    const resumed = runPhysicalCubeDraft(CUBE, {
      seed: first.seed,
      seatIds,
      rounds: 1,
      humanSeatIds: ['browser:alice'],
      picks: { 'browser:alice': [chosen.physicalId] },
      score,
    });

    expect(resumed.seats.find((seat) => seat.seatId === 'browser:alice')?.picks[0]?.card).toEqual(chosen);
    expect(resumed.owed[0]?.seatId).toBe('browser:alice');
    expect(resumed.owed[0]?.pickNumber).toBe(2);
    expect(resumed.owed[0]?.openedBy).not.toBe(first.owed[0]?.openedBy);
  });

  it('waits for every human at one pick without charging an answered seat twice', () => {
    const options = {
      seed: 'legacy-cube/two-humans',
      seatIds: ['browser:alice', 'bot/east', 'browser:bob', 'bot/west'],
      rounds: 1,
      packSize: 2,
      humanSeatIds: ['browser:alice', 'browser:bob'],
      score,
    } as const;
    const first = runPhysicalCubeDraft(CUBE, options);
    const alice = first.owed.find((choice) => choice.seatId === 'browser:alice')?.cards[0];
    const bob = first.owed.find((choice) => choice.seatId === 'browser:bob')?.cards[0];
    if (alice === undefined || bob === undefined) throw new Error('both humans must receive an opening pack');

    const waiting = runPhysicalCubeDraft(CUBE, {
      ...options,
      picks: { 'browser:alice': [alice.physicalId] },
    });
    expect(waiting.owed.map((choice) => choice.seatId)).toEqual(['browser:bob']);
    expect(waiting.seats.find((seat) => seat.seatId === 'browser:alice')?.picks).toHaveLength(1);
    expect(waiting.seats.find((seat) => seat.seatId === 'browser:bob')?.picks).toHaveLength(0);

    const advanced = runPhysicalCubeDraft(CUBE, {
      ...options,
      picks: {
        'browser:alice': [alice.physicalId],
        'browser:bob': [bob.physicalId],
      },
    });
    expect(advanced.owed.map((choice) => [choice.seatId, choice.pickNumber])).toEqual([
      ['browser:alice', 2],
      ['browser:bob', 2],
    ]);
    expect(advanced.seats.find((seat) => seat.seatId === 'browser:alice')?.picks).toHaveLength(1);
    expect(advanced.seats.find((seat) => seat.seatId === 'browser:bob')?.picks).toHaveLength(1);
  });

  it('refuses a human choice outside the pack in front of that id', () => {
    const first = runPhysicalCubeDraft(CUBE, {
      seed: 'legacy-cube/bad-human',
      humanSeatIds: ['seat-1'],
      score,
    });
    const held = new Set(first.owed[0]?.cards.map((card) => card.physicalId));
    const elsewhere = CUBE.find((card) => !held.has(card.physicalId));
    if (elsewhere === undefined) throw new Error('the whole cube was in one pack');

    expect(() =>
      runPhysicalCubeDraft(CUBE, {
        seed: first.seed,
        humanSeatIds: ['seat-1'],
        picks: { 'seat-1': [elsewhere.physicalId] },
        score,
      }),
    ).toThrow(/seat-1.*pick 1.*not in round 1, pick 1/i);
  });

  it('returns a progress document with the undealt tail even while paused', () => {
    const paused: PhysicalCubeDraftProgress<FixtureCard> = runPhysicalCubeDraft(CUBE, {
      humanSeatIds: ['seat-1'],
      score,
    });
    expect(paused.undealt).toHaveLength(240);
  });

  it('refuses logged choices after every physical pack is exhausted', () => {
    const first = runPhysicalCubeDraft(CUBE, {
      seed: 'legacy-cube/extra-human-pick',
      seatIds: ['browser:alice', 'bot/east'],
      rounds: 1,
      packSize: 1,
      humanSeatIds: ['browser:alice'],
      score,
    });
    const only = first.owed[0]?.cards[0];
    if (only === undefined) throw new Error('the human opening pack was empty');

    expect(() =>
      runPhysicalCubeDraft(CUBE, {
        seed: first.seed,
        seatIds: ['browser:alice', 'bot/east'],
        rounds: 1,
        packSize: 1,
        humanSeatIds: ['browser:alice'],
        picks: { 'browser:alice': [only.physicalId, only.physicalId] },
        score,
      }),
    ).toThrow(/browser:alice.*1 extra entry after the draft finished/i);
  });
});

describe('physical cube input boundaries', () => {
  it('refuses duplicate physical ids before dealing', () => {
    const first = CUBE[0];
    if (first === undefined) throw new Error('the cube fixture is empty');
    const duplicate = [...CUBE.slice(0, 599), { ...first }];
    expect(() => runPhysicalCubeDraft(duplicate, { score })).toThrow(DraftError);
    expect(() => runPhysicalCubeDraft(duplicate, { score })).toThrow(/physical id.*legacy-000.*twice/i);
  });

  it('refuses a cube too small for every requested physical pack', () => {
    expect(() => runPhysicalCubeDraft(CUBE.slice(0, 359), { score })).toThrow(DraftError);
    expect(() => runPhysicalCubeDraft(CUBE.slice(0, 359), { score })).toThrow(
      /needs 360 physical cards.*holds 359/i,
    );
  });

  it('refuses every pick log whose key is not a declared human seat id', () => {
    for (const undeclared of ['seat-2', 'seat-typo']) {
      expect(() =>
        runPhysicalCubeDraft(CUBE, {
          humanSeatIds: ['seat-1'],
          picks: { [undeclared]: [] },
          score,
        }),
      ).toThrow(new RegExp(`pick log.*${undeclared}.*not a declared human seat`, 'i'));
    }
  });

  it('keeps the generic module independent of DSL cards and the card store', () => {
    const modulePath = fileURLToPath(new URL('../src/physical-cube-draft.ts', import.meta.url));
    const source = readFileSync(modulePath, 'utf8');
    expect(source).not.toContain("from '@mtg/dsl'");
    expect(source).not.toContain("from '@mtg/data'");
  });
});
