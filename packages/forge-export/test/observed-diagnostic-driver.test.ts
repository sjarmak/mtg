import { expect, it, vi } from 'vitest';
import { textSubmission } from '@mtg/engine';
import type { ObservedSession, PendingDecision, PlayInteraction } from '@mtg/engine';
import {
  chooseObservedDiagnosticMove,
  runObservedDiagnosticSession,
} from '../src/observed/diagnostic-driver';

function position(
  options: readonly string[],
  play: Partial<PlayInteraction> = {},
  decision: Partial<PendingDecision> = {},
): ObservedSession {
  const completeDecision: PendingDecision = {
    seat: 0,
    kind: 'fixture-choice',
    prompt: 'presentation text is not policy',
    options: options.map((id) => ({ id, text: `label ${id}`, targets: [] })),
    complete: true,
    ...decision,
  };
  return {
    backend: 'fixture-diagnostic',
    determinism: 'observed',
    table: {
      content: { kind: 'printed', format: 'akh-hou' },
      seats: [
        { name: 'Local', controller: 'local', deck: { name: 'a', cards: [{ name: 'Plains', count: 40 }] } },
        { name: 'Native', controller: 'engine', deck: { name: 'b', cards: [{ name: 'Plains', count: 40 }] } },
      ],
      seed: 'fixture',
      maximumTurns: 8,
    },
    status: 'awaiting',
    view: {
      version: 4,
      turn: { number: 1, active: 0, phase: 'Main', step: 'MAIN1' },
      priority: 0,
      stack: [],
      seats: [
        {
          id: 0,
          name: 'Local',
          life: 20,
          hand: [],
          handSize: 0,
          librarySize: 33,
          graveyard: [],
          exile: [],
          battlefield: [],
        },
        {
          id: 1,
          name: 'Native',
          life: 20,
          hand: null,
          handSize: 7,
          librarySize: 33,
          graveyard: [],
          exile: [],
          battlefield: [],
        },
      ],
    },
    events: [],
    decision: completeDecision,
    play: {
      turnStep: 'precombatMain',
      passPriority: null,
      concede: null,
      objectActions: [],
      ...play,
    },
    seats: null,
    result: null,
    submitted: 0,
    localSeats: [0],
    transcript: [],
    submit: vi.fn(),
    close: vi.fn(async () => undefined),
  };
}

it('uses only backend-declared interaction roles for routine and strategic moves', () => {
  const automatic = position(['opaque-auto', 'other'], {
    automatic: { move: 'opaque-auto', reason: 'mana-payment' },
  });
  expect(chooseObservedDiagnosticMove(automatic, 'seed/0')).toEqual({
    move: 'opaque-auto',
    selection: 'automatic:mana-payment',
  });

  const cast = position(['opaque-pass', 'opaque-land', 'opaque-cast'], {
    passPriority: 'opaque-pass',
    objectActions: [
      { oid: 'land', move: 'opaque-land', category: 'play' },
      { oid: 'spell', move: 'opaque-cast', category: 'cast' },
    ],
  });
  expect(chooseObservedDiagnosticMove(cast, 'seed/1')).toEqual({
    move: 'opaque-land',
    selection: 'object:play',
  });

  const idleMana = position(
    ['opaque-pass', 'opaque-mana'],
    {
      passPriority: 'opaque-pass',
      objectActions: [{ oid: 'source', move: 'opaque-mana', category: 'mana' }],
    },
    {
      options: [
        { id: 'opaque-pass', text: 'pass', targets: [] },
        { id: 'opaque-mana', text: 'mana', targets: [{ oid: 'source', name: 'Source' }] },
      ],
    },
  );
  expect(chooseObservedDiagnosticMove(idleMana, 'seed/2')).toEqual({
    move: 'opaque-pass',
    selection: 'priority:pass',
  });
});

it('prefers a named visible card without reading labels or hidden zones', () => {
  const base = position(['cast-a', 'cast-b'], {
    objectActions: [
      { oid: 'spell-a', move: 'cast-a', category: 'cast' },
      { oid: 'spell-b', move: 'cast-b', category: 'cast' },
    ],
  });
  const card = (oid: string, name: string) => ({
    oid,
    name,
    typeLine: 'Sorcery',
    power: null,
    toughness: null,
    tapped: false,
    attacking: false,
    damage: 0,
    controller: 0 as const,
    counters: {},
  });
  const session: ObservedSession = {
    ...base,
    view: {
      ...base.view,
      seats: [
        { ...base.view.seats[0], hand: [card('spell-a', 'Repeated Card'), card('spell-b', 'New Card')] },
        base.view.seats[1],
      ],
    },
  };

  expect(chooseObservedDiagnosticMove(session, 'b')).toEqual({
    move: 'cast-a',
    selection: 'object:cast',
  });
  expect(chooseObservedDiagnosticMove(session, 'b', new Set(), new Set(['New Card']))).toEqual({
    move: 'cast-b',
    selection: 'object:cast',
  });
});

it('stages an attacker before committing the adapter-declared attack', () => {
  const add = position(['opaque-add', 'opaque-confirm'], {
    objectActions: [{ oid: 'creature', move: 'opaque-add', category: 'combat' }],
    attackers: { confirm: 'opaque-confirm', staged: [] },
  });
  expect(chooseObservedDiagnosticMove(add, 'seed')).toEqual({
    move: 'opaque-add',
    selection: 'combat:stage-attacker',
  });
  const commit = position(['opaque-remove', 'opaque-confirm'], {
    objectActions: [{ oid: 'creature', move: 'opaque-remove', category: 'combat' }],
    attackers: { confirm: 'opaque-confirm', staged: ['creature'] },
  });
  expect(chooseObservedDiagnosticMove(commit, 'seed')).toEqual({
    move: 'opaque-confirm',
    selection: 'combat:confirm',
  });

  const blockers = position(['opaque-block', 'opaque-finish'], {
    objectActions: [{ oid: 'blocker', move: 'opaque-block', category: 'combat' }],
  });
  expect(chooseObservedDiagnosticMove(blockers, 'seed')).toEqual({
    move: 'opaque-finish',
    selection: 'enumerated:opaque',
  });
});

it('prefers structured targets, never concedes, and uses backend-provided text suggestions', () => {
  const target = position(
    ['opaque-decline', 'opaque-target', 'opaque-concede'],
    { concede: 'opaque-concede' },
    {
      options: [
        { id: 'opaque-decline', text: 'decline', targets: [] },
        { id: 'opaque-target', text: 'target', targets: [{ oid: 'target', name: 'Target' }] },
        { id: 'opaque-concede', text: 'concede', targets: [] },
      ],
    },
  );
  expect(chooseObservedDiagnosticMove(target, 'seed')).toEqual({
    move: 'opaque-target',
    selection: 'enumerated:targeted',
  });
  const input = position(
    [],
    {},
    {
      input: {
        kind: 'text',
        id: 'answer',
        label: 'Name a card',
        minLength: 1,
        maxLength: 80,
        suggestions: ['Grizzly Bears'],
      },
    },
  );
  expect(chooseObservedDiagnosticMove(input, 'seed')).toEqual({
    move: textSubmission(input.decision!.input!, 'Grizzly Bears'),
    selection: 'automatic:text-suggestion',
  });
});

it('runs a bounded immutable session and retains callback observations without hidden zones', async () => {
  const first = position(['opaque-pass'], { passPriority: 'opaque-pass' });
  const second = {
    ...position(['opaque-choice']),
    submitted: 1,
    decision: { ...position(['opaque-choice']).decision!, kind: 'zone-card-selection' },
  };
  const finished: ObservedSession = {
    ...second,
    status: 'finished',
    decision: null,
    play: { ...second.play!, objectActions: [] },
    result: { winner: 1, reason: 'fixture', endedOnTurn: 3 },
    submitted: 2,
  };
  first.submit = vi.fn(async () => ({ ok: true as const, session: second }));
  second.submit = vi.fn(async () => ({ ok: true as const, session: finished }));
  const report = await runObservedDiagnosticSession(first, { seed: 'run', decisionBudget: 4 });
  expect(report.status).toBe('finished');
  expect(report.decisions.map((entry) => entry.kind)).toEqual(['fixture-choice', 'zone-card-selection']);
  expect(report.decisions.map((entry) => entry.selection)).toEqual(['priority:pass', 'enumerated:opaque']);
  expect(report.callbackCounts).toEqual({ 'fixture-choice': 1, 'zone-card-selection': 1 });
  expect(JSON.stringify(report)).not.toContain('librarySize');
  expect(JSON.stringify(report)).not.toContain('hand');
});

it('records observable and exercised card names without retaining zone snapshots', async () => {
  const base = position(['cast'], {
    objectActions: [{ oid: 'local-spell', move: 'cast', category: 'cast' }],
  });
  const visibleSpell = {
    oid: 'local-spell',
    name: 'Visible Spell',
    typeLine: 'Sorcery',
    power: null,
    toughness: null,
    tapped: false,
    attacking: false,
    damage: 0,
    controller: 0 as const,
    counters: {},
  };
  const first: ObservedSession = {
    ...base,
    view: {
      ...base.view,
      seats: [{ ...base.view.seats[0], hand: [visibleSpell] }, base.view.seats[1]],
    },
  };
  const finished: ObservedSession = {
    ...first,
    status: 'finished',
    decision: null,
    play: { ...first.play!, objectActions: [] },
    view: {
      ...first.view,
      stack: [],
      seats: [
        {
          ...first.view.seats[0],
          hand: [],
          graveyard: [
            {
              ...visibleSpell,
              oid: 'resolved-spell',
            },
          ],
        },
        first.view.seats[1],
      ],
    },
    result: { winner: 0, reason: 'fixture', endedOnTurn: 1 },
    submitted: 1,
  };
  first.submit = vi.fn(async () => ({ ok: true as const, session: finished }));

  const report = await runObservedDiagnosticSession(first, { seed: 'cards', decisionBudget: 2 });

  expect(report.cardCoverage).toEqual({
    observed: ['Visible Spell'],
    offeredActions: ['Visible Spell'],
    selectedActions: ['Visible Spell'],
  });
  expect(JSON.stringify(report)).not.toContain('local-spell');
  expect(JSON.stringify(report)).not.toContain('resolved-spell');
});

it('does not retry an action whose deterministic mana payment had to cancel', async () => {
  const priority = position(['cast', 'pass'], {
    passPriority: 'pass',
    objectActions: [{ oid: 'spell', move: 'cast', category: 'cast' }],
  });
  const mana = position(
    ['tap'],
    { automatic: { move: 'tap', reason: 'mana-payment' } },
    { kind: 'mana-payment' },
  );
  const cancel = position(['cancel'], {}, { kind: 'mana-payment' });
  const unwind = position(
    ['tap-again', 'cancel'],
    { automatic: { move: 'tap-again', reason: 'mana-payment' } },
    { kind: 'mana-payment' },
  );
  const returned = position(
    ['cast', 'pass'],
    {
      passPriority: 'pass',
      objectActions: [{ oid: 'spell', move: 'cast', category: 'cast' }],
    },
    { kind: 'priority' },
  );
  const finished: ObservedSession = {
    ...returned,
    status: 'finished',
    decision: null,
    result: { winner: 1, reason: 'fixture', endedOnTurn: 1 },
  };
  priority.submit = vi.fn(async () => ({ ok: true as const, session: mana }));
  mana.submit = vi.fn(async () => ({ ok: true as const, session: cancel }));
  cancel.submit = vi.fn(async () => ({ ok: true as const, session: unwind }));
  unwind.submit = vi.fn(async (move) => {
    expect(move).toBe('cancel');
    return { ok: true as const, session: returned };
  });
  returned.submit = vi.fn(async () => ({ ok: true as const, session: finished }));

  const report = await runObservedDiagnosticSession(priority, { seed: 'payment-loop', decisionBudget: 8 });
  expect(report.status).toBe('finished');
  expect(report.decisions.map((decision) => decision.selectedMove)).toEqual([
    'cast',
    'tap',
    'cancel',
    'cancel',
    'pass',
  ]);
});

it('does not retry a cast that returns to priority after an automatic payment path', async () => {
  const priority = position(['cast', 'pass'], {
    passPriority: 'pass',
    objectActions: [{ oid: 'spell', move: 'cast', category: 'cast' }],
  });
  const payment = position(
    ['tap'],
    { automatic: { move: 'tap', reason: 'mana-payment' } },
    { kind: 'mana-payment' },
  );
  const returned = position(
    ['cast', 'pass'],
    {
      passPriority: 'pass',
      objectActions: [{ oid: 'spell', move: 'cast', category: 'cast' }],
    },
    { kind: 'priority' },
  );
  const finished: ObservedSession = {
    ...returned,
    status: 'finished',
    decision: null,
    result: { winner: 1, reason: 'fixture', endedOnTurn: 1 },
  };
  priority.submit = vi.fn(async () => ({ ok: true as const, session: payment }));
  payment.submit = vi.fn(async () => ({ ok: true as const, session: returned }));
  returned.submit = vi.fn(async (move) => {
    expect(move).toBe('pass');
    return { ok: true as const, session: finished };
  });

  const report = await runObservedDiagnosticSession(priority, {
    seed: 'automatic-payment-loop',
    decisionBudget: 5,
  });
  expect(report.status).toBe('finished');
  expect(report.decisions.map((decision) => decision.selectedMove)).toEqual(['cast', 'tap', 'pass']);
});

it('does not retry an opaque priority action after its automatic payment cancels', async () => {
  const priority = position(['opaque-action', 'pass'], { passPriority: 'pass' }, { kind: 'priority' });
  const payment = position(
    ['tap'],
    { automatic: { move: 'tap', reason: 'mana-payment' } },
    { kind: 'mana-payment' },
  );
  const cancel = position(['cancel'], {}, { kind: 'mana-payment' });
  const returned = position(['opaque-action', 'pass'], { passPriority: 'pass' }, { kind: 'priority' });
  const finished: ObservedSession = {
    ...returned,
    status: 'finished',
    decision: null,
    result: { winner: 1, reason: 'fixture', endedOnTurn: 1 },
  };
  priority.submit = vi.fn(async () => ({ ok: true as const, session: payment }));
  payment.submit = vi.fn(async () => ({ ok: true as const, session: cancel }));
  cancel.submit = vi.fn(async () => ({ ok: true as const, session: returned }));
  returned.submit = vi.fn(async (move) => {
    expect(move).toBe('pass');
    return { ok: true as const, session: finished };
  });

  const report = await runObservedDiagnosticSession(priority, {
    seed: 'opaque-payment-loop',
    decisionBudget: 6,
  });
  expect(report.status).toBe('finished');
  expect(report.decisions.map((decision) => decision.selectedMove)).toEqual([
    'opaque-action',
    'tap',
    'cancel',
    'pass',
  ]);
});

it('stops explicitly on budget exhaustion, unsupported input, and submit failure', async () => {
  const cycling = position(['opaque']);
  cycling.submit = vi.fn(async () => ({ ok: true as const, session: cycling }));
  expect((await runObservedDiagnosticSession(cycling, { seed: 'run', decisionBudget: 1 })).status).toBe(
    'decision-budget-exhausted',
  );

  const input = position(
    [],
    {},
    {
      input: {
        kind: 'text',
        id: 'answer',
        label: 'Provide text',
        minLength: 1,
        maxLength: 80,
        suggestions: [],
      },
    },
  );
  expect((await runObservedDiagnosticSession(input, { seed: 'run', decisionBudget: 4 })).status).toBe(
    'unsupported-decision',
  );

  const failed = position(['opaque']);
  failed.submit = vi.fn(async () => ({
    ok: false as const,
    error: { kind: 'backend-failure' as const, message: 'callback exploded' },
  }));
  const report = await runObservedDiagnosticSession(failed, { seed: 'run', decisionBudget: 4 });
  expect(report.status).toBe('submit-failed');
  expect(report.error).toEqual({ kind: 'backend-failure', message: 'callback exploded' });
});
