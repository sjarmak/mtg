/** A recorded Siege cast keeps the transformed face through every replay surface. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card } from '@mtg/dsl';
import { legalActions, pendingDecision, reduce, scenario, type Action, type GameState } from '@mtg/kernel';
import { boardFrame } from '../../src/routes/replay/frame';
import { describeAction, namesFor } from '../../src/routes/replay/narrate';
import { GameRecordSchema } from '../../src/routes/replay/log-schema';
import { readEventLog } from '../../src/routes/replay/read-log';
import { decisionRecord, snapshotOf, stepRecord, writeEventLog } from '../../tools/record-replay';

const FRONT = parseCard({
  kind: 'battle',
  id: 'replay-siege',
  name: 'Invasion of Replay',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { generic: 1 },
  colors: [],
  subtypes: ['Siege'],
  defense: 1,
  backFace: {
    kind: 'creature',
    name: 'Replay Victor',
    colors: ['R'],
    subtypes: ['Warrior'],
    power: 3,
    toughness: 3,
  },
});

const BOLT = parseCard({
  kind: 'instant',
  id: 'replay-siege-bolt',
  name: 'Replay Siege Bolt',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 2 },
  manaCost: {},
  colors: [],
  effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
});

function apply(state: GameState, action: Action): GameState {
  return reduce(state, action).state;
}

function recordedSiegeCast() {
  let state = scenario({ battlefield: [{ card: FRONT, controller: 1 }], hands: [[BOLT], []] }).state;
  const target = state.battlefield[0];
  if (target === undefined) throw new Error('missing Siege');
  const castBolt = legalActions(state).find(
    (action) =>
      action.type === 'castSpell' &&
      action.targets[0]?.kind === 'permanent' &&
      action.targets[0].oid === target,
  );
  if (castBolt === undefined) throw new Error('missing Siege damage cast');
  state = apply(state, castBolt);
  state = apply(state, { type: 'passPriority', player: 0 });
  state = apply(state, { type: 'passPriority', player: 1 });
  state = apply(state, { type: 'passPriority', player: 0 });
  state = apply(state, { type: 'passPriority', player: 1 });

  const decision = pendingDecision(state);
  if (decision?.kind !== 'freeCast') throw new Error('missing transformed free cast');
  const castBack = decision.options.find((action) => action.type === 'castSpell');
  if (castBack?.type !== 'castSpell') throw new Error('missing transformed cast action');
  const recordedDecision = decisionRecord(state, decision, castBack, 24);
  const stepped = reduce(state, castBack);
  const snapshot = snapshotOf(stepped.state);
  const step = stepRecord(0, 0, state, stepped.events, snapshot, recordedDecision, castBack);

  const cards: Record<string, Card> = {};
  const objects: Record<string, { card: string; owner: 0 | 1; token: boolean }> = {};
  for (const [oid, object] of Object.entries(stepped.state.objects)) {
    cards[object.card.id] = object.card;
    objects[oid] = { card: object.card.id, owner: object.owner, token: object.token };
  }
  const game = GameRecordSchema.parse({
    record: 'game',
    game: 0,
    seed: 'replay/siege-cast',
    startingPlayer: 0,
    maximumTurns: 1,
    seats: [
      { bot: 'test', deck: 'attacker' },
      { bot: 'test', deck: 'protector' },
    ],
    cards,
    objects,
    steps: 1,
    result: { winner: null, loser: null, reason: 'turnLimit', endedOnTurn: 1 },
  });
  return readEventLog(writeEventLog('battle.test.ts', [{ game, steps: [step] }])).games[0];
}

describe('recorded Siege transformed casting', () => {
  it('names and draws the transformed face in the decision and on the stack', () => {
    const game = recordedSiegeCast();
    if (game === undefined) throw new Error('missing recorded Siege game');
    const step = game.steps[0];
    if (step === undefined) throw new Error('missing recorded Siege step');
    const names = namesFor(game, 0);

    expect(step.decision).toEqual(
      expect.objectContaining({
        kind: 'freeCast',
        activeCard: expect.objectContaining({ name: 'Replay Victor' }),
      }),
    );
    expect(names.card(step.action?.type === 'castSpell' ? step.action.oid : '')).toBe('Replay Victor');
    expect(step.action === null ? '' : describeAction(step.action, names)).toContain('Replay Victor');
    expect(boardFrame(game, step.state, step.active, null, names).stack.entries[0]?.card.name).toBe(
      'Replay Victor',
    );
  });
});
