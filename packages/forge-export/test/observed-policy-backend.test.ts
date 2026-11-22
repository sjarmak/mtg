import { expect, it, vi } from 'vitest';
import type {
  ObservedBackend,
  ObservedSession,
  PendingDecision,
  PlayInteraction,
  SessionSpec,
  TableView,
} from '@mtg/engine';
import { textSubmission } from '@mtg/engine';
import {
  forgeObservedCoveragePolicyV8,
  FORGE_STRONGEST_OBSERVED_POLICY_IDENTITY,
  policyControlledObservedBackend,
  strongestForgeObservedPolicy,
} from '../src/observed/policy';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import type { ForgeObservedDecisionPolicy, ForgeObservedPolicyPosition } from '../src/observed/policy';
import { reviewedForgeActions } from '../src/observed/reviewed-actions';

const CARD = (oid: string, name: string, controller: 0 | 1, typeLine = 'Creature') => ({
  oid,
  name,
  typeLine,
  power: typeLine.includes('Creature') ? 2 : null,
  toughness: typeLine.includes('Creature') ? 2 : null,
  tapped: false,
  attacking: false,
  damage: 0,
  controller,
  counters: {},
});

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    { name: 'Human', controller: 'local', deck: { name: 'human', cards: [] } },
    { name: 'Candidate', controller: 'engine', deck: { name: 'candidate', cards: [] } },
  ],
  seed: 'policy-test',
  maximumTurns: 20,
};

function view(turn = 1): TableView {
  return {
    version: 4,
    turn: { number: turn, active: 1, phase: 'Main', step: 'MAIN1' },
    priority: 1,
    stack: [],
    seats: [
      {
        id: 0,
        name: 'Human',
        life: 20,
        hand: [CARD('human-secret', 'Human Secret', 0)],
        handSize: 1,
        librarySize: 39,
        graveyard: [],
        exile: [],
        battlefield: [],
      },
      {
        id: 1,
        name: 'Candidate',
        life: 20,
        hand: [
          CARD('candidate-land', 'Candidate Land', 1, 'Basic Land — Forest'),
          CARD('candidate-spell', 'Candidate Spell', 1),
        ],
        handSize: 2,
        librarySize: 38,
        graveyard: [],
        exile: [],
        battlefield: [],
      },
    ],
  };
}

function play(overrides: Partial<PlayInteraction> = {}): PlayInteraction {
  return {
    turnStep: 'precombatMain',
    passPriority: null,
    concede: null,
    objectActions: [],
    ...overrides,
  };
}

function decision(seat: 0 | 1, kind: string, ids: readonly string[]): PendingDecision {
  return {
    seat,
    kind,
    prompt: kind,
    options: ids.map((id) => ({ id, text: id, targets: [] })),
    complete: true,
  };
}

function session(
  pending: PendingDecision | null,
  interaction: PlayInteraction,
  submit: ObservedSession['submit'],
  overrides: Partial<ObservedSession> = {},
): ObservedSession {
  return {
    backend: 'forge-fixture',
    determinism: 'observed',
    table: {
      ...TABLE,
      seats: [TABLE.seats[0], { ...TABLE.seats[1], controller: 'local' }],
    },
    status: pending === null ? 'finished' : 'awaiting',
    view: view(),
    events: [],
    decision: pending,
    play: interaction,
    seats: null,
    result: pending === null ? { winner: 1, reason: 'fixture', endedOnTurn: 1 } : null,
    submitted: 0,
    localSeats: [0, 1],
    transcript: [{ seq: 0, view: view(), events: [], move: null }],
    submit,
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

it('pins the strongest observed policy and chooses reviewed routine actions without labels', () => {
  expect(FORGE_STRONGEST_OBSERVED_POLICY_IDENTITY).toMatchObject({
    policyId: 'forge-observed-strongest-play',
    policyVersion: 49,
    observationAdapterId: 'forge-player-observation/v1',
    actionAdapterId: 'forge-reviewed-actions/v41',
  });
  expect(FORGE_STRONGEST_OBSERVED_POLICY_IDENTITY.configuration).toMatchObject({
    coinChoice: 'stable-legal-action-id',
    actionOrder: [
      'automatic',
      'starting-player',
      'opening-hand',
      'mulligan-bottom',
      'number',
      'target-seat',
      'target-card',
      'card-selection',
      'pile-selection',
      'zone-card',
      'zone-order',
      'library-shuffle',
      'entity-destination',
      'beneficial-trigger',
      'optional-trigger',
      'discard',
      'revealed-hand-discard',
      'sacrifice',
      'cost-discard',
      'cost-exile',
      'whole-hand-discard-payment',
      'optional-payment',
      'optional-cost',
      'optional-cost-choice',
      'convoke-payment',
      'counter-type-choice',
      'action-confirmation',
      'color-choice',
      'parity-choice',
      'coin-choice',
      'type-choice',
      'replacement-order',
      'cost-sacrifice-selection',
      'cost-return-selection',
      'free-cast-confirmation',
      'combat-exert',
      'combat-blockers',
      'combat-damage',
      'trigger-order',
      'scry-move',
      'scry-keep',
      'target-distribution',
      'entity-selection',
      'replacement',
      'enumerated-selection',
      'source-linked-activation',
      'object',
      'attackers',
      'pass',
    ],
  });
  expect(FORGE_STRONGEST_OBSERVED_POLICY_IDENTITY.configSha256).toMatch(/^[0-9a-f]{64}$/u);
  expect(FORGE_STRONGEST_OBSERVED_POLICY_IDENTITY.configSha256).toBe(
    botEvidenceSha256(FORGE_STRONGEST_OBSERVED_POLICY_IDENTITY.configuration),
  );

  const position: ForgeObservedPolicyPosition = {
    seat: 1 as const,
    view: { ...view(), seats: [{ ...view().seats[0], hand: null }, view().seats[1]] } as TableView,
    decision: decision(1, 'priority', ['pass', 'play-land', 'cast-spell']),
    play: play({
      passPriority: 'pass',
      objectActions: [
        { oid: 'candidate-land', move: 'play-land', category: 'play' },
        { oid: 'candidate-spell', move: 'cast-spell', category: 'cast' },
      ],
    }),
  };
  expect(strongestForgeObservedPolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'play-land',
    family: 'play-object',
  });

  const combatView = view();
  const combatPosition = {
    ...position,
    view: combatView,
    decision: decision(1, 'combat-attackers', ['add-first', 'remove-staged', 'combat-attackers-commit']),
    play: play({
      objectActions: [
        { oid: 'first', move: 'add-first', category: 'combat' },
        { oid: 'staged', move: 'remove-staged', category: 'combat' },
      ],
      attackers: { staged: ['staged'], confirm: 'combat-attackers-commit' },
    }),
  };
  expect(strongestForgeObservedPolicy.choose(combatPosition)).toMatchObject({
    status: 'chosen',
    move: 'add-first',
  });
  expect(
    strongestForgeObservedPolicy.choose({
      ...combatPosition,
      decision: decision(1, 'combat-attackers', ['remove-first', 'combat-attackers-commit']),
      play: play({
        objectActions: [{ oid: 'first', move: 'remove-first', category: 'combat' }],
        attackers: { staged: ['first'], confirm: 'combat-attackers-commit' },
      }),
    }),
  ).toMatchObject({ status: 'chosen', move: 'combat-attackers-commit' });
});

it('submits the bridge-proved complete combat damage split', () => {
  const suggestion = JSON.stringify({
    version: 1,
    source: { oid: 'forge-card-17', name: 'Charging Rhino', power: 5 },
    total: 5,
    canDefer: false,
    overrideOrder: false,
    recipients: [
      { oid: 'forge-card-20', name: 'Bear Cub', kind: 'blocker', toughness: 2, damage: 0, lethal: 2 },
      {
        oid: 'forge-card-21',
        name: 'Horned Turtle',
        kind: 'blocker',
        toughness: 3,
        damage: 0,
        lethal: 3,
      },
      { oid: 'forge-player-1', name: 'South', kind: 'defender', toughness: null, damage: 0, lethal: 0 },
    ],
    amounts: [2, 3, 0],
    defer: false,
  });
  const input = {
    kind: 'text' as const,
    id: 'combat-damage-assignment:17',
    label: 'Assign combat damage',
    minLength: 2,
    maxLength: 16384,
    suggestions: [suggestion],
  };
  const pending: PendingDecision = {
    seat: 1,
    kind: 'combat-damage',
    prompt: 'Assign combat damage',
    options: [],
    input,
    complete: true,
  };
  expect(reviewedForgeActions(pending)).toEqual([
    {
      family: 'combat-damage',
      role: 'assign-damage-split',
      move: textSubmission(input, suggestion),
    },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 1, view: view(), decision: pending, play: play() }),
  ).toEqual({
    status: 'chosen',
    move: textSubmission(input, suggestion),
    family: 'assign-combat-damage',
  });
});

it('preserves the completion policy as a pinned control', () => {
  expect(forgeObservedCoveragePolicyV8.identity).toMatchObject({
    policyId: 'forge-observed-coverage-baseline',
    policyVersion: 8,
    actionAdapterId: 'forge-reviewed-actions/v7',
  });
});

it('ranks legal casts by safe card characteristics rather than object identity', () => {
  const base = view();
  const lower = {
    ...CARD('forge-card-01', 'One Drop', 1),
    characteristics: { colors: ['U'] as const, manaCost: '{U}', token: false },
  };
  const higher = {
    ...CARD('forge-card-99', 'Four Drop', 1),
    power: 4,
    toughness: 4,
    characteristics: { colors: ['U'] as const, manaCost: '{3}{U}', token: false },
  };
  const position: ForgeObservedPolicyPosition = {
    seat: 1 as const,
    view: {
      ...base,
      seats: [base.seats[0], { ...base.seats[1], hand: [lower, higher], handSize: 2 }],
    },
    decision: decision(1, 'priority', ['cast-low', 'cast-high', 'pass']),
    play: play({
      passPriority: 'pass',
      objectActions: [
        { oid: lower.oid, move: 'cast-low', category: 'cast' },
        { oid: higher.oid, move: 'cast-high', category: 'cast' },
      ],
    }),
  } satisfies Parameters<typeof strongestForgeObservedPolicy.choose>[0];
  expect(forgeObservedCoveragePolicyV8.choose(position)).toMatchObject({ move: 'cast-low' });
  expect(strongestForgeObservedPolicy.choose(position)).toMatchObject({ move: 'cast-high' });
});

it('passes instead of spending resources on an unscored mana or activated ability', () => {
  const position: ForgeObservedPolicyPosition = {
    seat: 1 as const,
    view: view(),
    decision: decision(1, 'priority', ['activate', 'tap-mana', 'pass']),
    play: play({
      passPriority: 'pass',
      objectActions: [
        { oid: 'candidate-spell', move: 'activate', category: 'ability' },
        { oid: 'candidate-land', move: 'tap-mana', category: 'mana', manaOutput: 'G' },
      ],
    }),
  };
  expect(forgeObservedCoveragePolicyV8.choose(position)).toMatchObject({ move: 'activate' });
  expect(strongestForgeObservedPolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'pass',
    family: 'pass-priority',
  });
});

it('prefers an opposing permanent when both players are legal card targets', () => {
  const base = view();
  const own = CARD('forge-card-01', 'Own Creature', 1);
  const opposing = CARD('forge-card-99', 'Opposing Creature', 0);
  const target = {
    ...decision(1, 'target-selection', ['target-card-01', 'target-card-99', 'target-cancel']),
    options: [
      { id: 'target-card-01', text: 'untrusted', targets: [{ oid: own.oid, name: own.name }] },
      {
        id: 'target-card-99',
        text: 'untrusted',
        targets: [{ oid: opposing.oid, name: opposing.name }],
      },
      { id: 'target-cancel', text: 'untrusted', targets: [] },
    ],
  } satisfies PendingDecision;
  const position: ForgeObservedPolicyPosition = {
    seat: 1 as const,
    view: {
      ...base,
      seats: [
        { ...base.seats[0], battlefield: [opposing] },
        { ...base.seats[1], battlefield: [own] },
      ],
    },
    decision: target,
    play: play(),
  } satisfies ForgeObservedPolicyPosition;
  expect(strongestForgeObservedPolicy.choose(position)).toMatchObject({ move: 'target-card-99' });
});

it('counters an opposing spell through its reviewed stack-target identity', () => {
  const base = view();
  const spell = CARD('forge-card-54', 'Opposing Spell', 0);
  const target = {
    ...decision(1, 'target-selection', ['target-stack-4', 'target-cancel']),
    options: [
      {
        id: 'target-stack-4',
        text: 'untrusted label',
        targets: [{ oid: spell.oid, name: spell.name }],
      },
      { id: 'target-cancel', text: 'untrusted label', targets: [] },
    ],
  } satisfies PendingDecision;
  const position = {
    seat: 1 as const,
    view: { ...base, stack: [spell] },
    decision: target,
    play: play(),
  } satisfies ForgeObservedPolicyPosition;

  expect(reviewedForgeActions(target)).toEqual([
    {
      family: 'target-selection',
      role: 'choose-stack-target',
      oid: spell.oid,
      move: 'target-stack-4',
    },
    { family: 'target-selection', role: 'cancel-target', move: 'target-cancel' },
  ]);
  expect(strongestForgeObservedPolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'target-stack-4',
    family: 'target-stack',
  });
  expect(forgeObservedCoveragePolicyV8.choose(position)).toMatchObject({
    status: 'unsupported',
    family: 'target-selection',
  });
});

it('reviews numeric move identities and chooses the greatest legal value without reading labels', () => {
  const numeric = {
    ...decision(1, 'number', ['number--2', 'number--1', 'number-0', 'number-7']),
    options: [
      { id: 'number--2', text: 'misleading greatest', targets: [] },
      { id: 'number--1', text: 'anything', targets: [] },
      { id: 'number-0', text: 'anything', targets: [] },
      { id: 'number-7', text: 'misleading smallest', targets: [] },
    ],
  } satisfies PendingDecision;
  expect(reviewedForgeActions(numeric)).toEqual([
    { family: 'number', role: 'choose-number', value: -2, move: 'number--2' },
    { family: 'number', role: 'choose-number', value: -1, move: 'number--1' },
    { family: 'number', role: 'choose-number', value: 0, move: 'number-0' },
    { family: 'number', role: 'choose-number', value: 7, move: 'number-7' },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 1, view: view(), decision: numeric, play: play() }),
  ).toEqual({ status: 'chosen', move: 'number-7', family: 'number' });
});

it('targets the opposing seat through the reviewed seat-action role', () => {
  const position = {
    seat: 1 as const,
    view: view(),
    decision: decision(1, 'target-selection', ['target-player-1', 'target-cancel', 'target-player-0']),
    play: play({
      seatActions: [
        { seat: 1, move: 'target-player-1' },
        { seat: 0, move: 'target-player-0' },
      ],
    }),
  };
  expect(strongestForgeObservedPolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'target-player-0',
    family: 'target-opponent',
  });
  expect(
    strongestForgeObservedPolicy.choose({
      ...position,
      play: play({ seatActions: [{ seat: 1, move: 'target-player-1' }] }),
    }),
  ).toEqual({ status: 'chosen', move: 'target-player-1', family: 'target-self' });
});

it('chooses structurally matched zone cards before an explicit decline', () => {
  const zoneChoice = {
    ...decision(1, 'zone-card-selection', ['zone-card-12', 'zone-decline']),
    options: [
      {
        id: 'zone-card-12',
        text: 'untrusted label',
        targets: [{ oid: 'forge-card-12', name: 'Revealed Candidate' }],
      },
      { id: 'zone-decline', text: 'untrusted label', targets: [] },
    ],
  } satisfies PendingDecision;
  expect(reviewedForgeActions(zoneChoice)).toEqual([
    {
      family: 'zone-card-selection',
      role: 'choose-zone-card',
      oid: 'forge-card-12',
      move: 'zone-card-12',
    },
    { family: 'zone-card-selection', role: 'decline-zone-card', move: 'zone-decline' },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 1, view: view(), decision: zoneChoice, play: play() }),
  ).toEqual({ status: 'chosen', move: 'zone-card-12', family: 'zone-card' });
  expect(
    strongestForgeObservedPolicy.choose({
      seat: 1,
      view: view(),
      decision: {
        ...zoneChoice,
        options: [
          {
            id: 'zone-card-12',
            text: 'untrusted label',
            targets: [{ oid: 'forge-card-99', name: 'Mismatched Candidate' }],
          },
        ],
      },
      play: play(),
    }),
  ).toMatchObject({ status: 'unsupported', family: 'zone-card-selection' });
});

it('puts the least valuable reviewed hand card back when Forge proves a hand-to-library choice', () => {
  const expensive = {
    ...CARD('forge-card-12', 'Expensive Spell', 1),
    characteristics: { colors: ['U'] as const, manaCost: '{4}{U}', token: false },
  };
  const land = {
    ...CARD('forge-card-98', 'Island', 1, 'Basic Land — Island'),
    characteristics: { colors: ['U'] as const, manaCost: null, token: false },
  };
  const handToLibrary = {
    ...decision(1, 'zone-card-selection-hand-to-library', [
      'zone-card-selection-hand-to-library-card-12',
      'zone-card-selection-hand-to-library-card-98',
    ]),
    options: [
      {
        id: 'zone-card-selection-hand-to-library-card-12',
        text: 'untrusted label',
        targets: [{ oid: expensive.oid, name: expensive.name }],
      },
      {
        id: 'zone-card-selection-hand-to-library-card-98',
        text: 'untrusted label',
        targets: [{ oid: land.oid, name: land.name }],
      },
    ],
  } satisfies PendingDecision;
  const position: ForgeObservedPolicyPosition = {
    seat: 1 as const,
    view: {
      ...view(),
      seats: [view().seats[0], { ...view().seats[1], hand: [expensive, land], handSize: 2 }],
    },
    decision: handToLibrary,
    play: play({ cardSelection: { origin: 'hand', destination: 'library' } }),
  };

  expect(reviewedForgeActions(handToLibrary)).toEqual([
    {
      family: 'zone-card-selection',
      role: 'choose-zone-card',
      oid: expensive.oid,
      move: 'zone-card-selection-hand-to-library-card-12',
    },
    {
      family: 'zone-card-selection',
      role: 'choose-zone-card',
      oid: land.oid,
      move: 'zone-card-selection-hand-to-library-card-98',
    },
  ]);
  expect(strongestForgeObservedPolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'zone-card-selection-hand-to-library-card-98',
    family: 'zone-card-put-back',
  });
});

it('places the more valuable returned card closest to the top through a proved library order', () => {
  const expensive = {
    ...CARD('forge-card-12', 'Expensive Spell', 1),
    characteristics: { colors: ['U'] as const, manaCost: '{4}{U}', token: false },
  };
  const land = {
    ...CARD('forge-card-98', 'Island', 1, 'Basic Land — Island'),
    characteristics: { colors: ['U'] as const, manaCost: null, token: false },
  };
  const ordering = {
    ...decision(1, 'zone-order-library-top-first', [
      'zone-order-library-top-first-card-98',
      'zone-order-library-top-first-card-12',
    ]),
    options: [
      {
        id: 'zone-order-library-top-first-card-98',
        text: 'untrusted label',
        targets: [{ oid: land.oid, name: land.name }],
      },
      {
        id: 'zone-order-library-top-first-card-12',
        text: 'untrusted label',
        targets: [{ oid: expensive.oid, name: expensive.name }],
      },
    ],
  } satisfies PendingDecision;
  const position: ForgeObservedPolicyPosition = {
    seat: 1 as const,
    view: {
      ...view(),
      seats: [view().seats[0], { ...view().seats[1], hand: [expensive, land], handSize: 2 }],
    },
    decision: ordering,
    play: play({ cardOrder: { destination: 'library', first: 'top' } }),
  };

  expect(strongestForgeObservedPolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'zone-order-library-top-first-card-12',
    family: 'zone-order-top',
  });
  expect(forgeObservedCoveragePolicyV8.choose(position)).toMatchObject({
    status: 'unsupported',
    family: 'zone-order-library-top-first',
  });
});

it('keeps a strategically ordered library when Forge proves the follow-up shuffle choice', () => {
  const shuffle = decision(1, 'confirm-library-shuffle-after-order', [
    'confirm-library-shuffle-after-order-yes',
    'confirm-library-shuffle-after-order-no',
  ]);

  expect(reviewedForgeActions(shuffle)).toEqual([
    {
      family: 'library-shuffle',
      role: 'shuffle-library',
      move: 'confirm-library-shuffle-after-order-yes',
    },
    {
      family: 'library-shuffle',
      role: 'keep-library-order',
      move: 'confirm-library-shuffle-after-order-no',
    },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 1, view: view(), decision: shuffle, play: play() }),
  ).toEqual({
    status: 'chosen',
    move: 'confirm-library-shuffle-after-order-no',
    family: 'keep-library-order',
  });
  expect(
    forgeObservedCoveragePolicyV8.choose({ seat: 1, view: view(), decision: shuffle, play: play() }),
  ).toMatchObject({ status: 'unsupported', family: 'confirm-library-shuffle-after-order' });
});

it('uses an exact reviewed beneficial trigger while the frozen control refuses it', () => {
  const source = {
    ...CARD('forge-card-42', 'Golos, Tireless Pilgrim', 1, 'Legendary Artifact Creature - Scout'),
    power: 3,
    toughness: 5,
    characteristics: { colors: [] as const, manaCost: '{5}', token: false },
  };
  const trigger: PendingDecision = {
    ...decision(1, 'confirm-beneficial-trigger', [
      'confirm-beneficial-trigger-yes',
      'confirm-beneficial-trigger-no',
    ]),
    options: [
      {
        id: 'confirm-beneficial-trigger-yes',
        text: 'Use the trigger',
        targets: [{ oid: source.oid, name: source.name, object: source }],
      },
      {
        id: 'confirm-beneficial-trigger-no',
        text: 'Decline the trigger',
        targets: [{ oid: source.oid, name: source.name, object: source }],
      },
    ],
  };

  expect(reviewedForgeActions(trigger)).toEqual([
    {
      family: 'beneficial-trigger',
      role: 'use-beneficial-trigger',
      move: 'confirm-beneficial-trigger-yes',
    },
    {
      family: 'beneficial-trigger',
      role: 'decline-beneficial-trigger',
      move: 'confirm-beneficial-trigger-no',
    },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 1, view: view(), decision: trigger, play: play() }),
  ).toEqual({
    status: 'chosen',
    move: 'confirm-beneficial-trigger-yes',
    family: 'use-beneficial-trigger',
  });
  expect(
    forgeObservedCoveragePolicyV8.choose({ seat: 1, view: view(), decision: trigger, play: play() }),
  ).toMatchObject({ status: 'unsupported', family: 'confirm-beneficial-trigger' });

  for (const malformed of [
    decision(1, 'confirm-beneficial-trigger', ['confirm-beneficial-trigger-yes']),
    {
      ...trigger,
      options: [trigger.options[0]!, { ...trigger.options[1]!, targets: [] }],
    },
    {
      ...trigger,
      options: [
        trigger.options[0]!,
        {
          ...trigger.options[1]!,
          targets: [{ oid: source.oid, name: source.name }],
        },
      ],
    },
    {
      ...trigger,
      options: [
        trigger.options[0]!,
        {
          ...trigger.options[1]!,
          targets: [{ oid: 'forge-card-99', name: source.name }],
        },
      ],
    },
  ]) {
    expect(reviewedForgeActions(malformed)).toEqual([]);
    expect(
      strongestForgeObservedPolicy.choose({
        seat: 1,
        view: view(),
        decision: malformed,
        play: play(),
      }),
    ).toMatchObject({ status: 'unsupported', family: 'confirm-beneficial-trigger' });
  }
});

it('ranks temporarily revealed cards by safe projected facts for exact destination choices', () => {
  const land = {
    ...CARD('forge-card-8', 'Revealed Land', 1, 'Land'),
    characteristics: { colors: [] as const, manaCost: null, token: false },
  };
  const spell = {
    ...CARD('forge-card-27', 'Revealed Spell', 1, 'Sorcery'),
    characteristics: { colors: ['U'] as const, manaCost: '{5}{U}{U}', token: false },
  };
  const selection = (kind: string): PendingDecision => ({
    ...decision(1, kind, [`${kind}-card-8`, `${kind}-card-27`]),
    options: [
      {
        id: `${kind}-card-8`,
        text: 'untrusted label',
        targets: [{ oid: land.oid, name: land.name, object: land }],
      },
      {
        id: `${kind}-card-27`,
        text: 'untrusted label',
        targets: [{ oid: spell.oid, name: spell.name, object: spell }],
      },
    ],
  });
  const toHand = selection('entity-selection-to-hand');
  const toBottom = selection('entity-selection-to-library-bottom');

  expect(reviewedForgeActions(toHand)).toEqual([
    {
      family: 'entity-selection',
      role: 'choose-destination-card',
      destination: 'hand',
      oid: land.oid,
      move: 'entity-selection-to-hand-card-8',
    },
    {
      family: 'entity-selection',
      role: 'choose-destination-card',
      destination: 'hand',
      oid: spell.oid,
      move: 'entity-selection-to-hand-card-27',
    },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 1, view: view(), decision: toHand, play: play() }),
  ).toEqual({
    status: 'chosen',
    move: 'entity-selection-to-hand-card-27',
    family: 'revealed-card-to-hand',
  });
  expect(
    strongestForgeObservedPolicy.choose({ seat: 1, view: view(), decision: toBottom, play: play() }),
  ).toEqual({
    status: 'chosen',
    move: 'entity-selection-to-library-bottom-card-8',
    family: 'revealed-card-to-library-bottom',
  });
  expect(
    forgeObservedCoveragePolicyV8.choose({ seat: 1, view: view(), decision: toHand, play: play() }),
  ).toMatchObject({ status: 'unsupported', family: 'entity-selection-to-hand' });
});

it('chooses only structurally matched cards for a discard decision', () => {
  const first = CARD('forge-card-63', 'First Candidate', 1);
  const second = CARD('forge-card-74', 'Second Candidate', 1);
  const discard = {
    ...decision(1, 'discard-selection', ['discard-selection-card-63', 'discard-selection-card-74']),
    options: [
      {
        id: 'discard-selection-card-63',
        text: 'untrusted label',
        targets: [{ oid: first.oid, name: first.name }],
      },
      {
        id: 'discard-selection-card-74',
        text: 'untrusted label',
        targets: [{ oid: second.oid, name: second.name }],
      },
    ],
  } satisfies PendingDecision;
  expect(reviewedForgeActions(discard)).toEqual([
    {
      family: 'discard-selection',
      role: 'choose-discard',
      oid: 'forge-card-63',
      move: 'discard-selection-card-63',
    },
    {
      family: 'discard-selection',
      role: 'choose-discard',
      oid: 'forge-card-74',
      move: 'discard-selection-card-74',
    },
  ]);
  const discardView = {
    ...view(),
    seats: [view().seats[0], { ...view().seats[1], hand: [first, second], handSize: 2 }],
  } as TableView;
  expect(
    strongestForgeObservedPolicy.choose({ seat: 1, view: discardView, decision: discard, play: play() }),
  ).toEqual({
    status: 'chosen',
    move: 'discard-selection-card-63',
    family: 'discard-lowest-value',
  });
  expect(
    strongestForgeObservedPolicy.choose({
      seat: 1,
      view: discardView,
      decision: {
        ...discard,
        options: [
          {
            id: 'discard-selection-card-63',
            text: 'untrusted label',
            targets: [{ oid: 'forge-card-74', name: 'Mismatched Candidate' }],
          },
        ],
      },
      play: play(),
    }),
  ).toMatchObject({ status: 'unsupported', family: 'discard-selection' });
});

it('discards the least valuable hand card through the current Forge discard ids', () => {
  const expensive = {
    ...CARD('forge-card-12', 'Expensive Spell', 1),
    characteristics: { colors: ['B'] as const, manaCost: '{4}{B}', token: false },
  };
  const land = {
    ...CARD('forge-card-98', 'Swamp', 1, 'Basic Land — Swamp'),
    characteristics: { colors: ['B'] as const, manaCost: null, token: false },
  };
  const discard = {
    ...decision(1, 'hand-card-selection', ['discard-card-12', 'discard-card-98']),
    options: [
      {
        id: 'discard-card-12',
        text: 'untrusted label',
        targets: [{ oid: expensive.oid, name: expensive.name }],
      },
      {
        id: 'discard-card-98',
        text: 'untrusted label',
        targets: [{ oid: land.oid, name: land.name }],
      },
    ],
  } satisfies PendingDecision;
  const position: ForgeObservedPolicyPosition = {
    seat: 1 as const,
    view: {
      ...view(),
      seats: [view().seats[0], { ...view().seats[1], hand: [expensive, land], handSize: 2 }],
    },
    decision: discard,
    play: play(),
  };

  expect(strongestForgeObservedPolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'discard-card-98',
    family: 'discard-lowest-value',
  });
  expect(forgeObservedCoveragePolicyV8.choose(position)).toMatchObject({
    status: 'unsupported',
    family: 'hand-card-selection',
  });
});

it('reviews card targets and prefers a legal target over cancellation', () => {
  const target = {
    ...decision(1, 'target-selection', ['target-card-78', 'target-cancel']),
    options: [
      {
        id: 'target-card-78',
        text: 'untrusted label',
        targets: [{ oid: 'forge-card-78', name: 'Candidate' }],
      },
      { id: 'target-cancel', text: 'untrusted label', targets: [] },
    ],
  } satisfies PendingDecision;
  expect(reviewedForgeActions(target)).toEqual([
    {
      family: 'target-selection',
      role: 'choose-card-target',
      oid: 'forge-card-78',
      move: 'target-card-78',
    },
    { family: 'target-selection', role: 'cancel-target', move: 'target-cancel' },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 1, view: view(), decision: target, play: play() }),
  ).toEqual({ status: 'chosen', move: 'target-card-78', family: 'target-card' });
});

it('pays reviewed optional life costs only while preserving a life buffer', () => {
  const optional = decision(1, 'optional-cost', ['optional-cost-pay-life-2', 'optional-cost-decline']);
  expect(reviewedForgeActions(optional)).toEqual([
    { family: 'optional-cost', role: 'pay-life', life: 2, move: 'optional-cost-pay-life-2' },
    { family: 'optional-cost', role: 'decline-cost', move: 'optional-cost-decline' },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 1, view: view(), decision: optional, play: play() }),
  ).toEqual({ status: 'chosen', move: 'optional-cost-pay-life-2', family: 'optional-cost-pay-life' });
  const lowLife = view();
  expect(
    strongestForgeObservedPolicy.choose({
      seat: 1,
      view: { ...lowLife, seats: [lowLife.seats[0], { ...lowLife.seats[1], life: 4 }] },
      decision: optional,
      play: play(),
    }),
  ).toEqual({ status: 'chosen', move: 'optional-cost-decline', family: 'optional-cost-decline' });
});

it('chooses only structurally matched cards for a discard cost', () => {
  const cost = {
    ...decision(1, 'cost-discard-selection', ['cost-discard-10', 'cost-discard-cancel']),
    options: [
      {
        id: 'cost-discard-10',
        text: 'untrusted label',
        targets: [{ oid: 'forge-card-10', name: 'Candidate' }],
      },
      { id: 'cost-discard-cancel', text: 'untrusted label', targets: [] },
    ],
  } satisfies PendingDecision;
  expect(reviewedForgeActions(cost)).toEqual([
    {
      family: 'cost-discard-selection',
      role: 'choose-cost-discard',
      oid: 'forge-card-10',
      move: 'cost-discard-10',
    },
    { family: 'cost-discard-selection', role: 'cancel-cost-discard', move: 'cost-discard-cancel' },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 1, view: view(), decision: cost, play: play() }),
  ).toEqual({ status: 'chosen', move: 'cost-discard-10', family: 'cost-discard' });
});

it('advances to the furthest numeric window before selecting a value', () => {
  const numeric = decision(1, 'number', [
    'number-0',
    'number-9',
    'number-up-10-max-237',
    'number-up-100-max-237',
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 1, view: view(), decision: numeric, play: play() }),
  ).toEqual({ status: 'chosen', move: 'number-up-100-max-237', family: 'number-window' });
  const unbounded = decision(1, 'number', [
    'number-0',
    'number-9',
    'number-up-10-max-2147483647',
    'number-up-100-max-2147483647',
    'number-up-1000000000-max-2147483647',
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 1, view: view(), decision: unbounded, play: play() }),
  ).toEqual({ status: 'chosen', move: 'number-9', family: 'number-open-ended' });
  expect(reviewedForgeActions(decision(1, 'priority', ['number-9']))).toEqual([]);
  expect(
    reviewedForgeActions(
      decision(1, 'number', [
        'number-up--1-max-10',
        'number-up-10-max-9007199254740992',
        'number-unreviewed',
      ]),
    ),
  ).toEqual([]);
  expect(
    strongestForgeObservedPolicy.choose({
      seat: 1,
      view: view(),
      decision: decision(1, 'number', ['number-1', 'number-unreviewed']),
      play: play(),
    }),
  ).toMatchObject({ status: 'unsupported', family: 'number' });
});

it('drives the engine seat through the observed interface and conceals each opponent hand', async () => {
  const captured: TableView[] = [];
  const policy: ForgeObservedDecisionPolicy = {
    identity: FORGE_STRONGEST_OBSERVED_POLICY_IDENTITY,
    choose: (position) => {
      captured.push(position.view);
      return strongestForgeObservedPolicy.choose(position);
    },
  };
  const humanDecision = decision(0, 'priority', ['human-pass']);
  const humanSession = session(humanDecision, play({ passPriority: 'human-pass' }), vi.fn(), {
    submitted: 2,
    seats: { view: () => view(), events: () => [], decision: () => null },
  });
  const mulliganSession = session(
    decision(1, 'mulligan', ['pregame-keep', 'pregame-mulligan']),
    play({ promptRole: 'opening-hand' }),
    vi.fn(async (move) => {
      expect(move).toBe('pregame-keep');
      return { ok: true as const, session: humanSession };
    }),
    { submitted: 1 },
  );
  const startingSession = session(
    decision(1, 'starting-player', ['pregame-start-seat-0', 'pregame-start-seat-1']),
    play(),
    vi.fn(async (move) => {
      expect(move).toBe('pregame-start-seat-1');
      return { ok: true as const, session: mulliganSession };
    }),
  );
  const delegate: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: vi.fn(async (table: SessionSpec) => {
      expect(table.seats.map((seat) => seat.controller)).toEqual(['local', 'local']);
      return [];
    }),
    open: vi.fn(async (table: SessionSpec) => {
      expect(table.seats.map((seat) => seat.controller)).toEqual(['local', 'local']);
      return { ok: true as const, session: startingSession };
    }),
  };

  const backend = policyControlledObservedBackend(delegate, policy);
  expect(backend.id).toContain('forge-observed-strongest-play@49');
  expect(await backend.supports(TABLE)).toEqual([]);
  const opened = await backend.open(TABLE);
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  expect(opened.session.table).toEqual(TABLE);
  expect(opened.session.localSeats).toEqual([0]);
  expect(opened.session.decision).toEqual(humanDecision);
  expect(opened.session.view.seats[1].hand).toBeNull();
  expect(opened.session.seats).toBeNull();
  expect(opened.session.transcript.every((frame) => frame.view.seats[1].hand === null)).toBe(true);
  expect(captured).toHaveLength(2);
  expect(captured.every((candidate) => candidate.seats[0].hand === null)).toBe(true);
  expect(captured.every((candidate) => candidate.seats[1].hand?.length === 2)).toBe(true);
  await Promise.all([opened.session.close(), opened.session.close()]);
  expect(humanSession.close).toHaveBeenCalledOnce();
});

it('follows the delegate on per-seat projection and hands its projector outward', async () => {
  const humanDecision = decision(0, 'priority', ['human-pass']);
  const projector = {
    view: (seat: 0 | 1): TableView => {
      const full = view();
      return seat === 0
        ? { ...full, seats: [full.seats[0], { ...full.seats[1], hand: null }] }
        : { ...full, seats: [{ ...full.seats[0], hand: null }, full.seats[1]] };
    },
    events: () => [],
    decision: (seat: 0 | 1) => (seat === 0 ? humanDecision : null),
  };
  const human = session(humanDecision, play({ passPriority: 'human-pass' }), vi.fn(), { seats: projector });
  const delegate: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
    supports: vi.fn(async () => []),
    open: vi.fn(async () => ({ ok: true as const, session: human })),
  };
  const backend = policyControlledObservedBackend(delegate, strongestForgeObservedPolicy);
  expect(backend.capabilities.perSeatProjection).toBe(true);
  const opened = await backend.open(TABLE);
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  expect(opened.session.seats).toBe(projector);
  expect(opened.session.view.seats[1].hand).toBeNull();
  expect(opened.session.seats?.view(0).seats[1].hand).toBeNull();
  expect(opened.session.seats?.view(0).seats[0].hand).toEqual(opened.session.view.seats[0].hand);
  expect(
    await backend.supports({ ...TABLE, seats: [TABLE.seats[0], { ...TABLE.seats[1], controller: 'local' }] }),
  ).toEqual(['observed policy requires exactly one local and one engine seat']);
});

it('submits an engine-seat text suggestion without an enumerated option', async () => {
  const suggestion = '"Ach! Hans, Run!"';
  const input = {
    kind: 'text' as const,
    id: 'card-name',
    label: 'Name a card',
    minLength: 1,
    maxLength: 41,
    suggestions: [suggestion],
  };
  const move = textSubmission(input, suggestion);
  const humanDecision = decision(0, 'priority', ['human-pass']);
  const human = session(humanDecision, play({ passPriority: 'human-pass' }), vi.fn());
  const candidate = session(
    { ...decision(1, 'card-name', []), input },
    play(),
    vi.fn(async (submitted) => {
      expect(submitted).toBe(move);
      return { ok: true as const, session: human };
    }),
  );
  const delegate: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => ({ ok: true, session: candidate }),
  };

  const opened = await policyControlledObservedBackend(delegate, strongestForgeObservedPolicy).open(TABLE);

  expect(opened).toMatchObject({ ok: true, session: { decision: humanDecision } });
  expect(candidate.submit).toHaveBeenCalledWith(move);
});

it('fails after Forge accepts an engine-seat text answer without changing the observation', async () => {
  const input = {
    kind: 'text' as const,
    id: 'card-name',
    label: 'Name a card',
    minLength: 1,
    maxLength: 41,
    suggestions: ['Pithing Needle'],
  };
  const repeated = session(
    { ...decision(1, 'card-name', []), input },
    play(),
    vi.fn(async () => ({ ok: true as const, session: repeated })),
  );
  const delegate: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => ({ ok: true, session: repeated }),
  };

  const opened = await policyControlledObservedBackend(delegate, strongestForgeObservedPolicy).open(TABLE);

  expect(opened).toMatchObject({
    ok: false,
    error: { message: expect.stringContaining('returned to the card-name observation') },
  });
  expect(repeated.submit).toHaveBeenCalledTimes(1);
});

it('accepts a human decision reached on the automatic-decision budget boundary', async () => {
  let submitted = 0;
  const at = (): ObservedSession => {
    const candidate = submitted < 512;
    return session(
      decision(candidate ? 1 : 0, 'priority', [candidate ? 'candidate-pass' : 'human-pass']),
      play({ passPriority: candidate ? 'candidate-pass' : 'human-pass' }),
      vi.fn(async () => {
        submitted += 1;
        return { ok: true as const, session: at() };
      }),
      { submitted, view: view(submitted + 1) },
    );
  };
  const delegate: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => ({ ok: true, session: at() }),
  };
  const opened = await policyControlledObservedBackend(delegate, strongestForgeObservedPolicy).open(TABLE);
  expect(opened).toMatchObject({ ok: true, session: { submitted: 512, decision: { seat: 0 } } });
});

it('auto-advances candidate decisions after a human submission', async () => {
  const returnedToHuman = session(
    decision(0, 'priority', ['human-pass-again']),
    play({ passPriority: 'human-pass-again' }),
    vi.fn(),
    { submitted: 2 },
  );
  const candidateTurn = session(
    decision(1, 'priority', ['candidate-pass', 'candidate-land']),
    play({
      passPriority: 'candidate-pass',
      objectActions: [{ oid: 'candidate-land', move: 'candidate-land', category: 'play' }],
    }),
    vi.fn(async (move) => {
      expect(move).toBe('candidate-land');
      return { ok: true as const, session: returnedToHuman };
    }),
    { submitted: 1 },
  );
  let initialUsed = false;
  const initial = session(
    decision(0, 'priority', ['human-pass']),
    play({ passPriority: 'human-pass' }),
    vi.fn(async (move) => {
      if (initialUsed) {
        return {
          ok: false as const,
          error: { kind: 'backend-failure' as const, message: 'stale fixture session' },
        };
      }
      initialUsed = true;
      expect(move).toBe('human-pass');
      return { ok: true as const, session: candidateTurn };
    }),
  );
  const delegate: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => ({ ok: true, session: initial }),
  };
  const opened = await policyControlledObservedBackend(delegate, strongestForgeObservedPolicy).open(TABLE);
  if (!opened.ok) throw new Error(opened.error.message);
  const advanced = await opened.session.submit('human-pass');
  expect(advanced.ok).toBe(true);
  if (!advanced.ok) return;
  expect(advanced.session.decision?.options[0]?.id).toBe('human-pass-again');
  expect(advanced.session.submitted).toBe(2);
  await expect(opened.session.submit('human-pass')).resolves.toMatchObject({
    ok: false,
    error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
  });
});

it('recovers when an accepted candidate move returns the identical observation', async () => {
  const candidateDecision = decision(1, 'priority', ['candidate-cast', 'candidate-pass']);
  const candidatePlay = play({
    passPriority: 'candidate-pass',
    objectActions: [{ oid: 'candidate-spell', move: 'candidate-cast', category: 'cast' }],
  });
  const human = session(
    decision(0, 'priority', ['human-pass']),
    play({ passPriority: 'human-pass' }),
    vi.fn(),
  );
  const submitted: string[] = [];
  const repeated = session(
    candidateDecision,
    candidatePlay,
    vi.fn(async (move) => {
      submitted.push(move);
      return { ok: true as const, session: move === 'candidate-pass' ? human : repeated };
    }),
  );
  const delegate: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => ({ ok: true, session: repeated }),
  };

  const opened = await policyControlledObservedBackend(delegate, strongestForgeObservedPolicy).open(TABLE);

  expect(opened).toMatchObject({ ok: true, session: { decision: { seat: 0 } } });
  expect(submitted).toEqual(['candidate-cast', 'candidate-pass']);
});

it('submits one repeated pass when Forge exposes an identical priority callback', async () => {
  const candidateDecision = decision(1, 'priority', ['candidate-pass']);
  const candidatePlay = play({ passPriority: 'candidate-pass' });
  const human = session(
    decision(0, 'priority', ['human-pass']),
    play({ passPriority: 'human-pass' }),
    vi.fn(),
  );
  const submitted: string[] = [];
  const second = session(
    candidateDecision,
    candidatePlay,
    vi.fn(async (move) => {
      submitted.push(move);
      return { ok: true as const, session: human };
    }),
  );
  const first = session(
    candidateDecision,
    candidatePlay,
    vi.fn(async (move) => {
      submitted.push(move);
      return { ok: true as const, session: second };
    }),
  );
  const delegate: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => ({ ok: true, session: first }),
  };

  const opened = await policyControlledObservedBackend(delegate, strongestForgeObservedPolicy).open(TABLE);

  expect(opened).toMatchObject({ ok: true, session: { decision: { seat: 0 } } });
  expect(submitted).toEqual(['candidate-pass', 'candidate-pass']);
});

it('submits three identical choices for a reviewed repeatable target callback', async () => {
  const target = decision(1, 'repeatable-target-selection', [
    'target-player-1',
    'target-player-0',
    'target-cancel',
  ]);
  const targetPlay = play({
    seatActions: [
      { seat: 1, move: 'target-player-1' },
      { seat: 0, move: 'target-player-0' },
    ],
  });
  const human = session(
    decision(0, 'priority', ['human-pass']),
    play({ passPriority: 'human-pass' }),
    vi.fn(),
  );
  const submitted: string[] = [];
  let remaining = 3;
  const repeated = session(
    target,
    targetPlay,
    vi.fn(async (move) => {
      submitted.push(move);
      remaining -= 1;
      return { ok: true as const, session: remaining === 0 ? human : repeated };
    }),
  );
  const delegate: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => ({ ok: true, session: repeated }),
  };

  const opened = await policyControlledObservedBackend(delegate, strongestForgeObservedPolicy).open(TABLE);

  expect(opened).toMatchObject({ ok: true, session: { decision: { seat: 0 } } });
  expect(submitted).toEqual(['target-player-0', 'target-player-0', 'target-player-0']);
});

it('replays one bounded Convoke transaction when Forge re-enters the same callback', async () => {
  const low = CARD('forge-card-12', 'Token', 1);
  const high = CARD('forge-card-19', 'Creature', 1);
  const convoke: PendingDecision = {
    seat: 1,
    kind: 'convoke-payment',
    prompt: 'convoke-payment',
    complete: true,
    options: [
      {
        id: 'convoke-payment-card-12',
        text: 'low',
        targets: [{ oid: low.oid, name: low.name, object: low }],
      },
      {
        id: 'convoke-payment-card-19',
        text: 'high',
        targets: [{ oid: high.oid, name: high.name, object: high }],
      },
      { id: 'convoke-payment-done', text: 'done', targets: [] },
    ],
  };
  const convokeView = {
    ...view(),
    seats: [view().seats[0], { ...view().seats[1], battlefield: [low, high] }],
  } satisfies TableView;
  const human = session(
    decision(0, 'priority', ['human-pass']),
    play({ passPriority: 'human-pass' }),
    vi.fn(),
  );
  const submitted: string[] = [];
  const repeated = session(
    convoke,
    play(),
    vi.fn(async (move) => {
      submitted.push(move);
      return { ok: true as const, session: submitted.length === 6 ? human : repeated };
    }),
    { view: convokeView },
  );
  const delegate: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => ({ ok: true, session: repeated }),
  };

  const opened = await policyControlledObservedBackend(delegate, strongestForgeObservedPolicy).open(TABLE);

  expect(opened).toMatchObject({ ok: true, session: { decision: { seat: 0 } } });
  expect(submitted).toEqual([
    'convoke-payment-card-12',
    'convoke-payment-card-19',
    'convoke-payment-done',
    'convoke-payment-card-12',
    'convoke-payment-card-19',
    'convoke-payment-done',
  ]);
});

it('fails after three identical choices for a reviewed repeatable target callback', async () => {
  const target = decision(1, 'repeatable-target-selection', ['target-player-0']);
  const submitted: string[] = [];
  const repeated = session(
    target,
    play({ seatActions: [{ seat: 0, move: 'target-player-0' }] }),
    vi.fn(async (move) => {
      submitted.push(move);
      return { ok: true as const, session: repeated };
    }),
  );
  const delegate: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => ({ ok: true, session: repeated }),
  };

  await expect(
    policyControlledObservedBackend(delegate, strongestForgeObservedPolicy).open(TABLE),
  ).resolves.toMatchObject({
    ok: false,
    error: { kind: 'backend-failure', message: expect.stringContaining('recovery failed') },
  });
  expect(submitted).toEqual(['target-player-0', 'target-player-0', 'target-player-0']);
});

it('fails explicitly when the candidate reaches an unreviewed action family', async () => {
  const unsupported = session(decision(1, 'mystery', ['opaque-a', 'opaque-b']), play(), vi.fn());
  const delegate: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => ({ ok: true, session: unsupported }),
  };
  const opened = await policyControlledObservedBackend(delegate, strongestForgeObservedPolicy).open(TABLE);
  expect(opened).toEqual({
    ok: false,
    error: {
      kind: 'unsupported',
      capability: 'forge-observed-policy:mystery',
      message: expect.stringContaining('mystery'),
    },
  });
  expect(unsupported.close).toHaveBeenCalledOnce();
});
