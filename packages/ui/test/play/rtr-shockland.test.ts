/** Human-facing prompt and log copy for the shockland entry decision. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { beginTrace, moveObject, pendingDecision, scenario } from '@mtg/kernel';
import { describeAction, describeDecision } from '../../src/log/narrate';
import { buildPrompt } from '../../src/routes/play/prompt';

const BLOOD_CRYPT = parseCard({
  kind: 'land',
  id: 'rtr-blood-crypt-ui',
  name: 'Blood Crypt',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 238 },
  subtypes: ['Swamp', 'Mountain'],
  producesMana: ['B', 'R'],
  entryReplacement: { kind: 'payLifeOrEntersTapped', life: 2 },
});

describe('shockland play prompt', () => {
  it('names payment and tapped entry without making the player infer either branch', () => {
    const start = scenario({ hands: [[BLOOD_CRYPT], []] }).state;
    const oid = start.players[0].hand[0];
    if (oid === undefined) throw new Error('missing shockland');
    const state = moveObject(beginTrace(start), oid, 'battlefield').state;
    const decision = pendingDecision(state);
    if (decision === null || decision.kind !== 'entryPayLife') {
      throw new Error('shockland entry decision is absent');
    }

    const prompt = buildPrompt(state, decision, ['You', 'Bot']);
    expect(prompt.headline).toBe('Pay life or enter tapped');
    expect(prompt.explain).toBe('You may pay 2 life as Blood Crypt enters. Otherwise it enters tapped.');
    expect(prompt.choices.map((choice) => choice.label)).toEqual(['Pay 2 life', 'Enter tapped']);

    const names = {
      card: () => 'Blood Crypt',
      player: (player: 0 | 1) => `Player ${String(player)}`,
      target: () => 'Blood Crypt',
    };
    expect(decision.options.map((action) => describeAction(action, names))).toEqual([
      'pay 2 life as Blood Crypt enters',
      'have Blood Crypt enter tapped without paying 2 life',
    ]);
    expect(describeDecision(decision, names)).toBe(
      'Player 0 chooses whether to pay life as a permanent enters.',
    );
  });
});
