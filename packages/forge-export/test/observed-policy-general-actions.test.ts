import { expect, it } from 'vitest';
import type { ObjectView, PendingDecision, PlayInteraction, TableView } from '@mtg/engine';
import { forgeObservedLegalBaselinePolicy, strongestForgeObservedPolicy } from '../src/observed/policy';
import { reviewedForgeActions } from '../src/observed/reviewed-actions';

function card(oid: string, controller: 0 | 1, overrides: Partial<ObjectView> = {}): ObjectView {
  return {
    oid,
    name: oid,
    typeLine: 'Creature',
    power: 2,
    toughness: 2,
    tapped: false,
    attacking: false,
    damage: 0,
    controller,
    counters: {},
    ...overrides,
  };
}

interface ViewContext {
  readonly zone?: 'battlefield' | 'exile' | 'graveyard';
  readonly zoneByOid?: Readonly<Record<string, 'battlefield' | 'exile' | 'graveyard'>>;
  readonly step?: 'MAIN1' | 'UPKEEP';
  readonly librarySize?: number;
}

function view(objects: readonly ObjectView[] = [], context: ViewContext = {}): TableView {
  const zone = context.zone ?? 'battlefield';
  const step = context.step ?? 'MAIN1';
  const seat = (id: 0 | 1): TableView['seats'][number] => ({
    id,
    name: `Seat ${id}`,
    life: 20,
    hand: id === 1 ? [] : null,
    handSize: 0,
    librarySize: context.librarySize ?? 40,
    graveyard: objects.filter(
      (object) => object.controller === id && (context.zoneByOid?.[object.oid] ?? zone) === 'graveyard',
    ),
    exile: objects.filter(
      (object) => object.controller === id && (context.zoneByOid?.[object.oid] ?? zone) === 'exile',
    ),
    battlefield: objects.filter(
      (object) => object.controller === id && (context.zoneByOid?.[object.oid] ?? zone) === 'battlefield',
    ),
  });
  return {
    version: 4,
    turn: { number: 1, active: 1, phase: step === 'UPKEEP' ? 'Upkeep' : 'Main', step },
    priority: 1,
    stack: [],
    seats: [seat(0), seat(1)],
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

function option(id: string, targets: readonly ObjectView[] = []) {
  return {
    id,
    text: 'untrusted text must not affect the choice',
    targets: targets.map((object) => ({ oid: object.oid, name: object.name, object })),
  };
}

function playerOption(seat: 0 | 1) {
  return {
    id: `distribute-player-${seat}`,
    text: 'untrusted text must not affect the choice',
    targets: [{ oid: `forge-player-${seat}`, name: `Seat ${seat}` }],
  };
}

function decision(kind: string, options: PendingDecision['options'], seat: 0 | 1 = 1): PendingDecision {
  return { seat, kind, prompt: 'untrusted prompt', options, complete: true };
}

function choose(
  decisionValue: PendingDecision,
  objects: readonly ObjectView[] = [],
  interaction = play(),
  context: ViewContext = {},
) {
  return strongestForgeObservedPolicy.choose({
    seat: decisionValue.seat,
    view: view(objects, context),
    decision: decisionValue,
    play: interaction,
  });
}

function positionWithHand(
  pending: PendingDecision,
  hand: readonly ObjectView[],
): Parameters<typeof strongestForgeObservedPolicy.choose>[0] {
  const empty = view();
  const seats: TableView['seats'] =
    pending.seat === 0
      ? [{ ...empty.seats[0], hand, handSize: hand.length }, empty.seats[1]]
      : [empty.seats[0], { ...empty.seats[1], hand, handSize: hand.length }];
  return {
    seat: pending.seat,
    view: { ...empty, seats },
    decision: pending,
    play: play(),
  };
}

it('completes a structurally exact scry move without interpreting the prompt', () => {
  const first = card('forge-card-49', 1);
  const second = card('forge-card-57', 1);
  const pending = decision('scry-move', [
    option('scry-move-card-49', [first]),
    option('scry-move-card-57', [second]),
    option('scry-move-done'),
  ]);

  expect(choose(pending, [first, second])).toEqual({
    status: 'chosen',
    move: 'scry-move-done',
    family: 'keep-scry-cards',
  });
});

it('orders an exact scry keep list from visible card value without interpreting the prompt', () => {
  const land = card('forge-card-49', 1, {
    typeLine: 'Basic Land - Island',
    power: null,
    toughness: null,
  });
  const spell = card('forge-card-57', 1, {
    typeLine: 'Enchantment - Aura',
    power: null,
    toughness: null,
    characteristics: { colors: ['U'], manaCost: '{3}{U}{U}', token: false },
  });
  const pending = decision('scry-keep', [
    option('scry-keep-card-49', [land]),
    option('scry-keep-card-57', [spell]),
  ]);

  expect(choose(pending, [land, spell])).toEqual({
    status: 'chosen',
    move: 'scry-keep-card-57',
    family: 'scry-keep-highest-value',
  });
});

it('orders an exact generic zone population from visible card value', () => {
  const low = card('forge-card-85', 1, { power: 0, toughness: 1 });
  const high = card('forge-card-92', 1, { power: 3, toughness: 3 });
  const pending = decision('zone-order', [
    option('zone-order-card-85', [low]),
    option('zone-order-card-92', [high]),
  ]);

  expect(reviewedForgeActions(pending)).toHaveLength(2);
  expect(choose(pending, [low, high])).toEqual({
    status: 'chosen',
    move: 'zone-order-card-92',
    family: 'zone-order-highest-value',
  });
});

it('finishes an exact incremental discard as soon as Forge exposes a legal completion', () => {
  const artifact = card('forge-card-41', 1, {
    typeLine: 'Artifact',
    power: null,
    toughness: null,
    characteristics: { colors: [], manaCost: '{2}', token: false },
  });
  const spell = card('forge-card-57', 1, {
    typeLine: 'Instant',
    power: null,
    toughness: null,
    characteristics: { colors: ['U'], manaCost: '{4}{U}', token: false },
  });
  const pending = decision('discard-selection', [
    option('discard-selection-card-41', [artifact]),
    option('discard-selection-card-57', [spell]),
    option('discard-selection-done'),
  ]);
  const position = positionWithHand(pending, [artifact, spell]);

  expect(reviewedForgeActions(pending)).toEqual([
    {
      family: 'discard-selection',
      role: 'choose-discard',
      oid: artifact.oid,
      move: 'discard-selection-card-41',
    },
    {
      family: 'discard-selection',
      role: 'choose-discard',
      oid: spell.oid,
      move: 'discard-selection-card-57',
    },
    {
      family: 'discard-selection',
      role: 'finish-discard-selection',
      move: 'discard-selection-done',
    },
  ]);
  expect(strongestForgeObservedPolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'discard-selection-done',
    family: 'finish-discard-selection',
  });
  expect(forgeObservedLegalBaselinePolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'discard-selection-done',
    family: 'finish-discard-selection',
  });
});

it('continues an exact two-card discard with the lowest-value visible hand card', () => {
  const expensive = card('forge-card-41', 1, {
    typeLine: 'Sorcery',
    power: null,
    toughness: null,
    characteristics: { colors: ['U'], manaCost: '{4}{U}', token: false },
  });
  const cheap = card('forge-card-57', 1, {
    typeLine: 'Artifact',
    power: null,
    toughness: null,
    characteristics: { colors: [], manaCost: '{1}', token: false },
  });
  const pending = decision('discard-selection', [
    option('discard-selection-card-41', [expensive]),
    option('discard-selection-card-57', [cheap]),
  ]);
  const position = positionWithHand(pending, [expensive, cheap]);

  expect(strongestForgeObservedPolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'discard-selection-card-57',
    family: 'discard-lowest-value',
  });
  expect(forgeObservedLegalBaselinePolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'discard-selection-card-41',
    family: 'discard',
  });
});

it.each([
  ['stale target', option('discard-selection-card-41', [card('forge-card-41', 1)]), []],
  [
    'opponent hand target',
    option('discard-selection-card-41', [card('forge-card-41', 0)]),
    [card('forge-card-41', 0)],
  ],
] as const)('keeps an exact discard with a %s unsupported', (_label, discard, hand) => {
  const pending = decision('discard-selection', [discard]);
  const position = positionWithHand(pending, hand);

  expect(strongestForgeObservedPolicy.choose(position)).toMatchObject({
    status: 'unsupported',
    family: 'discard-selection',
  });
  expect(forgeObservedLegalBaselinePolicy.choose(position)).toMatchObject({
    status: 'unsupported',
    family: 'discard-selection',
  });
});

it('rejects a discard target whose embedded object has a different identity', () => {
  const visible = card('forge-card-41', 1);
  const mismatched = {
    ...option('discard-selection-card-41', [visible]),
    targets: [{ oid: visible.oid, name: visible.name, object: { ...visible, oid: 'forge-card-42' } }],
  };
  const pending = decision('discard-selection', [mismatched]);

  expect(reviewedForgeActions(pending)).toEqual([]);
  expect(strongestForgeObservedPolicy.choose(positionWithHand(pending, [visible]))).toMatchObject({
    status: 'unsupported',
    family: 'discard-selection',
  });
});

it.each([
  [
    'a done move with a target',
    decision('discard-selection', [
      option('discard-selection-card-41', [card('forge-card-41', 1)]),
      option('discard-selection-done', [card('forge-card-41', 1)]),
    ]),
  ],
  [
    'an unreviewed alternative',
    decision('discard-selection', [
      option('discard-selection-card-41', [card('forge-card-41', 1)]),
      option('discard-selection-finish'),
    ]),
  ],
  [
    'a done move in another decision family',
    decision('hand-card-selection', [option('discard-selection-done')]),
  ],
  [
    'an incomplete callback',
    { ...decision('discard-selection', [option('discard-selection-done')]), complete: false },
  ],
] as const)('keeps an incremental discard containing %s unsupported', (_label, pending) => {
  const visible = card('forge-card-41', 1);
  const position = positionWithHand(pending, [visible]);

  expect(strongestForgeObservedPolicy.choose(position)).toMatchObject({
    status: 'unsupported',
    family: pending.kind,
  });
  expect(forgeObservedLegalBaselinePolicy.choose(position)).toMatchObject({
    status: 'unsupported',
    family: pending.kind,
  });
});

it('chooses one exact bridge-reviewed card from an opposing revealed hand', () => {
  const first = card('forge-card-48', 0);
  const second = card('forge-card-42', 0);
  const pending = decision('revealed-hand-discard-selection', [
    option('revealed-hand-discard-card-48', [first]),
    option('revealed-hand-discard-card-42', [second]),
  ]);

  expect(reviewedForgeActions(pending)).toEqual([
    {
      family: 'revealed-hand-discard-selection',
      role: 'choose-revealed-hand-discard',
      oid: 'forge-card-48',
      move: 'revealed-hand-discard-card-48',
    },
    {
      family: 'revealed-hand-discard-selection',
      role: 'choose-revealed-hand-discard',
      oid: 'forge-card-42',
      move: 'revealed-hand-discard-card-42',
    },
  ]);
  expect(choose(pending)).toEqual({
    status: 'chosen',
    move: 'revealed-hand-discard-card-42',
    family: 'revealed-hand-discard',
  });
});

it.each([
  [
    'an old generic discard move',
    decision('revealed-hand-discard-selection', [
      option('discard-selection-card-42', [card('forge-card-42', 0)]),
    ]),
  ],
  [
    'a missing target',
    decision('revealed-hand-discard-selection', [option('revealed-hand-discard-card-42')]),
  ],
  [
    'a mismatched target identity',
    decision('revealed-hand-discard-selection', [
      option('revealed-hand-discard-card-48', [card('forge-card-42', 0)]),
    ]),
  ],
  [
    'an incomplete callback',
    {
      ...decision('revealed-hand-discard-selection', [
        option('revealed-hand-discard-card-42', [card('forge-card-42', 0)]),
      ]),
      complete: false,
    },
  ],
] as const)('keeps revealed-hand discard with %s unsupported', (_label, pending) => {
  expect(reviewedForgeActions(pending)).toEqual([]);
  expect(choose(pending)).toMatchObject({
    status: 'unsupported',
    family: 'revealed-hand-discard-selection',
  });
});

it('rejects a generic zone-order target whose embedded object has a different identity', () => {
  const visible = card('forge-card-85', 1);
  const mismatched = {
    ...option('zone-order-card-85', [visible]),
    targets: [{ oid: visible.oid, name: visible.name, object: { ...visible, oid: 'forge-card-86' } }],
  };
  const pending = decision('zone-order', [mismatched]);

  expect(reviewedForgeActions(pending)).toEqual([]);
  expect(choose(pending, [visible])).toMatchObject({ status: 'unsupported', family: 'zone-order' });
});

it('owns the exact player-only holdout distribution in both policy arms', () => {
  const pending = decision('target-distribution', [playerOption(0), playerOption(1)], 0);
  const position = { seat: 0 as const, view: view(), decision: pending, play: play() };

  expect(reviewedForgeActions(pending)).toEqual([
    {
      family: 'target-distribution',
      role: 'choose-distribution-target',
      target: { kind: 'player', seat: 0 },
      move: 'distribute-player-0',
    },
    {
      family: 'target-distribution',
      role: 'choose-distribution-target',
      target: { kind: 'player', seat: 1 },
      move: 'distribute-player-1',
    },
  ]);
  expect(strongestForgeObservedPolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'distribute-player-1',
    family: 'target-distribution-opponent-player',
  });
  expect(forgeObservedLegalBaselinePolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'distribute-player-0',
    family: 'target-distribution',
  });
});

it('ranks an exact lethal opposing permanent above players in the mixed holdout shape', () => {
  const own = card('forge-card-11', 0, { name: 'Rampaging Ferocidon', power: 3, toughness: 3 });
  const opposing = card('forge-card-58', 1, {
    name: 'Llanowar Elves',
    power: 1,
    toughness: 1,
  });
  const pending = decision(
    'target-distribution',
    [
      playerOption(0),
      playerOption(1),
      option('distribute-card-11', [own]),
      option('distribute-card-58', [opposing]),
    ],
    0,
  );
  const position = { seat: 0 as const, view: view([own, opposing]), decision: pending, play: play() };

  expect(strongestForgeObservedPolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'distribute-card-58',
    family: 'target-distribution-lethal-permanent',
  });
  expect(forgeObservedLegalBaselinePolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'distribute-card-11',
    family: 'target-distribution',
  });
});

it('ranks a lethal opposing player above a lethal permanent from public life totals', () => {
  const opposing = card('forge-card-58', 1, { power: 1, toughness: 1 });
  const pending = decision(
    'target-distribution',
    [playerOption(1), option('distribute-card-58', [opposing])],
    0,
  );
  const current = view([opposing]);
  const position = {
    seat: 0 as const,
    view: {
      ...current,
      seats: [current.seats[0], { ...current.seats[1], life: 1 }] as TableView['seats'],
    },
    decision: pending,
    play: play(),
  };

  expect(strongestForgeObservedPolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'distribute-player-1',
    family: 'target-distribution-lethal-player',
  });
});

it('chooses an exact card distribution target deterministically', () => {
  const first = card('forge-card-4', 0);
  const second = card('forge-card-10', 0);
  const pending = decision('target-distribution', [
    option('distribute-card-10', [second]),
    option('distribute-card-4', [first]),
  ]);

  expect(choose(pending, [first, second])).toEqual({
    status: 'chosen',
    move: 'distribute-card-10',
    family: 'target-distribution',
  });
});

it.each([
  ['unknown id', decision('target-distribution', [playerOption(0), option('distribute-target-1')], 0)],
  [
    'player id and identity disagree',
    decision('target-distribution', [
      { ...playerOption(0), targets: [{ oid: 'forge-player-1', name: 'Seat 1' }] },
    ]),
  ],
  [
    'card id and identity disagree',
    decision('target-distribution', [option('distribute-card-4', [card('forge-card-5', 1)])]),
  ],
  [
    'card has no safe projected object',
    decision('target-distribution', [
      { id: 'distribute-card-4', text: 'untrusted', targets: [{ oid: 'forge-card-4', name: 'Card' }] },
    ]),
  ],
  [
    'card projected object identity disagrees',
    decision('target-distribution', [
      {
        ...option('distribute-card-4', [card('forge-card-4', 1)]),
        targets: [{ oid: 'forge-card-4', name: 'Card', object: card('forge-card-5', 1) }],
      },
    ]),
  ],
  ['duplicate move id', decision('target-distribution', [playerOption(0), playerOption(0)], 0)],
  [
    'duplicate target identity',
    decision('target-distribution', [
      playerOption(0),
      { ...playerOption(1), targets: [{ oid: 'forge-player-0', name: 'Seat 0' }] },
    ]),
  ],
  ['incomplete list', { ...decision('target-distribution', [playerOption(0)], 0), complete: false }],
] as const)('rejects a target distribution with %s', (_label, pending) => {
  expect(reviewedForgeActions(pending)).toEqual([]);
});

it('rejects a structurally reviewed distribution target that is stale in public state', () => {
  const target = card('forge-card-58', 1, { toughness: 1 });
  const pending = decision('target-distribution', [option('distribute-card-58', [target])], 0);
  const position = { seat: 0 as const, view: view(), decision: pending, play: play() };

  for (const policy of [strongestForgeObservedPolicy, forgeObservedLegalBaselinePolicy]) {
    expect(policy.choose(position)).toMatchObject({
      status: 'unsupported',
      family: 'target-distribution',
    });
  }
});

it('rejects a distribution callback sourced for a different acting seat', () => {
  const pending = decision('target-distribution', [playerOption(1)], 1);
  const position = { seat: 0 as const, view: view(), decision: pending, play: play() };

  for (const policy of [strongestForgeObservedPolicy, forgeObservedLegalBaselinePolicy]) {
    expect(policy.choose(position)).toMatchObject({
      status: 'unsupported',
      family: 'target-distribution',
    });
  }
});

it('does not interpret distribution-shaped callbacks from another decision family', () => {
  const pending = decision('entity-selection', [playerOption(1)], 0);
  expect(reviewedForgeActions(pending)).toEqual([]);
});

it('selects the highest visible value from an exact generic entity list', () => {
  const land = card('forge-card-74', 0, {
    name: 'Land',
    typeLine: 'Land',
    power: null,
    toughness: null,
  });
  const spell = card('forge-card-59', 0, {
    name: 'Spell',
    typeLine: 'Instant',
    power: null,
    toughness: null,
    characteristics: { colors: ['U'], manaCost: '{U}{U}', token: false },
  });
  const pending = decision('entity-selection', [
    option('entity-selection-card-74', [land]),
    option('entity-selection-card-59', [spell]),
  ]);

  expect(choose(pending, [land, spell])).toEqual({
    status: 'chosen',
    move: 'entity-selection-card-59',
    family: 'entity-selection-highest-value',
  });
});

it('applies an exact optional replacement with a shared source', () => {
  const source = card('forge-card-27', 1);
  const pending = decision('confirm-replacement', [
    option('confirm-replacement-yes', [source]),
    option('confirm-replacement-no', [source]),
  ]);

  expect(choose(pending, [source])).toEqual({
    status: 'chosen',
    move: 'confirm-replacement-yes',
    family: 'apply-replacement',
  });
});

it('finishes an exact unclassified optional-cost list without interpreting its text', () => {
  const source = card('forge-card-41', 1, { typeLine: 'Instant', power: null, toughness: null });
  const pending = decision('optional-cost-choice', [
    option('optional-cost-choice-0', [source]),
    option('optional-cost-choice-done'),
  ]);

  expect(reviewedForgeActions(pending)).toHaveLength(2);
  expect(choose(pending, [source])).toEqual({
    status: 'chosen',
    move: 'optional-cost-choice-done',
    family: 'finish-optional-cost-choice',
  });
});

it('pays Convoke with the lowest-value exact eligible creature before finishing', () => {
  const low = card('forge-card-12', 0, { power: 1, toughness: 1 });
  const high = card('forge-card-19', 0, {
    power: 4,
    toughness: 4,
    characteristics: { colors: ['G'], manaCost: '{3}{G}', token: false },
  });
  const payment = decision(
    'convoke-payment',
    [
      option('convoke-payment-card-19', [high]),
      option('convoke-payment-card-12', [low]),
      option('convoke-payment-done'),
    ],
    0,
  );
  const position = { seat: 0 as const, view: view([low, high]), decision: payment, play: play() };

  expect(reviewedForgeActions(payment)).toHaveLength(3);
  expect(strongestForgeObservedPolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'convoke-payment-card-12',
    family: 'convoke-lowest-value',
  });
  expect(forgeObservedLegalBaselinePolicy.choose(position)).toEqual(
    strongestForgeObservedPolicy.choose(position),
  );

  const finish = decision('convoke-payment', [option('convoke-payment-done')], 0);
  const finishPosition = { seat: 0 as const, view: view([low, high]), decision: finish, play: play() };
  expect(strongestForgeObservedPolicy.choose(finishPosition)).toEqual({
    status: 'chosen',
    move: 'convoke-payment-done',
    family: 'finish-convoke-payment',
  });
});

it('chooses a stable exact counter type without interpreting its prompt or labels', () => {
  const source = card('forge-card-44', 1, {
    typeLine: 'Enchantment - Saga',
    power: null,
    toughness: null,
    counters: { LORE: 3 },
  });
  const counterType = decision('counter-type-choice', [
    option('counter-type-choice-1', [source]),
    option('counter-type-choice-0', [source]),
  ]);
  const position = { seat: 1 as const, view: view([source]), decision: counterType, play: play() };

  expect(reviewedForgeActions(counterType)).toHaveLength(2);
  expect(strongestForgeObservedPolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'counter-type-choice-0',
    family: 'counter-type-choice',
  });
  expect(forgeObservedLegalBaselinePolicy.choose(position)).toEqual(
    strongestForgeObservedPolicy.choose(position),
  );
});

it.each([
  [
    'Convoke target identity mismatch',
    decision('convoke-payment', [
      option('convoke-payment-card-12', [card('forge-card-13', 1)]),
      option('convoke-payment-done'),
    ]),
  ],
  [
    'Convoke finish with a target',
    decision('convoke-payment', [
      option('convoke-payment-card-12', [card('forge-card-12', 1)]),
      option('convoke-payment-done', [card('forge-card-12', 1)]),
    ]),
  ],
  [
    'unknown counter id',
    decision('counter-type-choice', [option('counter-type-choice-surprise', [card('forge-card-44', 1)])]),
  ],
  [
    'mixed counter sources',
    decision('counter-type-choice', [
      option('counter-type-choice-0', [card('forge-card-44', 1)]),
      option('counter-type-choice-1', [card('forge-card-45', 1)]),
    ]),
  ],
] as const)('keeps malformed %s callbacks unsupported', (_case, malformed) => {
  expect(reviewedForgeActions(malformed)).toEqual([]);
  expect(choose(malformed)).toMatchObject({ status: 'unsupported', family: malformed.kind });
});

it.each(['convoke-payment', 'counter-type-choice'])('rejects incomplete %s callbacks', (kind) => {
  const source = card('forge-card-12', 1);
  const pending = {
    ...decision(
      kind,
      kind === 'convoke-payment'
        ? [option('convoke-payment-card-12', [source]), option('convoke-payment-done')]
        : [option('counter-type-choice-0', [source])],
    ),
    complete: false,
  };

  expect(reviewedForgeActions(pending)).toEqual([]);
  expect(choose(pending)).toMatchObject({ status: 'unsupported', family: kind });
});

it('rejects an optional-cost list containing an unrecognized option', () => {
  const source = card('forge-card-41', 1, { typeLine: 'Instant', power: null, toughness: null });
  const pending = decision('optional-cost-choice', [
    option('optional-cost-choice-0', [source]),
    option('optional-cost-choice-surprise', [source]),
    option('optional-cost-choice-done'),
  ]);

  expect(reviewedForgeActions(pending)).toEqual([]);
  expect(choose(pending, [source])).toEqual({
    status: 'unsupported',
    family: 'optional-cost-choice',
    reason: 'no reviewed action role identifies a legal move',
  });
});

it("accepts an exact action on a controlled exile source during its controller's upkeep", () => {
  const source = card('forge-card-41', 1, { typeLine: 'Sorcery', power: null, toughness: null });
  const pending = decision('confirm-action', [
    option('confirm-action-yes', [source]),
    option('confirm-action-no', [source]),
  ]);

  expect(reviewedForgeActions(pending)).toHaveLength(2);
  expect(choose(pending, [source], play(), { zone: 'exile', step: 'UPKEEP' })).toEqual({
    status: 'chosen',
    move: 'confirm-action-yes',
    family: 'confirm-exile-action',
  });
  expect(choose(pending, [source], play(), { zone: 'battlefield', step: 'UPKEEP' })).toEqual({
    status: 'unsupported',
    family: 'confirm-action',
    reason: 'no reviewed action role identifies a legal move',
  });
});

it('accepts an exact bridge-reviewed beneficial trigger from a controlled source', () => {
  const source = card('forge-card-45', 1, {
    name: 'structural source',
    typeLine: 'Creature - Sphinx',
    power: 4,
    toughness: 6,
  });
  const pending = decision('confirm-beneficial-trigger', [
    option('confirm-beneficial-trigger-yes', [source]),
    option('confirm-beneficial-trigger-no', [source]),
  ]);

  expect(reviewedForgeActions(pending)).toHaveLength(2);
  expect(choose(pending, [source])).toEqual({
    status: 'chosen',
    move: 'confirm-beneficial-trigger-yes',
    family: 'use-beneficial-trigger',
  });
});

it('declines an exact optional self-draw that would empty an already short library', () => {
  const source = card('forge-card-45', 1);
  const pending = decision('confirm-optional-self-draw-2', [
    option('confirm-optional-self-draw-2-yes', [source]),
    option('confirm-optional-self-draw-2-no', [source]),
  ]);

  expect(choose(pending, [source], play(), { librarySize: 1 })).toEqual({
    status: 'chosen',
    move: 'confirm-optional-self-draw-2-no',
    family: 'decline-decking-draw',
  });
  expect(choose(pending, [source], play(), { librarySize: 2 })).toEqual({
    status: 'chosen',
    move: 'confirm-optional-self-draw-2-yes',
    family: 'use-optional-self-draw',
  });
});

it('keeps an optional self-draw with conflicting source projections unsupported', () => {
  const acceptSource = card('forge-card-45', 1, { name: 'Consecrated Sphinx' });
  const declineSource = card('forge-card-45', 1, { name: 'Different source' });
  const pending = decision('confirm-optional-self-draw-2', [
    option('confirm-optional-self-draw-2-yes', [acceptSource]),
    option('confirm-optional-self-draw-2-no', [declineSource]),
  ]);

  expect(reviewedForgeActions(pending)).toEqual([]);
  expect(choose(pending, [acceptSource])).toMatchObject({
    status: 'unsupported',
    family: 'confirm-optional-self-draw-2',
  });
});

it.each([
  ['different sources', card('forge-card-45', 1), card('forge-card-46', 1)],
  ['an opponent source', card('forge-card-45', 0), card('forge-card-45', 0)],
] as const)('keeps a beneficial trigger with %s unsupported', (_case, acceptSource, declineSource) => {
  const pending = decision('confirm-beneficial-trigger', [
    option('confirm-beneficial-trigger-yes', [acceptSource]),
    option('confirm-beneficial-trigger-no', [declineSource]),
  ]);

  expect(reviewedForgeActions(pending)).toEqual([]);
  expect(choose(pending, [acceptSource, declineSource])).toMatchObject({
    status: 'unsupported',
    family: 'confirm-beneficial-trigger',
  });
});

it('accepts an exact source-linked free cast from the controlled graveyard', () => {
  const spell = card('forge-card-41', 1, { typeLine: 'Instant', power: null, toughness: null });
  const permissionSource = card('forge-card-21', 1);
  const pending = decision('confirm-free-cast', [
    option('confirm-free-cast-yes', [spell, permissionSource]),
    option('confirm-free-cast-no', [spell, permissionSource]),
  ]);

  expect(reviewedForgeActions(pending)).toHaveLength(2);
  expect(
    choose(pending, [spell, permissionSource], play(), {
      zoneByOid: { [spell.oid]: 'graveyard', [permissionSource.oid]: 'battlefield' },
    }),
  ).toEqual({
    status: 'chosen',
    move: 'confirm-free-cast-yes',
    family: 'confirm-free-cast',
  });
});

it('keeps a free-cast confirmation with a relocated permission source unsupported', () => {
  const spell = card('forge-card-41', 1, { typeLine: 'Instant', power: null, toughness: null });
  const permissionSource = card('forge-card-21', 1);
  const pending = decision('confirm-free-cast', [
    option('confirm-free-cast-yes', [spell, permissionSource]),
    option('confirm-free-cast-no', [spell, permissionSource]),
  ]);

  expect(
    choose(pending, [spell, permissionSource], play(), {
      zoneByOid: { [spell.oid]: 'graveyard', [permissionSource.oid]: 'graveyard' },
    }),
  ).toMatchObject({ status: 'unsupported', family: 'confirm-free-cast' });
});

it.each([
  ['opponent-owned', card('forge-card-41', 0), card('forge-card-21', 1), 'graveyard'],
  ['opponent-source', card('forge-card-41', 1), card('forge-card-21', 0), 'graveyard'],
  ['stale-zone', card('forge-card-41', 1), card('forge-card-21', 1), 'battlefield'],
] as const)('keeps a %s free-cast confirmation unsupported', (_case, spell, source, zone) => {
  const pending = decision('confirm-free-cast', [
    option('confirm-free-cast-yes', [spell, source]),
    option('confirm-free-cast-no', [spell, source]),
  ]);

  expect(choose(pending, [spell, source], play(), { zone })).toMatchObject({
    status: 'unsupported',
    family: 'confirm-free-cast',
  });
});

it('keeps incomplete or identity-ambiguous free-cast confirmations unsupported', () => {
  const spell = card('forge-card-41', 1);
  const firstSource = card('forge-card-21', 1);
  const secondSource = card('forge-card-22', 1);
  const incomplete = {
    ...decision('confirm-free-cast', [
      option('confirm-free-cast-yes', [spell, firstSource]),
      option('confirm-free-cast-no', [spell, firstSource]),
    ]),
    complete: false,
  };
  const ambiguous = decision('confirm-free-cast', [
    option('confirm-free-cast-yes', [spell, firstSource]),
    option('confirm-free-cast-no', [spell, secondSource]),
  ]);

  expect(reviewedForgeActions(incomplete)).toEqual([]);
  expect(reviewedForgeActions(ambiguous)).toEqual([]);
  expect(choose(incomplete, [spell, firstSource], play(), { zone: 'graveyard' })).toMatchObject({
    status: 'unsupported',
  });
  expect(choose(ambiguous, [spell, firstSource, secondSource], play(), { zone: 'graveyard' })).toMatchObject({
    status: 'unsupported',
  });
});

it.each(['ability-selection', 'mode-selection'])('chooses an exact %s id deterministically', (kind) => {
  const source = card('forge-card-38', 0, { typeLine: 'Instant', power: null, toughness: null });
  const pending = decision(kind, [option(`${kind}-166`, [source]), option(`${kind}-165`, [source])]);

  expect(choose(pending, [source])).toEqual({
    status: 'chosen',
    move: `${kind}-165`,
    family: kind,
  });
});

it('finishes a repeatable modal choice after Forge offers its exact completion action', () => {
  const source = card('forge-card-38', 0, { typeLine: 'Instant', power: null, toughness: null });
  const pending = decision('mode-selection', [
    option('mode-selection-166', [source]),
    option('mode-selection-167', [source]),
    option('mode-selection-done'),
  ]);
  const position = {
    seat: pending.seat,
    view: view([source]),
    decision: pending,
    play: play(),
  };

  expect(reviewedForgeActions(pending)).toContainEqual({
    family: 'mode-selection',
    role: 'finish-mode-selection',
    move: 'mode-selection-done',
  });
  expect(strongestForgeObservedPolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'mode-selection-done',
    family: 'mode-selection',
  });
  expect(forgeObservedLegalBaselinePolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'mode-selection-done',
    family: 'mode-selection',
  });
});

it('attacks a vulnerable opposing planeswalker before its controller', () => {
  const attacker = card('forge-card-11', 1, { power: 3, toughness: 3 });
  const planeswalker = card('forge-card-72', 0, {
    typeLine: 'Legendary Planeswalker - Karn',
    power: null,
    toughness: null,
    counters: { LOYALTY: 1 },
  });
  const pending = decision('combat-attackers', [
    option('combat-attackers-commit'),
    option('combat-attack-add-11-player-0', [attacker]),
    option('combat-attack-add-11-card-72', [attacker, planeswalker]),
  ]);

  expect(
    choose(
      pending,
      [attacker, planeswalker],
      play({
        turnStep: 'declareAttackers',
        attackers: { staged: [], confirm: 'combat-attackers-commit' },
        objectActions: [
          { oid: attacker.oid, move: 'combat-attack-add-11-player-0', category: 'combat' },
          { oid: attacker.oid, move: 'combat-attack-add-11-card-72', category: 'combat' },
        ],
      }),
    ),
  ).toEqual({ status: 'chosen', move: 'combat-attack-add-11-card-72', family: 'stage-attacker' });
});

it('uses exact attacker options when Forge omits the staged-attacker helper', () => {
  const attacker = card('forge-card-11', 0, { power: 3, toughness: 3 });
  const planeswalker = card('forge-card-72', 1, {
    typeLine: 'Legendary Planeswalker - Karn',
    power: null,
    toughness: null,
    counters: { LOYALTY: 1 },
  });
  const pending = decision(
    'combat-attackers',
    [
      option('combat-attackers-commit'),
      option('combat-attack-add-11-player-1', [attacker]),
      option('combat-attack-add-11-card-72', [attacker, planeswalker]),
    ],
    0,
  );

  expect(
    choose(
      pending,
      [attacker, planeswalker],
      play({
        turnStep: 'declareAttackers',
        objectActions: [
          { oid: attacker.oid, move: 'combat-attack-add-11-player-1', category: 'combat' },
          { oid: attacker.oid, move: 'combat-attack-add-11-card-72', category: 'combat' },
        ],
      }),
    ),
  ).toEqual({ status: 'chosen', move: 'combat-attack-add-11-card-72', family: 'stage-attacker' });
});

it('keeps staged attackers stable when Forge exposes them through removal actions', () => {
  const first = card('forge-card-18', 0, { power: 6, toughness: 6, attacking: true });
  const second = card('forge-card-40', 0, { power: 2, toughness: 2 });
  const planeswalker = card('forge-card-69', 1, {
    typeLine: 'Legendary Planeswalker - Chandra',
    power: null,
    toughness: null,
    counters: { LOYALTY: 5 },
  });
  const oneStaged = decision(
    'combat-attackers',
    [
      option('combat-attackers-commit'),
      option('combat-attack-remove-18', [first]),
      option('combat-attack-add-40-player-1', [second]),
      option('combat-attack-add-40-card-69', [second, planeswalker]),
    ],
    0,
  );

  expect(reviewedForgeActions(oneStaged)).toHaveLength(4);
  expect(
    choose(
      oneStaged,
      [first, second, planeswalker],
      play({
        turnStep: 'declareAttackers',
        objectActions: [
          { oid: first.oid, move: 'combat-attack-remove-18', category: 'combat' },
          { oid: second.oid, move: 'combat-attack-add-40-player-1', category: 'combat' },
          { oid: second.oid, move: 'combat-attack-add-40-card-69', category: 'combat' },
        ],
      }),
    ),
  ).toEqual({ status: 'chosen', move: 'combat-attack-add-40-card-69', family: 'stage-attacker' });

  const bothStaged = decision(
    'combat-attackers',
    [
      option('combat-attackers-commit'),
      option('combat-attack-remove-18', [first]),
      option('combat-attack-remove-40', [{ ...second, attacking: true }]),
    ],
    0,
  );
  expect(
    choose(
      bothStaged,
      [first, { ...second, attacking: true }, planeswalker],
      play({
        turnStep: 'declareAttackers',
        objectActions: [
          { oid: first.oid, move: 'combat-attack-remove-18', category: 'combat' },
          { oid: second.oid, move: 'combat-attack-remove-40', category: 'combat' },
        ],
      }),
    ),
  ).toEqual({ status: 'chosen', move: 'combat-attackers-commit', family: 'confirm-attackers' });
});

it('removes an attacker when Forge will not commit the staged declaration', () => {
  const attacker = card('forge-card-35', 0, {
    name: 'Mogg Flunkies',
    typeLine: 'Creature - Goblin',
    power: 3,
    toughness: 3,
    attacking: true,
  });
  const pending = decision('combat-attackers', [option('combat-attack-remove-35', [attacker])], 0);
  const position = {
    seat: pending.seat,
    view: view([attacker]),
    decision: pending,
    play: play({
      turnStep: 'declareAttackers',
      objectActions: [{ oid: attacker.oid, move: 'combat-attack-remove-35', category: 'combat' }],
    }),
  };

  expect(strongestForgeObservedPolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'combat-attack-remove-35',
    family: 'remove-attacker',
  });
  expect(forgeObservedLegalBaselinePolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'combat-attack-remove-35',
    family: 'remove-attacker',
  });
});

it.each([
  ['scry-move', [option('scry-move-card-49', [card('forge-card-50', 1)]), option('scry-move-done')]],
  ['scry-keep', [option('scry-keep-card-49', [card('forge-card-50', 1)])]],
  ['target-distribution', [option('distribute-card-4', [card('forge-card-5', 1)])]],
  ['entity-selection', [option('entity-selection-card-4', [card('forge-card-5', 1)])]],
  ['confirm-replacement', [option('confirm-replacement-yes', [card('forge-card-4', 1)])]],
  ['ability-selection', [option('ability-selection-unreviewed', [card('forge-card-4', 1)])]],
  ['mode-selection', [option('mode-selection-unreviewed', [card('forge-card-4', 1)])]],
  [
    'optional-cost-choice',
    [
      option('optional-cost-choice-0', [card('forge-card-4', 1)]),
      option('optional-cost-choice-done', [card('forge-card-4', 1)]),
    ],
  ],
  [
    'confirm-action',
    [
      option('confirm-action-yes', [card('forge-card-4', 1)]),
      option('confirm-action-no', [card('forge-card-5', 1)]),
    ],
  ],
  ['zone-order', [option('zone-order-card-4', [card('forge-card-5', 1)])]],
] as const)('keeps malformed %s decisions unsupported', (kind, options) => {
  const pending = decision(kind, options);
  expect(reviewedForgeActions(pending)).not.toHaveLength(options.length);
  expect(choose(pending)).toMatchObject({ status: 'unsupported', family: kind });
});
