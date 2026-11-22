import { describe, expect, it } from 'vitest';
import { DraftError, runPhysicalCubeDraft, runPhysicalPackDraft } from '@mtg/draft-export';
import type { PhysicalCubePack } from '@mtg/draft-export';

const seatIds = ['human', 'bot'];
const score = () => 0;
const packs: readonly PhysicalCubePack<{ source: string; printingId: string }>[] = [
  'HOU',
  'HOU',
  'AKH',
].flatMap((source, index) =>
  seatIds.map((openedBy) => ({
    round: index + 1,
    openedBy,
    cards: [0, 1].map((slot) => ({
      physicalId: `${source}/${String(index)}/${openedBy}/${String(slot)}`,
      payload: { source, printingId: `${source}/same-printing` },
    })),
  })),
);

describe('pre-opened physical booster drafts', () => {
  it('keeps round sources and repeated printings while drafting every physical copy once', () => {
    const result = runPhysicalPackDraft(packs, { seatIds, score }).result;
    expect(result?.packs).toEqual(packs);
    expect(result?.undealt).toEqual([]);
    expect(result?.directions).toEqual([1, -1, 1]);
    for (const seat of result?.seats ?? []) {
      expect(seat.picks.map((pick) => pick.card.payload.source)).toEqual([
        'HOU',
        'HOU',
        'HOU',
        'HOU',
        'AKH',
        'AKH',
      ]);
    }
    const ids = result?.seats.flatMap((seat) => seat.picks.map((pick) => pick.card.physicalId));
    expect(new Set(ids).size).toBe(12);
  });

  it('replays human picks and records only presented packs in observations', () => {
    const options = { seatIds, score, humanSeatIds: ['human'] };
    const initial = runPhysicalPackDraft(packs, options);
    expect(initial.observations).toEqual(initial.owed);
    expect(initial.observations).toHaveLength(1);
    const changedHiddenPacks = packs.map((pack) =>
      pack.round === 1 && pack.openedBy === 'human'
        ? pack
        : {
            ...pack,
            cards: pack.cards.map((card) => ({ ...card, physicalId: `changed/${card.physicalId}` })),
          },
    );
    expect(runPhysicalPackDraft(changedHiddenPacks, options).observations).toEqual(initial.observations);
    const picked = initial.owed[0]?.cards[0]?.physicalId;
    expect(picked).toBeDefined();
    const next = runPhysicalPackDraft(packs, {
      ...options,
      picks: { human: [picked!] },
    });
    expect(next.observations).toHaveLength(2);
    expect(next.owed[0]?.openedBy).toBe('bot');
    expect(next.owed[0]?.cards).toHaveLength(1);
    expect(next.observations.every((observation) => observation.round === 1)).toBe(true);
    expect(runPhysicalPackDraft(packs, options)).toEqual(initial);
    expect(() =>
      runPhysicalPackDraft(packs, {
        ...options,
        picks: { human: ['AKH/2/human/0'] },
      }),
    ).toThrow(/not in round 1/);
  });

  it('reuses exactly the singleton replay behavior for the same initial deal', () => {
    const cube = runPhysicalCubeDraft(
      packs.flatMap((pack) => pack.cards),
      {
        seatIds,
        rounds: 3,
        packSize: 2,
        seed: 'compatibility',
        score,
      },
    );
    expect(
      runPhysicalPackDraft(cube.packs, {
        seatIds,
        seed: 'compatibility',
        score,
      }),
    ).toEqual(cube);
  });

  it('lets a policy choose once from the whole pack without rescoring every card', () => {
    let scoreCalls = 0;
    const result = runPhysicalPackDraft(packs, {
      seatIds,
      score: () => {
        scoreCalls += 1;
        return 0;
      },
      choose: ({ cards }: { readonly cards: readonly (typeof packs)[number]['cards'][number][] }) =>
        cards.length - 1,
    }).result;

    expect(scoreCalls).toBe(0);
    expect(result?.seats[0]?.picks[0]?.card.physicalId).toBe('HOU/0/human/1');
    expect(() => runPhysicalPackDraft(packs, { seatIds, score, choose: () => -1 })).toThrow(
      /policy chose invalid card index/,
    );
  });

  it('keeps whole-pack fields out of the scalar scorer input', () => {
    const inputs: object[] = [];
    runPhysicalPackDraft(packs, {
      seatIds,
      score: (input) => {
        inputs.push(input);
        return 0;
      },
    });

    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((input) => !Object.hasOwn(input, 'cards'))).toBe(true);
  });

  it('canonicalizes pack input order without changing the deal', () => {
    expect(runPhysicalPackDraft([...packs].reverse(), { seatIds, score })).toEqual(
      runPhysicalPackDraft(packs, { seatIds, score }),
    );
  });

  it.each([
    ['empty', []],
    ['missing seat', packs.slice(1)],
    ['duplicate opener', [...packs, packs[0]!]],
    ['unknown seat', packs.map((pack, index) => (index === 0 ? { ...pack, openedBy: 'absent' } : pack))],
    ['invalid round', packs.map((pack, index) => (index === 0 ? { ...pack, round: 0 } : pack))],
    ['round gap', packs.map((pack) => ({ ...pack, round: pack.round + 1 }))],
    [
      'unequal packs',
      packs.map((pack, index) => (index === 0 ? { ...pack, cards: pack.cards.slice(1) } : pack)),
    ],
    ['empty packs', packs.map((pack) => ({ ...pack, cards: [] }))],
    ['duplicate physical copy', packs.map((pack) => ({ ...pack, cards: packs[0]!.cards }))],
  ] as const)('rejects %s before calling a scorer', (_label, invalid) => {
    let called = false;
    expect(() =>
      runPhysicalPackDraft(invalid, {
        seatIds,
        score: () => {
          called = true;
          return 0;
        },
      }),
    ).toThrow(DraftError);
    expect(called).toBe(false);
  });
});
