import { createElement } from 'react';
import type { ObjectView, ObservedBackend, ObservedSession, SessionSpec } from '@mtg/engine';
import { scriptBackend } from '@mtg/engine';
import { mount } from '../../src/mount';
import { BackendGame } from '../../src/routes/play/BackendGame';

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy' },
  seats: [
    { name: 'You', controller: 'local', deck: { name: 'you', cards: [] } },
    { name: 'Bot', controller: 'engine', deck: { name: 'bot', cards: [] } },
  ],
  seed: 'ui/backend-auto-payment-browser',
  maximumTurns: null,
};

function object(oid: string, name: string, typeLine: string): ObjectView {
  return {
    oid,
    name,
    typeLine,
    power: null,
    toughness: null,
    tapped: false,
    attacking: false,
    damage: 0,
    controller: 0,
    counters: {},
  };
}

interface PaymentEvidence {
  readonly moves: string[];
}

interface ButtonLike {
  readonly textContent: string | null;
  click(): void;
}

interface BrowserLike {
  readonly document: {
    querySelectorAll(selector: string): ArrayLike<ButtonLike>;
  };
  setInterval(callback: () => void, delay: number): number;
  clearInterval(handle: number): void;
}

async function main(): Promise<void> {
  const opened = await scriptBackend({ clock: 3 }).open(TABLE);
  if (!opened.ok) throw new Error(opened.error.message);
  const base = opened.session;
  const birds = object('browser:birds:54', 'Birds of Paradise', 'Creature — Bird');
  const island = object('browser:island:61', 'Island', 'Basic Land — Island');
  const florahedron = {
    ...object('browser:florahedron:59', 'Tangled Florahedron', 'Creature — Elemental'),
    power: 1,
    toughness: 1,
  };
  const evidence: PaymentEvidence = { moves: [] };
  (globalThis as typeof globalThis & { mtgAutoPayment?: PaymentEvidence }).mtgAutoPayment = evidence;

  const final: ObservedSession = {
    ...base,
    submitted: 2,
    view: {
      ...base.view,
      seats: [
        {
          ...base.view.seats[0],
          hand: [],
          handSize: 0,
          battlefield: [birds, { ...island, tapped: true }, florahedron],
        },
        base.view.seats[1],
      ],
    },
  };
  const payment: ObservedSession = {
    ...base,
    submitted: 1,
    decision: {
      seat: 0,
      kind: 'opaque payment decision',
      prompt: 'opaque payment prompt',
      options: [
        { id: 'opaque-use-birds', text: 'first opaque source', targets: [] },
        { id: 'opaque-use-island', text: 'second opaque source', targets: [] },
      ],
      complete: true,
    },
    view: {
      ...base.view,
      seats: [
        { ...base.view.seats[0], hand: [], handSize: 0, battlefield: [birds, island] },
        base.view.seats[1],
      ],
    },
    play: {
      turnStep: 'precombatMain',
      passPriority: null,
      concede: null,
      objectActions: [
        { oid: birds.oid, move: 'opaque-use-birds', category: 'mana', manaOutput: 'U' },
        { oid: island.oid, move: 'opaque-use-island', category: 'mana', manaOutput: 'U' },
      ],
      automatic: { move: 'opaque-use-birds', reason: 'mana-payment' },
    },
    submit: (move) => {
      evidence.moves.push(move);
      return Promise.resolve({ ok: true, session: final });
    },
  };
  const priority: ObservedSession = {
    ...base,
    decision: {
      seat: 0,
      kind: 'opaque priority decision',
      prompt: 'opaque priority prompt',
      options: [
        { id: 'opaque-pass', text: 'Pass priority', targets: [] },
        { id: 'opaque-cast-florahedron', text: 'Cast Tangled Florahedron', targets: [] },
      ],
      complete: true,
    },
    view: {
      ...base.view,
      priority: 0,
      seats: [
        {
          ...base.view.seats[0],
          hand: [florahedron],
          handSize: 1,
          battlefield: [birds, island],
        },
        base.view.seats[1],
      ],
    },
    play: {
      turnStep: 'precombatMain',
      passPriority: 'opaque-pass',
      concede: null,
      objectActions: [{ oid: florahedron.oid, move: 'opaque-cast-florahedron', category: 'cast' }],
    },
    submit: (move) => {
      evidence.moves.push(move);
      return Promise.resolve({ ok: true, session: payment });
    },
  };
  const backend: ObservedBackend = {
    id: 'browser-payment-backend',
    determinism: 'observed',
    capabilities: {
      undo: false,
      fork: false,
      perSeatProjection: true,
      engineSeats: true,
    },
    supports: () => Promise.resolve([]),
    open: () => Promise.resolve({ ok: true, session: priority }),
  };

  mount('root', createElement(BackendGame, { backend, table: TABLE }));

  const browser = (globalThis as typeof globalThis & { readonly window: BrowserLike }).window;
  const press = browser.setInterval(() => {
    const card = [...Array.from(browser.document.querySelectorAll('button.mtg-card'))].find((candidate) =>
      (candidate.textContent ?? '').includes('Tangled Florahedron'),
    );
    if (card === undefined) return;
    browser.clearInterval(press);
    card.click();
  }, 10);
}

void main();
