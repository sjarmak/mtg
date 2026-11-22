import { expect, it, vi } from 'vitest';
import { BotEvidenceEpisodeSchema } from '@mtg/bot-evidence';
import type { ObservedBackend, ObservedSession, PendingDecision, SessionSpec, TableView } from '@mtg/engine';
import { textSubmission } from '@mtg/engine';
import { runForgeObservedPolicyGame } from '../src/observed/policy-evidence';
import { strongestForgeObservedPolicy } from '../src/observed/policy';

const DIGEST = 'a'.repeat(64);
const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    { name: 'Candidate', controller: 'local', deck: { name: 'candidate', cards: [] } },
    { name: 'Forge Default', controller: 'engine', deck: { name: 'opponent', cards: [] } },
  ],
  seed: 'heldout-game-1',
  maximumTurns: 30,
};

function view(turn = 1): TableView {
  const card = (oid: string, name: string, controller: 0 | 1) => ({
    oid,
    name,
    typeLine: 'Creature',
    power: 2,
    toughness: 2,
    tapped: false,
    attacking: false,
    damage: 0,
    controller,
    counters: {},
  });
  return {
    version: 4,
    turn: { number: turn, active: 0, phase: 'Main', step: 'MAIN1' },
    priority: 0,
    stack: [],
    seats: [
      {
        id: 0,
        name: 'Candidate',
        life: 20,
        hand: [card('own-card', 'Own Card', 0)],
        handSize: 1,
        librarySize: 39,
        graveyard: [],
        exile: [],
        battlefield: [],
      },
      {
        id: 1,
        name: 'Forge Default',
        life: 20,
        hand: [card('secret-card', 'Secret Card', 1)],
        handSize: 1,
        librarySize: 39,
        graveyard: [],
        exile: [],
        battlefield: [],
      },
    ],
  };
}

function walkingBallistaPriorityView(): TableView {
  const base = view(12);
  const source = {
    ...base.seats[1].hand![0]!,
    oid: 'forge-card-78',
    name: 'Walking Ballista',
    typeLine: 'Artifact Creature - Construct',
    counters: { P1P1: 2 },
  };
  return {
    ...base,
    turn: { number: 12, active: 1, phase: 'Declare Blockers Step', step: 'COMBAT_DECLARE_BLOCKERS' },
    priority: 0,
    stack: [source],
  };
}

function pending(kind = 'priority'): PendingDecision {
  return {
    seat: 0,
    kind,
    prompt: kind,
    options: [{ id: 'pass', text: 'Pass', targets: [] }],
    complete: true,
  };
}

function observedSession(
  decision: PendingDecision | null,
  submit: ObservedSession['submit'],
  overrides: Partial<ObservedSession> = {},
): ObservedSession {
  const currentView = view(decision === null ? 2 : 1);
  return {
    backend: 'forge-fixture',
    determinism: 'observed',
    table: TABLE,
    status: decision === null ? 'finished' : 'awaiting',
    view: currentView,
    events: [],
    decision,
    play:
      decision === null || decision.kind !== 'priority'
        ? undefined
        : { turnStep: 'precombatMain', passPriority: 'pass', concede: null, objectActions: [] },
    seats: null,
    result: decision === null ? { winner: 0, reason: 'combat damage', endedOnTurn: 2 } : null,
    submitted: decision === null ? 1 : 0,
    localSeats: [0],
    transcript: [{ seq: 0, view: currentView, events: [], move: null }],
    submit,
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

function request() {
  return {
    id: 'forge-heldout-game-1',
    runtime: { version: 'forge-2.0.14', buildSha256: DIGEST },
    subject: { formatId: 'legacy-cube-2021-08', formatSha256: DIGEST, cardsSha256: DIGEST },
    modelSha256: null,
    dataSha256: null,
    lineage: { gameId: 'forge-heldout-game-1' },
    splitGroup: { kind: 'game' as const, id: 'forge-heldout-game-1' },
  };
}

it('records safe Forge decisions, outcome, callback coverage, and cost separately', async () => {
  const finished = observedSession(null, vi.fn());
  const initial = observedSession(
    pending(),
    vi.fn(async () => ({ ok: true as const, session: finished })),
  );
  const backend: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: vi.fn(async () => []),
    open: vi.fn(async () => ({ ok: true as const, session: initial })),
  };
  const ticks = [100, 125];
  const choose = vi.fn(strongestForgeObservedPolicy.choose);

  const report = await runForgeObservedPolicyGame({
    backend,
    table: TABLE,
    candidateSeat: 0,
    policy: { identity: strongestForgeObservedPolicy.identity, choose },
    evidence: request(),
    now: () => ticks.shift() ?? 125,
  });

  expect(BotEvidenceEpisodeSchema.parse(report.evidence)).toEqual(report.evidence);
  expect(report.evidence.decisions).toHaveLength(1);
  expect(report.evidence.decisions[0]).toMatchObject({
    sequence: 0,
    candidates: { status: 'complete', values: [{ id: 'pass' }] },
    choice: { status: 'chosen', candidateId: 'pass' },
  });
  expect(JSON.stringify(report.evidence.decisions[0]?.observation.value)).not.toContain('Secret Card');
  expect(choose.mock.calls[0]?.[0].view.seats[1].hand).toBeNull();
  expect(report.evidence.outcome).toEqual({
    status: 'completed',
    value: { winner: 0, reason: 'combat damage', endedOnTurn: 2 },
  });
  expect(report.measurement).toEqual({
    candidateSeat: 0,
    completion: 'completed',
    elapsedMs: 25,
    decisions: 1,
    callbackCounts: { priority: 1 },
  });
});

it('submits a backend-provided text suggestion without an enumerated option', async () => {
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
  const finished = observedSession(null, vi.fn());
  const initial = observedSession(
    { ...pending('card-name'), options: [], input },
    vi.fn(async (submitted) => {
      expect(submitted).toBe(move);
      return { ok: true as const, session: finished };
    }),
  );
  const backend: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => ({ ok: true, session: initial }),
  };

  const report = await runForgeObservedPolicyGame({
    backend,
    table: TABLE,
    candidateSeat: 0,
    policy: strongestForgeObservedPolicy,
    evidence: request(),
  });

  expect(initial.submit).toHaveBeenCalledWith(move);
  expect(report.evidence.decisions[0]).toMatchObject({
    candidates: { status: 'incomplete', reason: 'backend decision uses non-enumerated input' },
    choice: { status: 'chosen', candidateId: move },
  });
  expect(report.evidence.outcome).toMatchObject({ status: 'completed' });
});

it('fails after Forge accepts a text answer without changing the observation', async () => {
  const suggestion = 'Pithing Needle';
  const input = {
    kind: 'text' as const,
    id: 'card-name',
    label: 'Name a card',
    minLength: 1,
    maxLength: 41,
    suggestions: [suggestion],
  };
  const repeated = observedSession(
    { ...pending('card-name'), options: [], input },
    vi.fn(async () => ({ ok: true as const, session: repeated })),
  );
  const backend: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => ({ ok: true, session: repeated }),
  };

  const report = await runForgeObservedPolicyGame({
    backend,
    table: TABLE,
    candidateSeat: 0,
    policy: strongestForgeObservedPolicy,
    evidence: request(),
  });

  expect(repeated.submit).toHaveBeenCalledTimes(1);
  expect(report.evidence.outcome).toMatchObject({
    status: 'engine-failure',
    error: expect.stringContaining('returned to the card-name observation'),
  });
});

it('keeps partial decisions and explicit unsupported outcomes', async () => {
  const initial = observedSession(pending('invented-family'), vi.fn());
  const backend: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: vi.fn(async () => []),
    open: vi.fn(async () => ({ ok: true as const, session: initial })),
  };

  const report = await runForgeObservedPolicyGame({
    backend,
    table: TABLE,
    candidateSeat: 0,
    policy: strongestForgeObservedPolicy,
    evidence: request(),
    now: () => 10,
  });

  expect(report.evidence.decisions[0]?.choice).toMatchObject({ status: 'unsupported' });
  expect(report.evidence.outcome).toMatchObject({ status: 'unsupported' });
  expect(report.measurement).toMatchObject({
    completion: 'unsupported',
    decisions: 1,
    callbackCounts: { 'invented-family': 1 },
  });
  expect(initial.close).toHaveBeenCalledOnce();
});

it('records a rejected submission on the decision that triggered it', async () => {
  const initial = observedSession(
    pending(),
    vi.fn(async () => ({
      ok: false as const,
      error: { kind: 'timeout' as const, message: 'Forge did not reply', millis: 50 },
    })),
  );
  const backend: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: vi.fn(async () => []),
    open: vi.fn(async () => ({ ok: true as const, session: initial })),
  };

  const report = await runForgeObservedPolicyGame({
    backend,
    table: TABLE,
    candidateSeat: 0,
    policy: strongestForgeObservedPolicy,
    evidence: request(),
  });

  expect(report.evidence.decisions[0]?.choice).toMatchObject({ status: 'timeout' });
  expect(report.evidence.outcome).toMatchObject({ status: 'timeout' });
  expect(report.measurement).toMatchObject({ completion: 'timeout', decisions: 1 });
  expect(initial.close).toHaveBeenCalledOnce();
});

it('excludes an accepted move when Forge returns the identical observation', async () => {
  const repeatedDecision = {
    ...pending(),
    options: [
      { id: 'ability-8-0', text: 'Abrade', targets: [] },
      { id: 'pass', text: 'Pass', targets: [] },
    ],
  } satisfies PendingDecision;
  const submitted: string[] = [];
  const finished = observedSession(null, vi.fn());
  const repeated = observedSession(
    repeatedDecision,
    vi.fn(async (move) => {
      submitted.push(move);
      return { ok: true as const, session: move === 'pass' ? finished : repeated };
    }),
    {
      play: {
        turnStep: 'upkeep',
        passPriority: 'pass',
        concede: null,
        objectActions: [{ oid: 'own-card', move: 'ability-8-0', category: 'cast' }],
      },
    },
  );
  const backend: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => ({ ok: true, session: repeated }),
  };
  const policy = {
    identity: strongestForgeObservedPolicy.identity,
    choose: (position: Parameters<typeof strongestForgeObservedPolicy.choose>[0]) => {
      const cast = position.decision.options.find((option) => option.id === 'ability-8-0');
      return cast === undefined
        ? strongestForgeObservedPolicy.choose(position)
        : { status: 'chosen' as const, move: cast.id, family: 'fixture-cast' };
    },
  };

  const report = await runForgeObservedPolicyGame({
    backend,
    table: TABLE,
    candidateSeat: 0,
    policy,
    evidence: request(),
    maximumDecisions: 4,
  });

  expect(submitted).toEqual(['ability-8-0', 'pass']);
  expect(report.evidence.decisions.map((entry) => entry.choice)).toEqual([
    { status: 'chosen', candidateId: 'ability-8-0' },
    { status: 'chosen', candidateId: 'pass' },
  ]);
  expect(report.evidence.decisions[1]?.observation.sha256).toBe(
    report.evidence.decisions[0]?.observation.sha256,
  );
  expect(report.evidence.outcome).toMatchObject({ status: 'completed' });
});

it('allows one repeated pass for a distinct identical priority callback', async () => {
  const priority = {
    ...pending(),
    options: [
      { id: 'pass', text: 'Pass priority', targets: [] },
      { id: 'concede', text: 'Concede', targets: [] },
    ],
  } satisfies PendingDecision;
  const priorityView = walkingBallistaPriorityView();
  const submitted: string[] = [];
  const finished = observedSession(null, vi.fn());
  const second = observedSession(
    priority,
    vi.fn(async (move) => {
      submitted.push(move);
      return { ok: true as const, session: finished };
    }),
    { view: priorityView },
  );
  const first = observedSession(
    priority,
    vi.fn(async (move) => {
      submitted.push(move);
      return { ok: true as const, session: second };
    }),
    { view: priorityView },
  );
  const backend: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => ({ ok: true, session: first }),
  };

  const report = await runForgeObservedPolicyGame({
    backend,
    table: TABLE,
    candidateSeat: 0,
    policy: strongestForgeObservedPolicy,
    evidence: request(),
  });

  expect(submitted).toEqual(['pass', 'pass']);
  expect(report.evidence.decisions).toHaveLength(2);
  expect(report.evidence.decisions[1]?.observation.sha256).toBe(
    report.evidence.decisions[0]?.observation.sha256,
  );
  expect(report.evidence.outcome).toMatchObject({ status: 'completed' });
});

it('fails after two accepted passes return to the identical priority callback', async () => {
  const priority = {
    ...pending(),
    options: [
      { id: 'pass', text: 'Pass priority', targets: [] },
      { id: 'concede', text: 'Concede', targets: [] },
    ],
  } satisfies PendingDecision;
  const priorityView = walkingBallistaPriorityView();
  const submitted: string[] = [];
  const repeated = observedSession(
    priority,
    vi.fn(async (move) => {
      submitted.push(move);
      return { ok: true as const, session: repeated };
    }),
    { view: priorityView },
  );
  const backend: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => ({ ok: true, session: repeated }),
  };

  const report = await runForgeObservedPolicyGame({
    backend,
    table: TABLE,
    candidateSeat: 0,
    policy: strongestForgeObservedPolicy,
    evidence: request(),
  });

  expect(submitted).toEqual(['pass', 'pass']);
  expect(report.evidence.decisions).toHaveLength(3);
  expect(report.evidence.decisions[2]?.choice).toMatchObject({
    status: 'engine-failure',
    error: expect.stringContaining('after accepting pass, pass'),
  });
  expect(report.evidence.outcome).toMatchObject({ status: 'engine-failure' });
});

it('excludes an action when canceled mana payment returns to the same priority observation', async () => {
  const priorityDecision = {
    ...pending(),
    options: [
      { id: 'ability-43-0', text: 'Ability', targets: [] },
      { id: 'pass', text: 'Pass', targets: [] },
    ],
  } satisfies PendingDecision;
  const paymentDecision = {
    ...pending('mana-payment'),
    options: [{ id: 'mana-payment-cancel', text: 'Cancel', targets: [] }],
  } satisfies PendingDecision;
  const submitted: string[] = [];
  const finished = observedSession(null, vi.fn());
  const priority = observedSession(
    priorityDecision,
    vi.fn(async (move) => {
      submitted.push(move);
      return { ok: true as const, session: move === 'pass' ? finished : payment };
    }),
    {
      play: {
        turnStep: 'precombatMain',
        passPriority: 'pass',
        concede: null,
        objectActions: [{ oid: 'own-card', move: 'ability-43-0', category: 'ability' }],
      },
    },
  );
  const payment = observedSession(
    paymentDecision,
    vi.fn(async (move) => {
      submitted.push(move);
      return { ok: true as const, session: priority };
    }),
  );
  const backend: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => ({ ok: true, session: priority }),
  };
  const policy = {
    identity: strongestForgeObservedPolicy.identity,
    choose: (position: Parameters<typeof strongestForgeObservedPolicy.choose>[0]) => {
      const ability = position.decision.options.find((option) => option.id === 'ability-43-0');
      if (ability !== undefined) {
        return { status: 'chosen' as const, move: ability.id, family: 'fixture-ability' };
      }
      const cancel = position.decision.options.find((option) => option.id === 'mana-payment-cancel');
      if (cancel !== undefined) {
        return { status: 'chosen' as const, move: cancel.id, family: 'fixture-payment' };
      }
      return strongestForgeObservedPolicy.choose(position);
    },
  };

  const report = await runForgeObservedPolicyGame({
    backend,
    table: TABLE,
    candidateSeat: 0,
    policy,
    evidence: request(),
    maximumDecisions: 5,
  });

  expect(submitted).toEqual(['ability-43-0', 'mana-payment-cancel', 'pass']);
  expect(report.evidence.decisions.map((entry) => entry.choice)).toEqual([
    { status: 'chosen', candidateId: 'ability-43-0' },
    { status: 'chosen', candidateId: 'mana-payment-cancel' },
    { status: 'chosen', candidateId: 'pass' },
  ]);
  expect(report.evidence.decisions[2]?.observation.sha256).toBe(
    report.evidence.decisions[0]?.observation.sha256,
  );
  expect(report.evidence.outcome).toMatchObject({ status: 'completed' });
});

it('does not suppress the same move after an observable state transition', async () => {
  const action = {
    ...pending(),
    options: [{ id: 'ability-8-0', text: 'Ability', targets: [] }],
  } satisfies PendingDecision;
  const finished = observedSession(null, vi.fn());
  const second = observedSession(
    action,
    vi.fn(async () => ({ ok: true as const, session: finished })),
    { view: view(2) },
  );
  const first = observedSession(
    action,
    vi.fn(async () => ({ ok: true as const, session: second })),
  );
  const backend: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => ({ ok: true, session: first }),
  };
  const choose = vi.fn(() => ({ status: 'chosen' as const, move: 'ability-8-0', family: 'fixture' }));

  const report = await runForgeObservedPolicyGame({
    backend,
    table: TABLE,
    candidateSeat: 0,
    policy: { identity: strongestForgeObservedPolicy.identity, choose },
    evidence: request(),
  });

  expect(choose).toHaveBeenCalledTimes(2);
  expect(report.evidence.outcome).toMatchObject({ status: 'completed' });
});

it('fails after one accepted no-progress move when no reviewed alternative remains', async () => {
  const onlyAction = {
    ...pending(),
    options: [{ id: 'ability-8-0', text: 'Ability', targets: [] }],
  } satisfies PendingDecision;
  const repeated = observedSession(
    onlyAction,
    vi.fn(async () => ({ ok: true as const, session: repeated })),
  );
  const backend: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => ({ ok: true, session: repeated }),
  };
  const policy = {
    identity: strongestForgeObservedPolicy.identity,
    choose: (position: Parameters<typeof strongestForgeObservedPolicy.choose>[0]) =>
      position.decision.options.length === 0
        ? { status: 'unsupported' as const, family: 'fixture', reason: 'no alternative' }
        : { status: 'chosen' as const, move: 'ability-8-0', family: 'fixture' },
  };

  const report = await runForgeObservedPolicyGame({
    backend,
    table: TABLE,
    candidateSeat: 0,
    policy,
    evidence: request(),
  });

  expect(report.evidence.decisions).toHaveLength(2);
  expect(report.evidence.decisions[1]?.choice).toMatchObject({
    status: 'engine-failure',
    error: expect.stringContaining('returned to the priority observation after accepting ability-8-0'),
  });
  expect(report.evidence.outcome).toMatchObject({ status: 'engine-failure' });
});

it('does not carry attempted moves across independent games', async () => {
  const action = {
    ...pending(),
    options: [{ id: 'ability-8-0', text: 'Ability', targets: [] }],
  } satisfies PendingDecision;
  const submitted: string[] = [];
  const backend: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: async () => [],
    open: async () => {
      const finished = observedSession(null, vi.fn());
      return {
        ok: true as const,
        session: observedSession(
          action,
          vi.fn(async (move) => {
            submitted.push(move);
            return { ok: true as const, session: finished };
          }),
        ),
      };
    },
  };
  const policy = {
    identity: strongestForgeObservedPolicy.identity,
    choose: () => ({ status: 'chosen' as const, move: 'ability-8-0', family: 'fixture' }),
  };

  for (const id of ['game-a', 'game-b']) {
    await runForgeObservedPolicyGame({
      backend,
      table: TABLE,
      candidateSeat: 0,
      policy,
      evidence: { ...request(), id, lineage: { gameId: id }, splitGroup: { kind: 'game', id } },
    });
  }

  expect(submitted).toEqual(['ability-8-0', 'ability-8-0']);
});

it('checkpoints a chosen action before submitting it to Forge', async () => {
  let releaseSubmission = (): void => undefined;
  const submissionGate = new Promise<void>((resolve) => {
    releaseSubmission = resolve;
  });
  const finished = observedSession(null, vi.fn());
  const initial = observedSession(
    pending(),
    vi.fn(async () => {
      await submissionGate;
      return { ok: true as const, session: finished };
    }),
  );
  const backend: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: vi.fn(async () => []),
    open: vi.fn(async () => ({ ok: true as const, session: initial })),
  };
  const checkpoints: unknown[] = [];

  const running = runForgeObservedPolicyGame({
    backend,
    table: TABLE,
    candidateSeat: 0,
    policy: strongestForgeObservedPolicy,
    evidence: request(),
    onCheckpoint: (checkpoint) => {
      checkpoints.push(checkpoint);
    },
  });

  await vi.waitFor(() => expect(checkpoints).toHaveLength(1));
  expect(checkpoints[0]).toMatchObject({
    episode: { id: 'forge-heldout-game-1', stage: 'gameplay' },
    decision: { sequence: 0, choice: { status: 'chosen', candidateId: 'pass' } },
    measurement: { completion: 'incomplete', decisions: 1, callbackCounts: { priority: 1 } },
  });

  releaseSubmission();
  await expect(running).resolves.toMatchObject({
    evidence: { outcome: { status: 'completed' } },
  });
});

it('records a thrown policy failure without dropping the observed decision', async () => {
  const initial = observedSession(pending(), vi.fn());
  const backend: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: vi.fn(async () => []),
    open: vi.fn(async () => ({ ok: true as const, session: initial })),
  };

  const report = await runForgeObservedPolicyGame({
    backend,
    table: TABLE,
    candidateSeat: 0,
    policy: {
      identity: strongestForgeObservedPolicy.identity,
      choose: () => {
        throw new Error('policy exploded');
      },
    },
    evidence: request(),
  });

  expect(report.evidence.decisions[0]?.choice).toEqual({
    status: 'engine-failure',
    error: 'policy exploded',
  });
  expect(report.evidence.outcome).toEqual({ status: 'engine-failure', error: 'policy exploded' });
});

it('records a thrown backend submission without dropping the policy choice context', async () => {
  const initial = observedSession(
    pending(),
    vi.fn(async () => {
      throw new Error('wire exploded');
    }),
  );
  const backend: ObservedBackend = {
    id: 'forge-fixture',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: vi.fn(async () => []),
    open: vi.fn(async () => ({ ok: true as const, session: initial })),
  };

  const report = await runForgeObservedPolicyGame({
    backend,
    table: TABLE,
    candidateSeat: 0,
    policy: strongestForgeObservedPolicy,
    evidence: request(),
  });

  expect(report.evidence.decisions[0]?.choice).toEqual({
    status: 'engine-failure',
    error: 'wire exploded',
  });
  expect(report.evidence.outcome).toEqual({ status: 'engine-failure', error: 'wire exploded' });
});

it('refuses an evaluation table that does not give exactly one local candidate seat', async () => {
  const backend = {} as ObservedBackend;
  await expect(
    runForgeObservedPolicyGame({
      backend,
      table: { ...TABLE, seats: [{ ...TABLE.seats[0], controller: 'engine' }, TABLE.seats[1]] },
      candidateSeat: 0,
      policy: strongestForgeObservedPolicy,
      evidence: request(),
    }),
  ).rejects.toThrow(/candidate seat 0 must be local/);
});
