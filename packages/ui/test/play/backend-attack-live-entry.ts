import { createElement } from 'react';
import type { ObjectView, ObservedBackend, ObservedSession, SessionSpec, SubmitResult } from '@mtg/engine';
import { scriptBackend } from '@mtg/engine';
import { mount } from '../../src/mount';
import { BackendGame } from '../../src/routes/play/BackendGame';

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy' },
  seats: [
    { name: 'You', controller: 'local', deck: { name: 'you', cards: [] } },
    { name: 'Forge bot', controller: 'engine', deck: { name: 'bot', cards: [] } },
  ],
  seed: 'ui/backend-attacker-browser',
  maximumTurns: null,
};

interface AttackEvidence {
  readonly moves: string[];
}

function creature(): ObjectView {
  return {
    oid: 'browser:battlefield:lion:7',
    name: 'Savannah Lions',
    typeLine: 'Creature — Cat',
    power: 2,
    toughness: 1,
    tapped: false,
    attacking: false,
    damage: 0,
    controller: 0,
    counters: {},
  };
}

async function main(): Promise<void> {
  const opened = await scriptBackend({ clock: 3 }).open(TABLE);
  if (!opened.ok) throw new Error(opened.error.message);
  const base = opened.session;
  const lion = creature();
  const evidence: AttackEvidence = { moves: [] };
  (globalThis as typeof globalThis & { mtgAttack?: AttackEvidence }).mtgAttack = evidence;

  const finished: ObservedSession = {
    ...base,
    submitted: 2,
    view: {
      ...base.view,
      turn: { number: 3, active: 0, phase: 'opaque combat', step: 'opaque blockers' },
      seats: [
        {
          ...base.view.seats[0],
          battlefield: [{ ...lion, tapped: true, attacking: true } as ObjectView & { attacking: boolean }],
        },
        base.view.seats[1],
      ],
    },
  };
  const commit = (move: string): Promise<SubmitResult<ObservedSession>> => {
    evidence.moves.push(move);
    return Promise.resolve({ ok: true, session: finished });
  };
  const staged: ObservedSession = {
    ...base,
    submitted: 1,
    decision: {
      seat: 0,
      kind: 'opaque combat vocabulary',
      prompt: 'opaque attacker prompt',
      options: [
        { id: 'opaque-finish-attackers', text: 'opaque finish label', targets: [] },
        {
          id: 'opaque-remove-lion',
          text: 'opaque remove label',
          targets: [{ oid: lion.oid, name: lion.name }],
        },
      ],
      complete: true,
    },
    view: {
      ...base.view,
      turn: { number: 3, active: 0, phase: 'opaque combat', step: 'opaque attackers' },
      priority: null,
      seats: [{ ...base.view.seats[0], battlefield: [lion] }, base.view.seats[1]],
    },
    play: {
      turnStep: 'declareAttackers',
      passPriority: null,
      concede: null,
      objectActions: [{ oid: lion.oid, move: 'opaque-remove-lion', category: 'combat' }],
      attackers: { confirm: 'opaque-finish-attackers', staged: [lion.oid] },
    },
    submit: commit,
  };
  const stage = (move: string): Promise<SubmitResult<ObservedSession>> => {
    evidence.moves.push(move);
    return Promise.resolve({ ok: true, session: staged });
  };
  const ready: ObservedSession = {
    ...staged,
    submitted: 0,
    decision: {
      ...staged.decision!,
      options: [
        { id: 'opaque-finish-attackers', text: 'opaque finish label', targets: [] },
        {
          id: 'opaque-add-lion',
          text: 'opaque add label',
          targets: [{ oid: lion.oid, name: lion.name }],
        },
      ],
    },
    play: {
      ...staged.play!,
      objectActions: [{ oid: lion.oid, move: 'opaque-add-lion', category: 'combat' }],
      attackers: { confirm: 'opaque-finish-attackers', staged: [] },
    },
    submit: stage,
  };
  const backend: ObservedBackend = {
    id: 'browser-attacker-backend',
    determinism: 'observed',
    capabilities: {
      undo: false,
      fork: false,
      perSeatProjection: true,
      engineSeats: true,
    },
    supports: () => Promise.resolve([]),
    open: () => Promise.resolve({ ok: true, session: ready }),
  };

  mount('root', createElement(BackendGame, { backend, table: TABLE }));
}

void main();
