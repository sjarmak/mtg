/** A modal activated ability retains both its source slot and chosen mode in replay. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { legalActions, reduce, scenario } from '@mtg/kernel';
import { boardFrame } from '../../src/routes/replay/frame';
import { namesFor } from '../../src/routes/replay/narrate';
import type { ReplayGameLog } from '../../src/routes/replay/read-log';
import { snapshotOf } from '../../tools/record-replay';

const WALKER = parseCard({
  kind: 'planeswalker',
  id: 'tst-modal-walker',
  name: 'Modal Walker',
  rarity: 'mythic',
  set: { code: 'TST', collectorNumber: 91 },
  manaCost: { generic: 2, B: 2 },
  colors: ['B'],
  supertypes: ['legendary'],
  subtypes: ['Liliana'],
  startingLoyalty: 4,
  abilities: [
    {
      kind: 'activated',
      loyaltyCost: 0,
      cost: { mana: {} },
      effects: [],
      modes: [
        { effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }] },
        { effects: [{ kind: 'gainLife', amount: 5, target: { kind: 'noTarget' } }] },
      ],
    },
  ],
});

describe('a replay stack carrying a modal activated ability', () => {
  it("draws the chosen ability mode's text rather than its bare index", () => {
    const start = scenario({ battlefield: [{ card: WALKER, controller: 0 }] }).state;
    const source = start.battlefield[0];
    if (source === undefined) throw new Error('scenario created no planeswalker');
    const action = legalActions(start).find(
      (candidate) =>
        candidate.type === 'activateAbility' &&
        candidate.oid === source &&
        candidate.abilityIndex === 0 &&
        candidate.mode === 1,
    );
    if (action === undefined) throw new Error('modal loyalty activation was not offered');
    const stacked = reduce(start, action).state;
    const snapshot = snapshotOf(stacked);
    const game: ReplayGameLog = {
      index: 0,
      seed: 'replay/modal-ability/1',
      startingPlayer: 0,
      maximumTurns: 1,
      seats: [
        { bot: 'scripted', deck: 'Walker A' },
        { bot: 'scripted', deck: 'Walker B' },
      ],
      result: { winner: null, loser: null, reason: 'turnLimit', endedOnTurn: 1 },
      objects: new Map([[source, { oid: source, card: WALKER, owner: 0, token: false }]]),
      steps: [],
    };

    expect(snapshot.stack[0]).toEqual(expect.objectContaining({ source, abilityIndex: 0, mode: 1 }));
    const frame = boardFrame(game, snapshot, 0, 0, namesFor(game, 0));
    // `modeLabel` since `mtg-sujc`, which gave the chosen mode a field of its
    // own instead of a place at the front of the target line.
    expect(frame.stack.entries[0]?.modeLabel).toBe('You gain 5 life.');
    expect(frame.stack.entries[0]?.targetLabel).toBeUndefined();
  });
});
