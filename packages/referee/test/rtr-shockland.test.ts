/** Referee framing for the shockland pre-entry payment. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { beginTrace, moveObject, pendingDecision, scenario } from '@mtg/kernel';
import { observeState } from '@mtg/kernel';
import { frameDecision } from '@mtg/referee';

const BLOOD_CRYPT = parseCard({
  kind: 'land',
  id: 'rtr-blood-crypt-referee',
  name: 'Blood Crypt',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 238 },
  subtypes: ['Swamp', 'Mountain'],
  producesMana: ['B', 'R'],
  entryReplacement: { kind: 'payLifeOrEntersTapped', life: 2 },
});

describe('shockland referee framing', () => {
  it('states the cost and the consequence on both indexed options', () => {
    const start = scenario({ hands: [[BLOOD_CRYPT], []] }).state;
    const oid = start.players[0].hand[0];
    if (oid === undefined) throw new Error('missing shockland');
    const state = moveObject(beginTrace(start), oid, 'battlefield').state;
    const decision = pendingDecision(state);
    if (decision === null || decision.kind !== 'entryPayLife') {
      throw new Error('shockland entry decision is absent');
    }

    const frame = frameDecision({
      state: observeState(state, 0, 'test/rtr-shockland.test.ts:29'),
      player: 0,
      decision,
    });
    expect(frame.question).toBe('Do you pay 2 life as Blood Crypt enters?');
    expect(frame.options.map((option) => option.summary)).toEqual([
      'pay 2 life as Blood Crypt [o0] enters',
      'have Blood Crypt [o0] enter tapped without paying 2 life',
    ]);
  });
});
