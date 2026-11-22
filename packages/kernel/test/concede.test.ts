import { describe, expect, it } from 'vitest';
import type { Decision } from '@mtg/kernel';
import {
  agentView,
  choose,
  createSession,
  DEFAULT_AUTO_PASS,
  humanSeat,
  lastDeclarationOption,
  ownedDecision,
  replaySession,
  scenario,
  settledChoice,
} from '@mtg/kernel';
import { exampleCard } from '@mtg/dsl';
import { lands, MOUNTAIN } from './cards';

const SETUP = {
  seed: 'concede/session',
  decks: [
    { name: 'Red A', cards: lands(MOUNTAIN, 40) },
    { name: 'Red B', cards: lands(MOUNTAIN, 40) },
  ] as const,
  maximumTurns: 10,
};

function priorityDecision(): Decision {
  const state = scenario({
    seed: 'concede/priority',
    battlefield: [{ card: exampleCard('slc-mountain'), controller: 0 }],
    active: 0,
    turn: 2,
  }).state;
  const decision = ownedDecision(state);
  if (decision === null) throw new Error('the scenario produced no decision');
  return decision;
}

describe('concession choices', () => {
  it('are the final option at every decision the current player owns', () => {
    let session = createSession(SETUP, [humanSeat('A'), humanSeat('B')]);
    for (let step = 0; step < 20; step += 1) {
      const decision = session.pending;
      if (decision === null) throw new Error('the game stopped before the sample completed');
      expect(decision.options.at(-1)).toEqual({ type: 'concede', player: decision.player });
      expect(decision.options.filter((option) => option.type === 'concede')).toHaveLength(1);
      const next = decision.options.findIndex((option) => option.type !== 'concede');
      session = choose(session, next);
    }
  });

  it('stay outside the decision delivered to an automated agent', () => {
    const decision = priorityDecision();
    const state = scenario({ seed: 'concede/agent', active: 0, turn: 2 }).state;
    const view = agentView(state, decision.player, decision, 'concede-agent');
    expect(decision.options.some((option) => option.type === 'concede')).toBe(true);
    expect(view.decision.options.some((option) => option.type === 'concede')).toBe(false);
  });

  it('preserve forced-choice and declaration selection semantics', () => {
    const forced: Decision = {
      kind: 'priority',
      player: 0,
      options: [
        { type: 'passPriority', player: 0 },
        { type: 'concede', player: 0 },
      ],
      complete: true,
    };
    const declaration: Decision = {
      kind: 'declareAttackers',
      player: 0,
      defender: 1,
      eligible: [],
      defenders: [],
      options: [
        { type: 'declareAttackers', player: 0, attackers: [] },
        { type: 'concede', player: 0 },
      ],
      complete: true,
    };
    expect(settledChoice(forced, DEFAULT_AUTO_PASS)).toBe(0);
    expect(lastDeclarationOption(declaration)).toEqual({
      type: 'declareAttackers',
      player: 0,
      attackers: [],
    });
  });

  it('record and replay the concession as its ordinary option index', () => {
    const seats = [humanSeat('A'), humanSeat('B')] as const;
    const started = createSession(SETUP, seats);
    const decision = started.pending;
    if (decision === null) throw new Error('the game produced no opening decision');
    const index = decision.options.findIndex((option) => option.type === 'concede');
    expect(index).toBeGreaterThan(0);
    const finished = choose(started, index);
    const replayed = replaySession(SETUP, seats, [index]);
    expect(finished.choices).toEqual([index]);
    expect(finished.result).toEqual(replayed.result);
    expect(finished.result).toMatchObject({ loser: decision.player, reason: 'concede' });
  });
});
