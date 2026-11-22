/** CR 702.96 through the live prompt, event-log boundary, and replay frame. */
import { describe, expect, it } from 'vitest';
import { basicLand, parseCard, type CardInput } from '@mtg/dsl';
import { legalActions, pendingDecision, reduce, scenario, type Action, type GameState } from '@mtg/kernel';
import { boardFrame } from '../../src/routes/replay/frame';
import {
  EVENT_LOG_SCHEMA_VERSION,
  GameRecordSchema,
  StackEntrySchema,
} from '../../src/routes/replay/log-schema';
import { describeAction, namesFor } from '../../src/routes/replay/narrate';
import { readEventLog } from '../../src/routes/replay/read-log';
import { buildPrompt } from '../../src/routes/play/prompt';
import { decisionRecord, snapshotOf, stepRecord, writeEventLog } from '../../tools/record-replay';
import { fixtureText } from './support/log-fixture';

const DOWNSIZE = parseCard({
  kind: 'instant',
  id: 'rtr-41-downsize-ui',
  name: 'Downsize',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 41 },
  colors: ['U'],
  manaCost: { U: 1 },
  effects: [
    {
      kind: 'pumpUntilEndOfTurn',
      power: -4,
      toughness: 0,
      target: { kind: 'targetCreatureYouDontControl' },
    },
  ],
  overload: {
    cost: { generic: 2, U: 1 },
    effects: [
      {
        kind: 'pumpUntilEndOfTurn',
        power: -4,
        toughness: 0,
        scope: 'permanentsYouDontControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
    ],
  },
} as unknown as CardInput);

const ISLAND = basicLand('Island', 'RTR', 255);
const MOUNTAIN = basicLand('Mountain', 'RTR', 259);
const STREET_SPASM = parseCard({
  kind: 'instant',
  id: 'rtr-106-street-spasm-ui',
  name: 'Street Spasm',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 106 },
  colors: ['R'],
  manaCost: { R: 1, hasX: true },
  effects: [
    {
      kind: 'dealDamage',
      amount: { kind: 'chosenX' },
      target: {
        kind: 'targetCreatureYouDontControl',
        restriction: { kind: 'withoutKeyword', keyword: 'flying' },
      },
    },
  ],
  overload: {
    cost: { R: 2, hasX: true },
    xSymbols: 2,
    effects: [
      {
        kind: 'dealDamage',
        amount: { kind: 'chosenX' },
        scope: 'permanentsYouDontControl',
        scopeFilter: { cardTypes: ['creature'], excludeKeywords: ['flying'] },
        target: { kind: 'noTarget' },
      },
    ],
  },
});
const RIVAL = parseCard({
  kind: 'creature',
  id: 'rtr-overload-ui-rival',
  name: 'Overload Rival',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 999 },
  colors: [],
  manaCost: {},
  power: 4,
  toughness: 4,
});

const STACK_ENTRY = {
  oid: 'o1',
  controller: 0,
  card: 'o1',
  source: null,
  copiedFrom: null,
  chosenX: null,
  triggerContext: null,
  sourceCharacteristics: null,
  mode: null,
  targets: [null],
} as const;

function opening(): GameState {
  return scenario({
    seed: 'ui/replay/overload',
    battlefield: [
      { card: ISLAND, controller: 0 },
      { card: ISLAND, controller: 0 },
      { card: ISLAND, controller: 0 },
      { card: RIVAL, controller: 1 },
    ],
    hands: [[DOWNSIZE], []],
  }).state;
}

function overloadedAction(state: GameState): Extract<Action, { type: 'castSpell' }> {
  const action = legalActions(state).find(
    (candidate): candidate is Extract<Action, { type: 'castSpell' }> =>
      candidate.type === 'castSpell' && candidate.castingCost === 'overload',
  );
  if (action === undefined) throw new Error('the kernel did not enumerate an overloaded cast');
  return action;
}

function recordedOverload(): string {
  const state = opening();
  const decision = pendingDecision(state);
  if (decision === null) throw new Error('the opening asks no player for priority');
  const action = overloadedAction(state);
  const cast = reduce(state, action);
  const cards = Object.fromEntries(
    Object.values(cast.state.objects).map((object) => [object.card.id, object.card]),
  );
  const objects = Object.fromEntries(
    Object.entries(cast.state.objects).map(([oid, object]) => [
      oid,
      { card: object.card.id, owner: object.owner, token: object.token },
    ]),
  );
  const game = GameRecordSchema.parse({
    record: 'game',
    game: 0,
    seed: 'ui/replay/overload',
    startingPlayer: 0,
    maximumTurns: 1,
    seats: [
      { bot: 'scripted', deck: 'Overload' },
      { bot: 'none', deck: 'Rival' },
    ],
    cards,
    objects,
    steps: 1,
    result: { winner: null, loser: null, reason: 'turnLimit', endedOnTurn: 1 },
  });
  const step = stepRecord(
    0,
    0,
    state,
    cast.events,
    snapshotOf(cast.state),
    decisionRecord(state, decision, action, 24),
    action,
  );
  return writeEventLog('packages/ui/test/replay/overload.test.ts', [{ game, steps: [step] }]);
}

describe('Overload replay schemas', () => {
  it('accepts absent and known stack casting costs but rejects unknown and null', () => {
    expect(StackEntrySchema.safeParse(STACK_ENTRY).success).toBe(true);
    for (const castingCost of ['mana', 'alternative', 'overload', 'withoutMana'] as const) {
      expect(StackEntrySchema.parse({ ...STACK_ENTRY, castingCost }).castingCost).toBe(castingCost);
    }
    expect(StackEntrySchema.safeParse({ ...STACK_ENTRY, castingCost: 'discount' }).success).toBe(false);
    expect(StackEntrySchema.safeParse({ ...STACK_ENTRY, castingCost: null }).success).toBe(false);
    expect(
      StackEntrySchema.safeParse({
        ...STACK_ENTRY,
        source: STACK_ENTRY.card,
        abilityIndex: 0,
        castingCost: 'overload',
      }).success,
    ).toBe(false);
    expect(
      StackEntrySchema.safeParse({
        ...STACK_ENTRY,
        source: STACK_ENTRY.card,
        castingCost: 'overload',
      }).success,
    ).toBe(false);
  });

  it('bumps the producer grammar, reads ordinary /8, and rejects overload-only /8 meaning', () => {
    const text = recordedOverload();
    expect(EVENT_LOG_SCHEMA_VERSION).toBe('mtg-ui/event-log/10');
    expect(text).toContain('"schema":"mtg-ui/event-log/10"');
    expect(readEventLog(fixtureText().replace('event-log/10', 'event-log/8')).games).toHaveLength(2);
    expect(() => readEventLog(text.replace('event-log/10', 'event-log/8'))).toThrow(
      /event-log\/8.*\/9 casting-cost evidence/,
    );
  });
});

describe('an overloaded cast from live enumeration to replay frame', () => {
  it('is targetless, distinctly labeled, serialized, readable, and visible on the stack', () => {
    const state = opening();
    const decision = pendingDecision(state);
    if (decision === null) throw new Error('the opening asks no player for priority');
    const action = overloadedAction(state);
    expect(action.targets).toEqual([null]);

    const overloadIndex = decision.options.findIndex(
      (candidate) => candidate.type === 'castSpell' && candidate.castingCost === 'overload',
    );
    const choice = buildPrompt(state, decision, ['You', 'Bot']).choices.find(
      (candidate) => candidate.index === overloadIndex,
    );
    expect(choice).toMatchObject({
      label: 'Cast Downsize — Overload',
      detail: 'Pay {2}{U} (Overload)',
    });

    const text = recordedOverload();
    expect(text).toContain('"castingCost":"overload"');
    const game = readEventLog(text).games[0];
    const step = game?.steps[0];
    if (game === undefined || step === undefined) throw new Error('the replay lost its overloaded cast');
    expect(step.action).toMatchObject({ type: 'castSpell', castingCost: 'overload', targets: [null] });
    if (step.action === null) throw new Error('the replay lost the chosen action');
    expect(describeAction(step.action, namesFor(game, step.seq))).toBe(
      'cast Downsize using its overload cost',
    );
    expect(step.decision?.options).toContainEqual(
      expect.objectContaining({ type: 'castSpell', castingCost: 'overload', targets: [null] }),
    );
    expect(step.state.stack).toContainEqual(
      expect.objectContaining({ castingCost: 'overload', targets: [null] }),
    );

    const frame = boardFrame(game, step.state, step.active, null, namesFor(game, step.seq));
    const stackEntry = frame.stack.entries.find((entry) => entry.card.id === DOWNSIZE.id);
    expect(stackEntry).toMatchObject({ modeLabel: 'Overloaded' });
  });

  it("prints both X symbols in Street Spasm's Overload payment", () => {
    const state = scenario({
      seed: 'ui/replay/street-spasm',
      battlefield: [
        ...Array.from({ length: 6 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
        { card: RIVAL, controller: 1 },
      ],
      hands: [[STREET_SPASM], []],
    }).state;
    const decision = pendingDecision(state);
    if (decision === null) throw new Error('the opening asks no player for priority');
    const overloadIndex = decision.options.findIndex(
      (candidate) =>
        candidate.type === 'castSpell' && candidate.castingCost === 'overload' && candidate.x === 2,
    );
    expect(overloadIndex).toBeGreaterThanOrEqual(0);

    const choice = buildPrompt(state, decision, ['You', 'Bot']).choices.find(
      (candidate) => candidate.index === overloadIndex,
    );
    expect(choice?.detail).toBe('Pay {X}{X}{R}{R} (Overload)');
  });
});
