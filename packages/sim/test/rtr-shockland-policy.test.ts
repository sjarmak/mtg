/** Bot policy coverage for the shockland pre-entry payment. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { beginTrace, moveObject, observeState, pendingDecision, scenario } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, decideGreedy, randomBot } from '@mtg/sim';

const BLOOD_CRYPT = parseCard({
  kind: 'land',
  id: 'rtr-blood-crypt-policy',
  name: 'Blood Crypt',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 238 },
  subtypes: ['Swamp', 'Mountain'],
  producesMana: ['B', 'R'],
  entryReplacement: { kind: 'payLifeOrEntersTapped', life: 2 },
});

function viewAt(life: number, forcedTapped = false) {
  const start = scenario({ life: [life, 20], hands: [[BLOOD_CRYPT], []] }).state;
  const oid = start.players[0].hand[0];
  if (oid === undefined) throw new Error('missing shockland');
  const state = moveObject(beginTrace(start), oid, 'battlefield', { tapped: forcedTapped }).state;
  const decision = pendingDecision(state);
  if (decision === null || decision.kind !== 'entryPayLife') {
    throw new Error('shockland entry decision is absent');
  }
  return {
    state: observeState(state, 0, 'test/rtr-shockland-policy.test.ts:viewAt'),
    player: 0 as const,
    decision,
  };
}

describe('shockland bot policy', () => {
  it('pays when legal, declines when it is the only legal choice, and keeps random play legal', () => {
    const payable = viewAt(20);
    expect(decideGreedy(payable, DEFAULT_GREEDY_CONFIG)).toMatchObject({
      type: 'chooseEntryPayLife',
      pay: true,
    });
    expect(payable.decision.options).toContainEqual(randomBot('shockland', 'shockland-seed').decide(payable));

    const short = viewAt(1);
    expect(decideGreedy(short, DEFAULT_GREEDY_CONFIG)).toEqual(short.decision.options[0]);

    const lethal = viewAt(2);
    expect(decideGreedy(lethal, DEFAULT_GREEDY_CONFIG)).toMatchObject({
      type: 'chooseEntryPayLife',
      pay: false,
    });

    const forcedTapped = viewAt(20, true);
    expect(decideGreedy(forcedTapped, DEFAULT_GREEDY_CONFIG)).toMatchObject({
      type: 'chooseEntryPayLife',
      pay: false,
    });
  });
});
