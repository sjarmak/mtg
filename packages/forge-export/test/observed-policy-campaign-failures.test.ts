import { expect, it } from 'vitest';
import { textSubmission } from '@mtg/engine';
import type { ObjectView, PendingDecision, PlayInteraction, TableView } from '@mtg/engine';
import {
  forgeObservedCoveragePolicyV8,
  forgeObservedLegalBaselinePolicy,
  strongestForgeObservedPolicy,
} from '../src/observed/policy';
import { reviewedForgeActions, reviewedForgeActionsV7 } from '../src/observed/reviewed-actions';

function card(
  oid: string,
  name: string,
  controller: 0 | 1,
  manaCost: string | null,
  power: number | null = null,
  toughness: number | null = null,
  typeLine = power === null ? 'Sorcery' : 'Creature',
): ObjectView {
  return {
    oid,
    name,
    typeLine,
    power,
    toughness,
    tapped: false,
    attacking: false,
    damage: 0,
    controller,
    counters: {},
    characteristics: { colors: [], manaCost, token: false },
  };
}

function view(ownHand: readonly ObjectView[] = []): TableView {
  return {
    version: 4,
    turn: { number: 1, active: 0, phase: 'Main', step: 'MAIN1' },
    priority: 0,
    stack: [],
    seats: [
      {
        id: 0,
        name: 'Candidate',
        life: 20,
        hand: ownHand,
        handSize: ownHand.length,
        librarySize: 40 - ownHand.length,
        graveyard: [],
        exile: [],
        battlefield: [],
      },
      {
        id: 1,
        name: 'Opponent',
        life: 20,
        hand: null,
        handSize: 7,
        librarySize: 33,
        graveyard: [],
        exile: [],
        battlefield: [],
      },
    ],
  };
}

function play(overrides: Partial<PlayInteraction> = {}): PlayInteraction {
  return { turnStep: 'precombatMain', passPriority: null, concede: null, objectActions: [], ...overrides };
}

function decision(kind: string, options: PendingDecision['options']): PendingDecision {
  return { seat: 0, kind, prompt: 'untrusted', options, complete: true };
}

it('pins the expanded candidate while preserving the v8 control behavior', () => {
  expect(strongestForgeObservedPolicy.identity).toMatchObject({
    policyVersion: 49,
    actionAdapterId: 'forge-reviewed-actions/v41',
  });
  expect(forgeObservedCoveragePolicyV8.identity).toMatchObject({
    policyVersion: 8,
    actionAdapterId: 'forge-reviewed-actions/v7',
    configSha256: '5fb2a4327d105242b46cb3e8cac5f34afe41c0c64281dcd49de25067f6657510',
  });

  const trigger = decision('confirm-trigger', [
    {
      id: 'confirm-trigger-yes',
      text: 'misleading',
      targets: [{ oid: 'forge-card-9', name: 'Tragic Lesson' }],
    },
    {
      id: 'confirm-trigger-no',
      text: 'misleading',
      targets: [{ oid: 'forge-card-9', name: 'Tragic Lesson' }],
    },
  ]);
  expect(
    forgeObservedCoveragePolicyV8.choose({ seat: 0, view: view(), decision: trigger, play: play() }),
  ).toMatchObject({ status: 'unsupported', family: 'confirm-trigger' });
});

it('calls a fair coin through a reviewed controlled-source role with a stable tie-break', () => {
  const source = card('forge-card-44', 'Source', 0, '{5}', 1, 1, 'Artifact Creature - Construct');
  const sourceTarget = { oid: source.oid, name: source.name, object: source };
  const base = view();
  const positionView: TableView = {
    ...base,
    seats: [{ ...base.seats[0], battlefield: [source] }, base.seats[1]],
  };
  const coin = decision('coin-choice', [
    { id: 'coin-choice-tails', text: 'misleading', targets: [sourceTarget] },
    { id: 'coin-choice-heads', text: 'misleading', targets: [sourceTarget] },
  ]);

  expect(reviewedForgeActions(coin)).toEqual([
    {
      family: 'coin-choice',
      role: 'choose-coin-call',
      call: 'tails',
      sourceOid: source.oid,
      move: 'coin-choice-tails',
    },
    {
      family: 'coin-choice',
      role: 'choose-coin-call',
      call: 'heads',
      sourceOid: source.oid,
      move: 'coin-choice-heads',
    },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 0, view: positionView, decision: coin, play: play() }),
  ).toEqual({ status: 'chosen', move: 'coin-choice-heads', family: 'choose-stable-coin-call' });

  const opposingSource = card('forge-card-45', 'Opposing source', 1, '{5}', 1, 1);
  const unreviewed = decision('coin-choice', [
    {
      id: 'coin-choice-heads',
      text: 'ignored',
      targets: [{ oid: opposingSource.oid, name: opposingSource.name, object: opposingSource }],
    },
    {
      id: 'coin-choice-tails',
      text: 'ignored',
      targets: [{ oid: opposingSource.oid, name: opposingSource.name, object: opposingSource }],
    },
  ]);
  expect(reviewedForgeActions(unreviewed)).toEqual([]);
});

it('does not infer whether a generic reveal confirmation is beneficial from hidden information', () => {
  const source = card('forge-card-44', 'Hidden peek source', 0, '{U}', 1, 1);
  const sourceTarget = { oid: source.oid, name: source.name, object: source };
  const base = view();
  const positionView: TableView = {
    ...base,
    turn: { number: 4, active: 0, phase: 'Upkeep step', step: 'UPKEEP' },
    seats: [{ ...base.seats[0], battlefield: [source] }, base.seats[1]],
  };
  const reveal = {
    ...decision('confirm-action', [
      { id: 'confirm-action-yes', text: 'Yes', targets: [sourceTarget] },
      { id: 'confirm-action-no', text: 'No', targets: [sourceTarget] },
    ]),
    prompt: 'Source: Reveal cards to other players?',
  };

  expect(reviewedForgeActions(reveal)).toMatchObject([
    { family: 'action-confirmation', role: 'confirm-action' },
    { family: 'action-confirmation', role: 'decline-action' },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 0, view: positionView, decision: reveal, play: play() }),
  ).toEqual({
    status: 'unsupported',
    family: 'confirm-action',
    reason: 'no reviewed action role identifies a legal move',
  });
});

it('keeps the old strategy where it is legal and uses current coverage only as a fallback', () => {
  expect(forgeObservedLegalBaselinePolicy.identity).toMatchObject({
    policyId: 'forge-observed-legal-baseline',
    policyVersion: 31,
    actionAdapterId: 'forge-reviewed-actions/v41',
  });

  const low = card('forge-card-1', 'One Drop', 0, '{U}', 1, 1);
  const high = card('forge-card-9', 'Seven Drop', 0, '{5}{U}{U}', 7, 7);
  const priority = decision('priority', [
    { id: 'cast-low', text: 'Cast low', targets: [] },
    { id: 'cast-high', text: 'Cast high', targets: [] },
    { id: 'pass', text: 'Pass', targets: [] },
  ]);
  const position = {
    seat: 0 as const,
    view: view([low, high]),
    decision: priority,
    play: play({
      passPriority: 'pass',
      objectActions: [
        { oid: low.oid, move: 'cast-low', category: 'cast' },
        { oid: high.oid, move: 'cast-high', category: 'cast' },
      ],
    }),
  };
  expect(forgeObservedLegalBaselinePolicy.choose(position)).toEqual(
    forgeObservedCoveragePolicyV8.choose(position),
  );
  expect(forgeObservedLegalBaselinePolicy.choose(position)).not.toEqual(
    strongestForgeObservedPolicy.choose(position),
  );

  const trigger = decision('confirm-trigger', [
    {
      id: 'confirm-trigger-yes',
      text: 'misleading',
      targets: [{ oid: 'forge-card-9', name: 'Tragic Lesson' }],
    },
    {
      id: 'confirm-trigger-no',
      text: 'misleading',
      targets: [{ oid: 'forge-card-9', name: 'Tragic Lesson' }],
    },
  ]);
  const triggerPosition = { seat: 0 as const, view: view(), decision: trigger, play: play() };
  expect(forgeObservedCoveragePolicyV8.choose(triggerPosition)).toMatchObject({ status: 'unsupported' });
  expect(forgeObservedLegalBaselinePolicy.choose(triggerPosition)).toEqual(
    strongestForgeObservedPolicy.choose(triggerPosition),
  );
});

it('keeps the v7 baseline parser frozen for generic zone choices', () => {
  const generic = decision('zone-card-selection', [
    {
      id: 'zone-card-selection-card-9',
      text: 'misleading',
      targets: [{ oid: 'forge-card-9', name: 'Card' }],
    },
  ]);

  expect(reviewedForgeActions(generic)).toHaveLength(1);
  expect(reviewedForgeActionsV7(generic)).toEqual([]);
  expect(
    forgeObservedCoveragePolicyV8.choose({ seat: 0, view: view(), decision: generic, play: play() }),
  ).toMatchObject({ status: 'unsupported', family: 'zone-card-selection' });
});

it('chooses the higher-value public pile without reading the prompt or labels', () => {
  const mystic = card('forge-card-50', 'Murmuring Mystic', 0, '{3}{U}', 1, 5);
  const sanctum = card('forge-card-44', 'Botanical Sanctum', 0, null, null, null, 'Land');
  const mountain = card('forge-card-80', 'Mountain', 0, null, null, null, 'Basic Land - Mountain');
  const animateDead = card('forge-card-46', 'Animate Dead', 0, '{1}{B}', null, null, 'Enchantment - Aura');
  const liliana = card(
    'forge-card-63',
    'Liliana, the Last Hope',
    0,
    '{1}{B}{B}',
    null,
    null,
    'Legendary Planeswalker - Liliana',
  );
  const target = (object: ObjectView) => ({ oid: object.oid, name: object.name, object });
  const piles = decision('choose-pile', [
    {
      id: 'choose-pile-first',
      text: 'misleading',
      targets: [target(mystic), target(sanctum)],
    },
    {
      id: 'choose-pile-second',
      text: 'misleading',
      targets: [target(mountain), target(animateDead), target(liliana)],
    },
  ]);

  expect(reviewedForgeActions(piles)).toEqual([
    {
      family: 'pile-selection',
      role: 'choose-pile',
      oids: ['forge-card-50', 'forge-card-44'],
      move: 'choose-pile-first',
    },
    {
      family: 'pile-selection',
      role: 'choose-pile',
      oids: ['forge-card-80', 'forge-card-46', 'forge-card-63'],
      move: 'choose-pile-second',
    },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 0, view: view(), decision: piles, play: play() }),
  ).toEqual({ status: 'chosen', move: 'choose-pile-second', family: 'choose-highest-value-pile' });
  expect(
    forgeObservedLegalBaselinePolicy.choose({ seat: 0, view: view(), decision: piles, play: play() }),
  ).toEqual({ status: 'chosen', move: 'choose-pile-second', family: 'choose-highest-value-pile' });
  expect(reviewedForgeActionsV7(piles)).toEqual([]);
});

it('breaks equal-value pile choices by the stable action id', () => {
  const first = card('forge-card-1', 'First', 0, '{U}');
  const second = card('forge-card-2', 'Second', 0, '{U}');
  const target = (object: ObjectView) => ({ oid: object.oid, name: object.name, object });
  const piles = decision('choose-pile', [
    { id: 'choose-pile-first', text: 'ignored', targets: [target(first)] },
    { id: 'choose-pile-second', text: 'ignored', targets: [target(second)] },
  ]);

  expect(
    strongestForgeObservedPolicy.choose({ seat: 0, view: view(), decision: piles, play: play() }),
  ).toEqual({ status: 'chosen', move: 'choose-pile-first', family: 'choose-highest-value-pile' });
});

it('owns the retained four-of-five permanent sacrifice selection without reading its prompt', () => {
  const permanents = [
    card('forge-card-44', 'Botanical Sanctum', 1, null, null, null, 'Land'),
    card('forge-card-53', 'Swamp', 1, null, null, null, 'Basic Land - Swamp'),
    card('forge-card-70', 'Watery Grave', 1, null, null, null, 'Land - Island Swamp'),
    card('forge-card-73', 'Island', 1, null, null, null, 'Basic Land - Island'),
    card('forge-card-74', 'Island', 1, null, null, null, 'Basic Land - Island'),
  ];
  const target = (object: ObjectView) => ({ oid: object.oid, name: object.name, object });
  const sacrifice: PendingDecision = {
    ...decision(
      'sacrifice-selection',
      permanents.map((object) => ({
        id: `sacrifice-selection-card-${object.oid.slice('forge-card-'.length)}-chosen-0-min-4-max-4`,
        text: 'misleading',
        targets: [target(object)],
      })),
    ),
    seat: 1,
  };
  const base = view();
  const retainedView: TableView = {
    ...base,
    seats: [base.seats[0], { ...base.seats[1], battlefield: permanents }],
  };
  const position = { seat: 1 as const, view: retainedView, decision: sacrifice, play: play() };

  expect(reviewedForgeActions(sacrifice)).toEqual(
    permanents.map((object) => ({
      family: 'sacrifice-selection',
      role: 'choose-sacrifice',
      oid: object.oid,
      chosen: 0,
      minimum: 4,
      maximum: 4,
      move: `sacrifice-selection-card-${object.oid.slice('forge-card-'.length)}-chosen-0-min-4-max-4`,
    })),
  );
  expect(strongestForgeObservedPolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'sacrifice-selection-card-44-chosen-0-min-4-max-4',
    family: 'sacrifice-lowest-value',
  });
  expect(forgeObservedLegalBaselinePolicy.choose(position)).toEqual({
    status: 'chosen',
    move: 'sacrifice-selection-card-44-chosen-0-min-4-max-4',
    family: 'sacrifice-lowest-value',
  });

  const finish: PendingDecision = {
    ...decision('sacrifice-selection', [
      {
        id: 'sacrifice-selection-card-74-chosen-2-min-2-max-4',
        text: 'finish',
        targets: [target(permanents[4]!)],
      },
      {
        id: 'sacrifice-selection-done-chosen-2-min-2-max-4',
        text: 'choose another',
        targets: [],
      },
    ]),
    seat: 1,
  };
  expect(reviewedForgeActions(finish)).toEqual([
    {
      family: 'sacrifice-selection',
      role: 'choose-sacrifice',
      oid: 'forge-card-74',
      chosen: 2,
      minimum: 2,
      maximum: 4,
      move: 'sacrifice-selection-card-74-chosen-2-min-2-max-4',
    },
    {
      family: 'sacrifice-selection',
      role: 'finish-sacrifice-selection',
      chosen: 2,
      minimum: 2,
      maximum: 4,
      move: 'sacrifice-selection-done-chosen-2-min-2-max-4',
    },
  ]);
  expect(strongestForgeObservedPolicy.choose({ ...position, decision: finish })).toEqual({
    status: 'chosen',
    move: 'sacrifice-selection-done-chosen-2-min-2-max-4',
    family: 'finish-sacrifice-selection',
  });
});

it('rejects inconsistent or incomplete sacrifice progress', () => {
  const own = card('forge-card-1', 'Own Permanent', 0, '{2}');
  const other = card('forge-card-2', 'Other Permanent', 1, '{2}');
  const target = (object: ObjectView) => ({ oid: object.oid, name: object.name, object });
  const pick = (object: ObjectView, progress: string) => ({
    id: `sacrifice-selection-card-${object.oid.slice('forge-card-'.length)}-${progress}`,
    text: 'ignored',
    targets: [target(object)],
  });
  const malformed: readonly PendingDecision[] = [
    decision('sacrifice-selection', [pick(own, 'chosen-0-min-1-max-2'), pick(own, 'chosen-0-min-2-max-2')]),
    decision('sacrifice-selection', [
      pick(own, 'chosen-0-min-1-max-2'),
      { id: 'sacrifice-selection-done-chosen-0-min-1-max-2', text: 'ignored', targets: [] },
    ]),
    decision('sacrifice-selection', [pick(own, 'chosen-1-min-1-max-2')]),
    decision('sacrifice-selection', [pick(other, 'chosen-0-min-1-max-1')]),
    decision('sacrifice-selection', [pick(own, 'chosen-2-min-1-max-2')]),
    {
      ...decision('sacrifice-selection', [pick(own, 'chosen-0-min-1-max-1')]),
      input: {
        kind: 'text',
        id: 'unexpected-text-input',
        label: 'unexpected',
        minLength: 0,
        maxLength: 1,
        suggestions: [],
      },
    },
  ];

  for (const candidate of malformed) expect(reviewedForgeActions(candidate)).toEqual([]);
});

it('rejects pile choices whose exact public partition is not proved', () => {
  const first = card('forge-card-1', 'First', 0, '{U}');
  const second = card('forge-card-2', 'Second', 0, '{2}{U}');
  const target = (object: ObjectView) => ({ oid: object.oid, name: object.name, object });
  const malformed = [
    decision('choose-pile', [
      { id: 'choose-pile-first', text: 'ignored', targets: [target(first)] },
      { id: 'choose-pile-second', text: 'ignored', targets: [{ oid: second.oid, name: second.name }] },
    ]),
    decision('choose-pile', [
      { id: 'choose-pile-first', text: 'ignored', targets: [target(first)] },
      { id: 'choose-pile-second', text: 'ignored', targets: [target(first)] },
    ]),
    decision('choose-pile', [
      { id: 'choose-pile-first', text: 'ignored', targets: [target(first)] },
      { id: 'choose-pile-second', text: 'ignored', targets: [target(second)] },
      { id: 'choose-pile-third', text: 'ignored', targets: [] },
    ]),
    {
      ...decision('choose-pile', [
        { id: 'choose-pile-first', text: 'ignored', targets: [target(first)] },
        { id: 'choose-pile-second', text: 'ignored', targets: [target(second)] },
      ]),
      input: {
        kind: 'text' as const,
        id: 'unexpected-text-input',
        label: 'unexpected',
        minLength: 0,
        maxLength: 1,
        suggestions: [],
      },
    },
  ];

  for (const candidate of malformed) expect(reviewedForgeActions(candidate)).toEqual([]);
});

it('bottoms the least useful exact card set after a London mulligan', () => {
  const plains = card('forge-card-1', 'Plains', 0, null, null, null, 'Basic Land - Plains');
  const island = card('forge-card-2', 'Island', 0, null, null, null, 'Basic Land - Island');
  const sevenDrop = card('forge-card-3', 'Seven Drop', 0, '{5}{U}{U}');
  const twoDrop = card('forge-card-4', 'Two Drop', 0, '{1}{U}', 2, 2);
  const hand = [plains, island, sevenDrop, twoDrop];
  const bottom = decision(
    'mulligan-bottom',
    hand.map((candidate, index) => ({
      id: `pregame-bottom-${String(index)}`,
      text: 'misleading',
      targets: [{ oid: candidate.oid, name: candidate.name }],
    })),
  );

  expect(reviewedForgeActions(bottom)).toHaveLength(4);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 0, view: view(hand), decision: bottom, play: play() }),
  ).toEqual({ status: 'chosen', move: 'pregame-bottom-2', family: 'mulligan-bottom' });
});

it('declines an unclassified optional trigger through exact symmetric choices', () => {
  const trigger = decision('confirm-trigger', [
    {
      id: 'confirm-trigger-yes',
      text: 'Decline',
      targets: [{ oid: 'forge-card-9', name: 'Tragic Lesson' }],
    },
    {
      id: 'confirm-trigger-no',
      text: 'Use',
      targets: [{ oid: 'forge-card-9', name: 'Tragic Lesson' }],
    },
  ]);

  expect(reviewedForgeActions(trigger)).toEqual([
    {
      family: 'optional-trigger',
      role: 'use-trigger',
      sourceOid: 'forge-card-9',
      move: 'confirm-trigger-yes',
    },
    {
      family: 'optional-trigger',
      role: 'decline-trigger',
      sourceOid: 'forge-card-9',
      move: 'confirm-trigger-no',
    },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 0, view: view(), decision: trigger, play: play() }),
  ).toEqual({ status: 'chosen', move: 'confirm-trigger-no', family: 'decline-unclassified-trigger' });
});

it('exiles the lowest-value exact hand card for an alternate cost', () => {
  const low = card('forge-card-4', 'Two Drop', 0, '{1}{U}');
  const high = card('forge-card-7', 'Seven Drop', 0, '{5}{U}{U}');
  const cost = decision('cost-card-selection', [
    { id: 'cost-exile-7', text: 'misleading', targets: [{ oid: high.oid, name: high.name }] },
    { id: 'cost-exile-4', text: 'misleading', targets: [{ oid: low.oid, name: low.name }] },
    { id: 'cost-exile-cancel', text: 'misleading', targets: [] },
  ]);

  expect(
    strongestForgeObservedPolicy.choose({ seat: 0, view: view([low, high]), decision: cost, play: play() }),
  ).toEqual({ status: 'chosen', move: 'cost-exile-4', family: 'cost-exile-lowest-value' });
});

it('chooses exact generic cost cards and recognizes optional completion', () => {
  const low = card('forge-card-4', 'Two Drop', 0, '{1}{U}');
  const high = card('forge-card-7', 'Seven Drop', 0, '{5}{U}{U}');
  const cost = decision('cost-card-selection', [
    { id: 'cost-card-selection-card-7', text: 'misleading', targets: [{ oid: high.oid, name: high.name }] },
    { id: 'cost-card-selection-card-4', text: 'misleading', targets: [{ oid: low.oid, name: low.name }] },
    { id: 'cost-card-selection-done', text: 'misleading', targets: [] },
  ]);

  expect(reviewedForgeActions(cost)).toHaveLength(3);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 0, view: view([low, high]), decision: cost, play: play() }),
  ).toEqual({ status: 'chosen', move: 'cost-card-selection-card-4', family: 'cost-card-lowest-value' });
});

it('uses exact exert and custom target completion roles without reading labels', () => {
  const attacker = card('forge-card-41', 'Attacker', 0, '{3}{R}{R}', 4, 4);
  const exert = decision('combat-exert', [
    {
      id: 'combat-exert-card-41',
      text: 'Do not exert',
      targets: [{ oid: attacker.oid, name: attacker.name }],
    },
    { id: 'combat-exert-done', text: 'Exert everything', targets: [] },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 0, view: view(), decision: exert, play: play() }),
  ).toEqual({ status: 'chosen', move: 'combat-exert-card-41', family: 'exert-attacker' });
  expect(
    strongestForgeObservedPolicy.choose({
      seat: 0,
      view: view(),
      decision: decision('combat-exert', [{ id: 'combat-exert-done', text: 'misleading', targets: [] }]),
      play: play(),
    }),
  ).toEqual({ status: 'chosen', move: 'combat-exert-done', family: 'finish-exert' });

  const target = decision('target-selection', [
    { id: 'target-card-41', text: 'misleading', targets: [{ oid: attacker.oid, name: attacker.name }] },
    { id: 'akh-hou-targets-cancel', text: 'misleading', targets: [] },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 0, view: view(), decision: target, play: play() }),
  ).toEqual({ status: 'chosen', move: 'target-card-41', family: 'target-card' });
  expect(
    strongestForgeObservedPolicy.choose({
      seat: 0,
      view: view(),
      decision: { ...target, kind: 'repeatable-target-selection' },
      play: play(),
    }),
  ).toEqual({ status: 'chosen', move: 'target-card-41', family: 'target-card' });

  const completeTargets = decision('target-selection', [
    { id: 'akh-hou-targets-done', text: 'misleading', targets: [] },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({
      seat: 0,
      view: view(),
      decision: completeTargets,
      play: play(),
    }),
  ).toEqual({ status: 'chosen', move: 'akh-hou-targets-done', family: 'finish-targets' });

  expect(
    strongestForgeObservedPolicy.choose({
      seat: 0,
      view: view(),
      decision: decision('target-selection', [{ id: 'targets-done', text: 'malformed', targets: [] }]),
      play: play(),
    }),
  ).toMatchObject({ status: 'unsupported', family: 'target-selection' });
});

it('handles repeated campaign protocol gaps through exact bridge-owned ids', () => {
  const low = card('forge-card-4', 'Low', 0, '{1}{U}');
  const high = card('forge-card-7', 'Tragic Lesson', 0, '{5}{U}{U}');
  const genericCards = decision('card-selection', [
    { id: 'card-selection-card-4', text: 'misleading', targets: [{ oid: low.oid, name: low.name }] },
    { id: 'card-selection-card-7', text: 'misleading', targets: [{ oid: high.oid, name: high.name }] },
    { id: 'card-selection-done', text: 'misleading', targets: [] },
  ]);
  expect(reviewedForgeActions(genericCards)).toHaveLength(3);
  expect(
    strongestForgeObservedPolicy.choose({
      seat: 0,
      view: view([low, high]),
      decision: genericCards,
      play: play(),
    }),
  ).toEqual({ status: 'chosen', move: 'card-selection-card-7', family: 'card-selection-highest-value' });

  const stagedTargets = decision('target-selection', [
    { id: 'target-card-4', text: 'misleading', targets: [{ oid: low.oid, name: low.name }] },
    { id: 'djerus-renunciation-targets-done', text: 'misleading', targets: [] },
  ]);
  expect(reviewedForgeActions(stagedTargets)).toHaveLength(2);
  expect(
    strongestForgeObservedPolicy.choose({
      seat: 0,
      view: view([low]),
      decision: stagedTargets,
      play: play(),
    }),
  ).toEqual({ status: 'chosen', move: 'target-card-4', family: 'target-card' });

  const mana = decision('mana-payment', [{ id: 'mana-payment-cancel', text: 'misleading', targets: [] }]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 0, view: view(), decision: mana, play: play() }),
  ).toMatchObject({ status: 'unsupported', family: 'mana-payment' });

  const source = card('forge-card-80', 'Tragic Lesson', 0, '{2}{U}');
  const payment = decision('confirm-payment', [
    {
      id: 'confirm-payment-yes',
      text: 'misleading',
      targets: [{ oid: source.oid, name: source.name }],
    },
    {
      id: 'confirm-payment-no',
      text: 'misleading',
      targets: [{ oid: source.oid, name: source.name }],
    },
  ]);
  expect(reviewedForgeActions(payment)).toHaveLength(2);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 0, view: view(), decision: payment, play: play() }),
  ).toEqual({ status: 'chosen', move: 'confirm-payment-no', family: 'decline-unclassified-payment' });
});

it('answers every bounded decision shape retained from the Legacy Cube tuning pilot', () => {
  const source = card('forge-card-7', 'Source', 0, '{2}{G}', 2, 2);
  const redSpell = card('forge-card-8', 'Red spell', 0, '{R}{R}');
  const opposingPlaneswalker = card(
    'forge-card-46',
    'Planeswalker',
    1,
    '{2}{W}{W}',
    null,
    null,
    'Creature - Angel',
  );
  const base = view([redSpell]);
  const positionView: TableView = {
    ...base,
    seats: [
      { ...base.seats[0], battlefield: [source] },
      { ...base.seats[1], battlefield: [opposingPlaneswalker] },
    ],
  };
  const sourceTarget = { oid: source.oid, name: source.name, object: source };
  const choose = (pending: PendingDecision) =>
    strongestForgeObservedPolicy.choose({ seat: 0, view: positionView, decision: pending, play: play() });

  expect(choose(decision('target-selection', [{ id: 'target-none', text: 'ignored', targets: [] }]))).toEqual(
    {
      status: 'chosen',
      move: 'target-none',
      family: 'finish-targets',
    },
  );
  expect(
    choose(
      decision(
        'color-choice',
        ['W', 'U', 'B', 'R', 'G'].map((color) => ({
          id: `color-choice-${color}`,
          text: 'ignored',
          targets: [sourceTarget],
        })),
      ),
    ),
  ).toEqual({ status: 'chosen', move: 'color-choice-R', family: 'choose-needed-color' });
  expect(
    choose(
      decision('confirm-optional-reveal', [
        { id: 'confirm-optional-reveal-yes', text: 'ignored', targets: [sourceTarget] },
        { id: 'confirm-optional-reveal-no', text: 'ignored', targets: [sourceTarget] },
      ]),
    ),
  ).toEqual({ status: 'chosen', move: 'confirm-optional-reveal-yes', family: 'confirm-optional-reveal' });
  expect(
    choose(
      decision('confirm-explore-graveyard', [
        { id: 'confirm-explore-graveyard-yes', text: 'ignored', targets: [sourceTarget] },
        { id: 'confirm-explore-graveyard-no', text: 'ignored', targets: [sourceTarget] },
      ]),
    ),
  ).toEqual({ status: 'chosen', move: 'confirm-explore-graveyard-no', family: 'keep-explored-card' });
  expect(
    choose(
      decision('surveil-move', [
        { id: 'surveil-move-card-8', text: 'ignored', targets: [{ oid: redSpell.oid, name: redSpell.name }] },
        { id: 'surveil-move-done', text: 'ignored', targets: [] },
      ]),
    ),
  ).toEqual({ status: 'chosen', move: 'surveil-move-done', family: 'keep-surveil-cards' });
  expect(
    choose(
      decision('replacement-order', [
        { id: 'replacement-order-0', text: 'ignored', targets: [] },
        { id: 'replacement-order-1', text: 'ignored', targets: [] },
      ]),
    ),
  ).toEqual({ status: 'chosen', move: 'replacement-order-0', family: 'replacement-order' });
  expect(
    choose(
      decision('entity-selection', [
        { id: 'entity-selection-player-1', text: 'ignored', targets: [{ oid: 'forge-player-1', name: '' }] },
        {
          id: 'entity-selection-card-46',
          text: 'ignored',
          targets: [
            { oid: opposingPlaneswalker.oid, name: opposingPlaneswalker.name, object: opposingPlaneswalker },
          ],
        },
      ]),
    ),
  ).toEqual({ status: 'chosen', move: 'entity-selection-card-46', family: 'entity-selection-highest-value' });
  expect(
    choose(
      decision('entity-selection', [
        {
          id: 'entity-selection-card-46',
          text: 'ignored',
          targets: [
            { oid: opposingPlaneswalker.oid, name: opposingPlaneswalker.name, object: opposingPlaneswalker },
          ],
        },
        { id: 'entity-selection-done', text: 'ignored', targets: [] },
      ]),
    ),
  ).toEqual({ status: 'chosen', move: 'entity-selection-card-46', family: 'entity-selection-highest-value' });
  expect(
    choose(
      decision('cost-return-selection', [
        { id: 'cost-return-7', text: 'ignored', targets: [sourceTarget] },
        { id: 'cost-return-cancel', text: 'ignored', targets: [] },
      ]),
    ),
  ).toEqual({ status: 'chosen', move: 'cost-return-7', family: 'cost-return-lowest-value' });
  expect(
    choose(
      decision('cost-sacrifice-selection', [
        { id: 'cost-sacrifice-7', text: 'ignored', targets: [sourceTarget] },
        { id: 'cost-sacrifice-cancel', text: 'ignored', targets: [] },
      ]),
    ),
  ).toEqual({ status: 'chosen', move: 'cost-sacrifice-7', family: 'cost-sacrifice-lowest-value' });
  expect(
    choose(
      decision('parity-choice', [
        { id: 'parity-choice-odd', text: 'ignored', targets: [sourceTarget] },
        { id: 'parity-choice-even', text: 'ignored', targets: [sourceTarget] },
      ]),
    ),
  ).toEqual({ status: 'chosen', move: 'parity-choice-even', family: 'choose-best-parity' });
  expect(
    choose(
      decision('type-choice', [
        { id: 'type-choice-Artifact', text: 'ignored', targets: [sourceTarget] },
        { id: 'type-choice-Creature', text: 'ignored', targets: [sourceTarget] },
      ]),
    ),
  ).toEqual({ status: 'chosen', move: 'type-choice-Creature', family: 'choose-best-card-type' });
  // A creature type with a space or an apostrophe reaches the wire as a
  // hyphenated slug (Crippling Fear offers Time Lord, C'tan and Shi'ar), and
  // the reviewer reads it the way it reads a one-word type.
  expect(
    choose(
      decision('type-choice', [
        { id: 'type-choice-Time-Lord', text: 'ignored', targets: [sourceTarget] },
        { id: 'type-choice-C-tan', text: 'ignored', targets: [sourceTarget] },
        { id: 'type-choice-Creature', text: 'ignored', targets: [sourceTarget] },
      ]),
    ),
  ).toEqual({ status: 'chosen', move: 'type-choice-Creature', family: 'choose-best-card-type' });
  expect(
    choose(
      decision('type-choice', [{ id: 'type-choice-Time Lord', text: 'ignored', targets: [sourceTarget] }]),
    ).status,
  ).not.toBe('chosen');
});

it('uses a backend-validated suggestion for an open card-name decision', () => {
  const input = {
    kind: 'text' as const,
    id: 'card-name',
    label: 'Name a card',
    minLength: 1,
    maxLength: 30,
    suggestions: ['Pithing Needle'],
  };
  const pending: PendingDecision = {
    ...decision('card-name', []),
    input,
  };
  expect(
    strongestForgeObservedPolicy.choose({ seat: 0, view: view(), decision: pending, play: play() }),
  ).toEqual({
    status: 'chosen',
    move: textSubmission(input, 'Pithing Needle'),
    family: 'card-name-suggestion',
  });
});

it('exchanges a whole hand for a larger Bomat Courier exile pile only through the exact local shape', () => {
  const courier = card('forge-card-11', 'Bomat Courier', 0, '{1}', 1, 1, 'Artifact Creature - Construct');
  const hand = [card('forge-card-2', 'Forest', 0, '{1}{G}'), card('forge-card-4', 'Mountain', 0, '{3}{G}')];
  const exile = [
    card('forge-card-5', '', 0, null, 2, 2),
    card('forge-card-6', '', 0, null, 2, 2),
    card('forge-card-7', '', 0, null, 2, 2),
  ];
  const unrelatedExile = card('forge-card-8', 'Force of Will', 0, '{3}{U}{U}');
  const option = (id: string, associated = exile) => ({
    id,
    text: 'misleading',
    targets: [
      { oid: courier.oid, name: courier.name, object: courier },
      ...associated.map((object) => ({ oid: object.oid, name: '' })),
    ],
  });
  const payment = decision('cost-discard-hand-confirm', [
    option('cost-discard-hand-confirm-yes'),
    option('cost-discard-hand-confirm-no'),
  ]);
  const base = view(hand);
  const positionView: TableView = {
    ...base,
    seats: [{ ...base.seats[0], exile: [unrelatedExile, ...exile], battlefield: [courier] }, base.seats[1]],
  };

  const activation = decision('priority', [
    option('ability-11-0', exile.slice(0, 1)),
    { id: 'pass', text: 'misleading', targets: [] },
    { id: 'concede', text: 'misleading', targets: [] },
  ]);
  const activationPlay = play({
    passPriority: 'pass',
    concede: 'concede',
    objectActions: [{ oid: courier.oid, move: 'ability-11-0', category: 'ability' }],
  });
  expect(reviewedForgeActions(activation)).toEqual([
    {
      family: 'source-linked-activation',
      role: 'activate-bomat-courier',
      sourceOid: courier.oid,
      associatedExileOids: [exile[0]!.oid],
      move: 'ability-11-0',
    },
  ]);
  for (const policy of [strongestForgeObservedPolicy, forgeObservedLegalBaselinePolicy]) {
    expect(
      policy.choose({ seat: 0, view: positionView, decision: activation, play: activationPlay }),
    ).toEqual({
      status: 'chosen',
      move: 'pass',
      family: 'bomat-courier-keep-hand',
    });
  }

  const favorableActivation = decision('priority', [
    option('ability-11-0'),
    { id: 'pass', text: 'misleading', targets: [] },
    { id: 'concede', text: 'misleading', targets: [] },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({
      seat: 0,
      view: positionView,
      decision: favorableActivation,
      play: activationPlay,
    }),
  ).toEqual({
    status: 'chosen',
    move: 'ability-11-0',
    family: 'bomat-courier-exchange-hand',
  });

  expect(reviewedForgeActions(payment)).toEqual([
    {
      family: 'whole-hand-discard-payment',
      role: 'pay-whole-hand',
      sourceOid: courier.oid,
      associatedExileOids: exile.map((object) => object.oid),
      move: 'cost-discard-hand-confirm-yes',
    },
    {
      family: 'whole-hand-discard-payment',
      role: 'decline-whole-hand',
      sourceOid: courier.oid,
      associatedExileOids: exile.map((object) => object.oid),
      move: 'cost-discard-hand-confirm-no',
    },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 0, view: positionView, decision: payment, play: play() }),
  ).toEqual({
    status: 'chosen',
    move: 'cost-discard-hand-confirm-yes',
    family: 'bomat-courier-exchange-hand',
  });

  const equalPayment = decision('cost-discard-hand-confirm', [
    option('cost-discard-hand-confirm-yes', exile.slice(0, 2)),
    option('cost-discard-hand-confirm-no', exile.slice(0, 2)),
  ]);
  expect(
    strongestForgeObservedPolicy.choose({
      seat: 0,
      view: positionView,
      decision: equalPayment,
      play: play(),
    }),
  ).toEqual({
    status: 'chosen',
    move: 'cost-discard-hand-confirm-no',
    family: 'bomat-courier-keep-hand',
  });

  const malformed = [
    { ...payment, options: payment.options.slice(0, 1) },
    { ...payment, complete: false },
    {
      ...payment,
      options: payment.options.map((candidate) => ({ ...candidate, targets: [] })),
    },
    {
      ...payment,
      options: [
        payment.options[0]!,
        { ...payment.options[1]!, targets: payment.options[1]!.targets.slice(0, -1) },
      ],
    },
    {
      ...payment,
      options: payment.options.map((candidate) => ({
        ...candidate,
        targets: [
          {
            oid: 'forge-card-12',
            name: 'Bomat Courier',
            object: { ...courier, oid: 'forge-card-12', controller: 1 as const },
          },
        ],
      })),
    },
  ];
  for (const candidate of malformed) {
    expect(reviewedForgeActions(candidate)).toEqual([]);
    expect(
      strongestForgeObservedPolicy.choose({
        seat: 0,
        view: positionView,
        decision: candidate,
        play: play(),
      }),
    ).toMatchObject({ status: 'unsupported', family: 'cost-discard-hand-confirm' });
  }

  const absentSourceView: TableView = {
    ...positionView,
    seats: [{ ...positionView.seats[0], battlefield: [] }, positionView.seats[1]],
  };
  expect(
    strongestForgeObservedPolicy.choose({
      seat: 0,
      view: absentSourceView,
      decision: payment,
      play: play(),
    }),
  ).toMatchObject({ status: 'unsupported', family: 'cost-discard-hand-confirm' });
});

it('adds only favorable ordinary blocks and then commits the staged declaration', () => {
  const blocker = card('forge-card-68', 'Blocker', 0, '{2}{G}', 3, 3);
  const attacker = { ...card('forge-card-16', 'Attacker', 1, '{1}{R}', 2, 2), attacking: true };
  const battlefieldView = view();
  const positionView: TableView = {
    ...battlefieldView,
    seats: [
      { ...battlefieldView.seats[0], battlefield: [blocker] },
      { ...battlefieldView.seats[1], battlefield: [attacker] },
    ],
  };
  const blocks = decision('combat-blockers', [
    { id: 'combat-blockers-commit', text: 'misleading', targets: [] },
    {
      id: 'combat-block-add-68-16',
      text: 'misleading',
      targets: [
        { oid: blocker.oid, name: blocker.name },
        { oid: attacker.oid, name: attacker.name },
      ],
    },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({
      seat: 0,
      view: positionView,
      decision: blocks,
      play: play({
        objectActions: [{ oid: blocker.oid, move: 'combat-block-add-68-16', category: 'combat' }],
      }),
    }),
  ).toEqual({ status: 'chosen', move: 'combat-block-add-68-16', family: 'add-favorable-block' });

  const staged = decision('combat-blockers', [
    { id: 'combat-blockers-commit', text: 'misleading', targets: [] },
    {
      id: 'combat-block-remove-68-16',
      text: 'misleading',
      targets: [
        { oid: blocker.oid, name: blocker.name },
        { oid: attacker.oid, name: attacker.name },
      ],
    },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 0, view: positionView, decision: staged, play: play() }),
  ).toEqual({ status: 'chosen', move: 'combat-blockers-commit', family: 'commit-blockers' });
});

it('assigns ordinary combat damage and orders triggers by safe source value', () => {
  const source = card('forge-card-27', 'Tragic Lesson', 0, '{4}{G}', 5, 5);
  const small = card('forge-card-41', 'Small', 1, '{1}{W}', 2, 2);
  const large = card('forge-card-76', 'Large', 1, '{4}{W}', 4, 4);
  const combatView = view();
  const positionView: TableView = {
    ...combatView,
    seats: [
      { ...combatView.seats[0], battlefield: [source] },
      { ...combatView.seats[1], battlefield: [small, large] },
    ],
  };
  const damage = decision('combat-damage', [
    { id: 'combat-damage-27-card-41', text: 'misleading', targets: [{ oid: small.oid, name: small.name }] },
    { id: 'combat-damage-27-card-76', text: 'misleading', targets: [{ oid: large.oid, name: large.name }] },
    { id: 'combat-damage-later-27', text: 'misleading', targets: [] },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({
      seat: 0,
      view: positionView,
      decision: damage,
      play: play({
        objectActions: damage.options.map((option) => ({
          oid: source.oid,
          move: option.id,
          category: 'combat',
        })),
      }),
    }),
  ).toEqual({ status: 'chosen', move: 'combat-damage-27-card-76', family: 'assign-combat-damage' });

  const planeswalker = card(
    'forge-card-90',
    'Planeswalker',
    1,
    '{2}{W}{W}',
    null,
    null,
    'Legendary Planeswalker',
  );
  const defender = decision('combat-damage', [
    {
      id: 'combat-damage-27-defender',
      text: 'misleading',
      targets: [{ oid: planeswalker.oid, name: planeswalker.name }],
    },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({
      seat: 0,
      view: view(),
      decision: defender,
      play: play(),
    }),
  ).toEqual({ status: 'chosen', move: 'combat-damage-27-defender', family: 'assign-combat-damage' });

  const order = decision('trigger-order', [
    {
      id: 'trigger-order-1',
      text: 'misleading',
      targets: [{ oid: small.oid, name: small.name, object: small }],
    },
    {
      id: 'trigger-order-2',
      text: 'misleading',
      targets: [{ oid: large.oid, name: large.name, object: large }],
    },
  ]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 0, view: positionView, decision: order, play: play() }),
  ).toEqual({ status: 'chosen', move: 'trigger-order-2', family: 'order-trigger' });
});

it('keeps incomplete or structurally inconsistent expansions unsupported', () => {
  const malformed = decision('mulligan-bottom', [
    { id: 'pregame-bottom-0', text: 'misleading', targets: [] },
  ]);
  expect(reviewedForgeActions(malformed)).toEqual([]);
  expect(
    strongestForgeObservedPolicy.choose({ seat: 0, view: view(), decision: malformed, play: play() }),
  ).toMatchObject({ status: 'unsupported', family: 'mulligan-bottom' });
  expect(
    strongestForgeObservedPolicy.choose({
      seat: 0,
      view: view(),
      decision: { ...malformed, complete: false },
      play: play(),
    }),
  ).toMatchObject({ status: 'unsupported', reason: 'candidate list is incomplete' });
});
