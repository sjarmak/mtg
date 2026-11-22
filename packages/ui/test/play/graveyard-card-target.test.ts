/** A graveyard card target remains named and serializable outside the battlefield. */
import { exampleCard } from '@mtg/dsl';
import { scenario } from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { describeTarget, type SeatNames } from '../../src/routes/play/position';
import { TargetSchema } from '../../src/routes/replay/log-schema';

const NAMES: SeatNames = ['You', 'Bot'];

describe('graveyard card targets in the UI', () => {
  it('names the card from game state and preserves the tagged target in replay data', () => {
    const state = scenario({ graveyards: [[exampleCard('slc-bronze-monument')], []] }).state;
    const oid = state.players[0].graveyard[0];
    if (oid === undefined) throw new Error('the scenario lost its graveyard card');
    const target = { kind: 'card' as const, oid };

    expect(describeTarget(state, NAMES, target)).toBe('your Bronze Monument');
    expect(TargetSchema.parse(target)).toEqual(target);
  });
});
