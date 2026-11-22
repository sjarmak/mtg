// @vitest-environment jsdom
/**
 * A backend-neutral session on the same board used by every playable format.
 *
 * The adapter may omit facts the neutral projection does not carry, but it may
 * not replace the shared card, zone, stack, status, prompt, or playmat
 * components with a Legacy Cube-specific table.
 */
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ObjectView,
  ObservedBackend,
  ObservedSession,
  OpenResult,
  SessionSpec,
  SubmitResult,
} from '@mtg/engine';
import { scriptBackend, textSubmission, textValueOf } from '@mtg/engine';
import type { PrintedCardCatalogEntry } from '@mtg/printed-card';
import { BackendGame, CLOSED_SESSION_LABEL, OPENING_SESSION_LABEL, SUBMITTING_MOVE_LABEL } from '@mtg/ui';
import { automaticBackendPass } from '../../src/routes/play/backend-auto-pass';
import { automaticBackendMove } from '../../src/routes/play/backend-auto-move';
import { DENSITY_GROUP_LABEL, DENSITY_LABELS, EVERY_EVENT_LABEL } from '../../src/log/GameLog';
import { DEFAULT_AUTO_PASS, FULL_CONTROL } from '@mtg/kernel';
import { clearPreferences } from '../support/preferences';

afterEach(() => {
  cleanup();
  clearPreferences();
});

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
    { name: 'South', controller: 'engine', deck: { name: 'south', cards: [] } },
  ],
  seed: 'ui/backend-game',
  maximumTurns: null,
};

const PRINTED_SENTINEL = {
  physicalId: 'legacy-cube-2021:0001:00000000-0000-0000-0000-000000000001',
  position: 1,
  sourceName: 'projected sentinel',
  correctedName: 'projected sentinel',
  name: 'projected sentinel',
  oracleId: '00000000-0000-0000-0000-000000000002',
  scryfallId: '00000000-0000-0000-0000-000000000001',
  forgeScript: 'projected-sentinel.txt',
  forgeScriptSha256: '0'.repeat(64),
  layout: 'normal',
  manaCost: '{2}',
  manaValue: 2,
  typeLine: 'Artifact Creature',
  oracleText: 'Vigilance',
  power: '2',
  toughness: '3',
  loyalty: null,
  colors: [],
  colorIdentity: [],
  faces: [
    {
      name: 'projected sentinel',
      manaCost: '{2}',
      typeLine: 'Artifact Creature',
      oracleText: 'Vigilance',
      power: '2',
      toughness: '3',
      loyalty: null,
      colors: [],
    },
  ],
  art: {
    status: 'available',
    source: 'scryfall',
    scryfallId: '00000000-0000-0000-0000-000000000001',
    images: [
      {
        face: null,
        uris: { art_crop: 'https://cards.example/projected-sentinel-art.jpg' },
      },
    ],
  },
} satisfies PrintedCardCatalogEntry;

const MOUNTAIN_ART =
  'https://cards.scryfall.io/art_crop/front/d/d/dd9b48f1-7c3a-4b1f-9a00-7b75eb6ea831.jpg?1783941782';

function observedObject(oid: string, name: string, typeLine: string): ObjectView {
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

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: (value: T): void => {
      if (settle === undefined) throw new Error('deferred promise was not initialized');
      settle(value);
    },
  };
}

async function openedScript(clock = 3): Promise<ObservedSession> {
  const opened = await scriptBackend({ clock }).open(TABLE);
  if (!opened.ok) throw new Error(opened.error.message);
  return opened.session;
}

function backendOpening(open: () => Promise<OpenResult<ObservedSession>>): ObservedBackend {
  return {
    id: 'unfamiliar-backend-name',
    determinism: 'observed',
    capabilities: {
      undo: false,
      fork: false,
      perSeatProjection: true,
      engineSeats: true,
    },
    supports: (): Promise<readonly string[]> => Promise.resolve([]),
    open,
  };
}

function textOf(node: unknown): string {
  return (node as { readonly textContent?: string | null }).textContent ?? '';
}

function focus(node: unknown): void {
  (node as { focus(): void }).focus();
}

async function withCoarsePointer<T>(body: () => Promise<T>): Promise<T> {
  vi.stubGlobal(
    'matchMedia',
    (query: string): { matches: boolean; addEventListener: () => void; removeEventListener: () => void } => ({
      matches: query.includes('pointer: coarse'),
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
    }),
  );
  try {
    return await body();
  } finally {
    vi.unstubAllGlobals();
  }
}

interface QueryNode {
  readonly textContent?: string | null;
  getAttribute(name: string): string | null;
  closest(selector: string): QueryNode | null;
  querySelector(selector: string): QueryNode | null;
}

interface QueryRoot {
  querySelector(selector: string): QueryNode | null;
  querySelectorAll(selector: string): { readonly [index: number]: QueryNode; readonly length: number };
}

describe('the backend-neutral live table', () => {
  it('draws the official Goblin token illustration for Forge-created tokens', async () => {
    const base = await openedScript();
    const goblin: ObjectView = {
      ...observedObject('foreign:token:goblin:1', 'Goblin Token', 'Creature — Goblin'),
      power: 1,
      toughness: 1,
    };
    const session: ObservedSession = {
      ...base,
      view: {
        ...base.view,
        seats: [{ ...base.view.seats[0], battlefield: [goblin] }, base.view.seats[1]],
      },
    };
    const rendered = render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    await screen.findByLabelText("North's status");
    const token = (rendered.container as unknown as QueryRoot).querySelector(
      '[data-permanent-key="foreign:token:goblin:1"]',
    );
    expect(token?.querySelector('[data-region="art"] img')?.getAttribute('src')).toBe(
      'https://cards.scryfall.io/art_crop/front/0/e/0e67efea-8a80-42ec-8e77-07d387d933d4.jpg',
    );
    expect(token?.textContent).not.toContain('Art pending');
  });

  it('keeps the ordinary thirteen-step bar during pregame instead of drawing a backend phase strip', async () => {
    const base = await openedScript();
    const session: ObservedSession = {
      ...base,
      view: {
        ...base.view,
        turn: { ...base.view.turn, number: 0, phase: 'Pregame', step: 'PREGAME' },
      },
      play: {
        turnStep: null,
        passPriority: null,
        concede: null,
        objectActions: [],
        seatActions: [],
      },
    };
    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    await screen.findByRole('button', { name: 'Advance the clock' });
    const band = screen.getByRole('group', { name: 'Phases and stops' });
    expect((band as unknown as QueryRoot).querySelectorAll('[data-step]').length).toBe(13);
    expect((band as unknown as QueryRoot).querySelector('[aria-current="step"]')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Turn, phase, and priority' })).toBeNull();
  });

  it('mounts the complete shared play furniture instead of a backend-specific shell', async () => {
    const rendered = render(createElement(BackendGame, { backend: scriptBackend(), table: TABLE }));

    await screen.findByRole('button', { name: 'Advance the clock' });
    expect(screen.getByRole('region', { name: 'Game table' })).not.toBeNull();
    expect(screen.getByRole('region', { name: 'Game context' })).not.toBeNull();
    const sections = screen.getByRole('group', { name: 'Game context sections' });
    expect(within(sections).getByRole('button', { name: /Stack/ })).not.toBeNull();
    expect(within(sections).getByRole('button', { name: 'Info' })).not.toBeNull();
    expect(within(sections).getByRole('button', { name: 'Log' })).not.toBeNull();
    expect(screen.getByText('0 choices made')).not.toBeNull();
    expect(screen.getByRole('separator', { name: "Resize the table and North's hand" })).not.toBeNull();
    const moves = screen.getByRole('group', { name: 'Legal moves' }) as unknown as QueryRoot;
    expect(moves.querySelectorAll('.mtg-choice')).toHaveLength(2);
    expect(moves.querySelector('.mtg-btn')).toBeNull();
    const root = rendered.container as unknown as QueryRoot;
    expect(root.querySelector('.mtg-prompt__explain')).not.toBeNull();
    expect(root.querySelector('.mtg-prompt__foot')).not.toBeNull();
  });

  it.each([
    ['Play first', 'opaque-local-start'],
    ['Play second', 'opaque-engine-start'],
  ] as const)('lets the local die-roll winner choose %s', async (choice, expectedMove) => {
    const base = await openedScript();
    const mulligan: ObservedSession = {
      ...base,
      submitted: 1,
      decision: {
        seat: 0,
        kind: 'opaque opening decision',
        prompt: 'Keep these seven cards or draw a new seven.',
        options: [
          { id: 'opaque-keep', text: 'Keep this hand', targets: [] },
          { id: 'opaque-mulligan', text: 'Take a mulligan', targets: [] },
        ],
        complete: true,
      },
      play: {
        turnStep: null,
        passPriority: null,
        concede: null,
        objectActions: [],
        promptRole: 'opening-hand',
        automatic: null,
      },
    };
    let finishStart: ((result: SubmitResult<ObservedSession>) => void) | undefined;
    const chooseStart = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(
      () =>
        new Promise((resolve) => {
          finishStart = resolve;
        }),
    );
    const starting: ObservedSession = {
      ...base,
      submitted: 0,
      decision: {
        seat: 0,
        kind: 'opaque setup decision',
        prompt: 'opaque setup prompt',
        options: [
          { id: 'opaque-local-start', text: 'first opaque option', targets: [] },
          { id: 'opaque-engine-start', text: 'second opaque option', targets: [] },
        ],
        complete: true,
      },
      play: {
        turnStep: null,
        passPriority: null,
        concede: null,
        objectActions: [],
        promptRole: null,
        automatic: { move: 'opaque-local-start', reason: 'local-starts' },
      },
      submit: chooseStart,
    };

    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session: starting })),
        table: TABLE,
      }),
    );

    expect(await screen.findByText('You won the die roll')).not.toBeNull();
    expect(screen.getByText('Choose whether to play first or second.')).not.toBeNull();
    expect(chooseStart).not.toHaveBeenCalled();
    expect(screen.queryByText('first opaque option')).toBeNull();
    expect(screen.queryByText('second opaque option')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: choice }));
    expect(chooseStart).toHaveBeenCalledOnce();
    expect(chooseStart).toHaveBeenCalledWith(expectedMove);
    await act(async () => {
      finishStart?.({ ok: true, session: mulligan });
    });

    const heading = await screen.findByText('Opening hand');
    const ask = (heading as unknown as QueryNode).closest('.mtg-prompt');
    expect(ask).not.toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Game details' }) as unknown as QueryNode).getAttribute(
        'aria-expanded',
      ),
    ).toBe('true');
    expect(screen.getByRole('button', { name: 'Keep this hand' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Take a mulligan' })).not.toBeNull();
  });

  it('accepts only an offered adapter-declared routine move for the local seat', async () => {
    const base = await openedScript();
    const decision = base.decision;
    if (decision === null) throw new Error('the scripted session exposed no decision');
    const offered = decision.options[0]?.id;
    if (offered === undefined) throw new Error('the scripted decision exposed no move');
    const session = {
      decision,
      play: {
        turnStep: null,
        passPriority: null,
        concede: null,
        objectActions: [],
        automatic: { move: offered, reason: 'mana-payment' as const },
      },
    };

    expect(automaticBackendMove(session, decision.seat)).toBe(offered);
    expect(
      automaticBackendMove(
        { ...session, play: { ...session.play, automatic: { ...session.play.automatic, move: 'stale' } } },
        decision.seat,
      ),
    ).toBeNull();
    expect(automaticBackendMove(session, decision.seat === 0 ? 1 : 0)).toBeNull();
  });

  it('preserves a nonland mana source when an exact legal land payment is available', async () => {
    const base = await openedScript();
    const island = observedObject('foreign:battlefield:island:12', 'Island', 'Basic Land — Island');
    const birds = observedObject('foreign:battlefield:birds:13', 'Birds of Paradise', 'Creature — Bird');
    const payWithBirds = 'opaque-pay-with-birds';
    const payWithIsland = 'opaque-pay-with-island';
    const session = {
      decision: {
        seat: 0 as const,
        kind: 'opaque payment decision',
        prompt: 'opaque payment prompt',
        options: [
          { id: payWithBirds, text: 'first opaque source', targets: [{ oid: birds.oid, name: birds.name }] },
          {
            id: payWithIsland,
            text: 'second opaque source',
            targets: [{ oid: island.oid, name: island.name }],
          },
        ],
        complete: true,
      },
      view: {
        ...base.view,
        seats: [{ ...base.view.seats[0], battlefield: [birds, island] }, base.view.seats[1]] as const,
      },
      play: {
        turnStep: 'precombatMain' as const,
        passPriority: null,
        concede: null,
        objectActions: [
          { oid: birds.oid, move: payWithBirds, category: 'mana' as const, manaOutput: 'U' as const },
          { oid: island.oid, move: payWithIsland, category: 'mana' as const, manaOutput: 'U' as const },
        ],
        automatic: { move: payWithBirds, reason: 'mana-payment' as const },
      },
    };

    expect(automaticBackendMove(session, 0)).toBe(payWithIsland);
  });

  it('spends a single-output land before a flexible dual during automatic generic payment', async () => {
    const base = await openedScript();
    const harbor = observedObject('foreign:battlefield:harbor:19', 'Hinterland Harbor', 'Land');
    const island = observedObject('foreign:battlefield:island:20', 'Island', 'Basic Land — Island');
    const harborBlue = 'opaque-harbor-blue';
    const harborGreen = 'opaque-harbor-green';
    const islandBlue = 'opaque-island-blue';
    const session = {
      decision: {
        seat: 0 as const,
        kind: 'opaque payment decision',
        prompt: 'opaque payment prompt',
        options: [
          { id: harborBlue, text: 'first exact output', targets: [{ oid: harbor.oid, name: harbor.name }] },
          { id: harborGreen, text: 'second exact output', targets: [{ oid: harbor.oid, name: harbor.name }] },
          { id: islandBlue, text: 'third exact output', targets: [{ oid: island.oid, name: island.name }] },
        ],
        complete: true,
      },
      view: {
        ...base.view,
        seats: [{ ...base.view.seats[0], battlefield: [harbor, island] }, base.view.seats[1]] as const,
      },
      play: {
        turnStep: 'precombatMain' as const,
        passPriority: null,
        concede: null,
        objectActions: [
          { oid: harbor.oid, move: harborBlue, category: 'mana' as const, manaOutput: 'U' as const },
          { oid: harbor.oid, move: harborGreen, category: 'mana' as const, manaOutput: 'G' as const },
          { oid: island.oid, move: islandBlue, category: 'mana' as const, manaOutput: 'U' as const },
        ],
        automatic: { move: harborGreen, reason: 'mana-payment' as const },
      },
    };

    expect(automaticBackendMove(session, 0)).toBe(islandBlue);
  });

  it('keeps an already-floating payment ahead of untapped sources', async () => {
    const base = await openedScript();
    const island = observedObject('foreign:battlefield:island:14', 'Island', 'Basic Land — Island');
    const floating = 'opaque-spend-floating-blue';
    const land = 'opaque-pay-with-island';
    const session = {
      decision: {
        seat: 0 as const,
        kind: 'opaque payment decision',
        prompt: 'opaque payment prompt',
        options: [
          { id: floating, text: 'first opaque source', targets: [] },
          { id: land, text: 'second opaque source', targets: [{ oid: island.oid, name: island.name }] },
        ],
        complete: true,
      },
      view: {
        ...base.view,
        seats: [{ ...base.view.seats[0], battlefield: [island] }, base.view.seats[1]] as const,
      },
      play: {
        turnStep: 'precombatMain' as const,
        passPriority: null,
        concede: null,
        objectActions: [{ oid: island.oid, move: land, category: 'mana' as const }],
        automatic: { move: floating, reason: 'mana-payment' as const },
      },
    };

    expect(automaticBackendMove(session, 0)).toBe(floating);
  });

  it.each([
    ['Activate Island', 'mana-source-12-0-U'],
    ['Pay 2 life for a Phyrexian mana', 'mana-payment-phyrexian-life'],
  ] as const)('offers Phyrexian mana as a choice and submits %s', async (choice, expectedMove) => {
    const base = await openedScript();
    const island = observedObject('forge-card-12', 'Island', 'Basic Land — Island');
    const finished: ObservedSession = {
      ...base,
      submitted: 2,
      decision: null,
      play: {
        turnStep: 'precombatMain',
        passPriority: null,
        concede: null,
        objectActions: [],
        automatic: null,
      },
    };
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: finished }),
    );
    const session: ObservedSession = {
      ...base,
      submitted: 1,
      decision: {
        seat: 0,
        kind: 'mana-payment',
        prompt: 'Pay Phyrexian cost',
        options: [
          {
            id: 'mana-source-12-0-U',
            text: 'Activate Island',
            targets: [{ oid: island.oid, name: island.name }],
          },
          {
            id: 'mana-payment-phyrexian-life',
            text: 'Pay 2 life for a Phyrexian mana',
            targets: [],
          },
          { id: 'mana-payment-cancel', text: 'Cancel', targets: [] },
        ],
        complete: true,
      },
      view: {
        ...base.view,
        seats: [{ ...base.view.seats[0], battlefield: [island] }, base.view.seats[1]],
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: null,
        concede: null,
        objectActions: [{ oid: island.oid, move: 'mana-source-12-0-U', category: 'mana', manaOutput: 'U' }],
        automatic: null,
      },
      submit,
    };

    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    expect(await screen.findByRole('button', { name: 'Activate Island' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Pay 2 life for a Phyrexian mana' })).not.toBeNull();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: choice }));
    expect(submit).toHaveBeenCalledWith(expectedMove);
  });

  it('does not invent a land payment from an unoffered, opposing, or similarly named object', async () => {
    const base = await openedScript();
    const birds = observedObject('foreign:battlefield:birds:15', 'Birds of Paradise', 'Creature — Bird');
    const landwalker = observedObject(
      'foreign:battlefield:landwalker:16',
      'Bog-Strider Ash',
      'Creature — Treefolk Shaman',
    );
    const unofferedIsland = observedObject('foreign:battlefield:island:17', 'Island', 'Basic Land — Island');
    const opposingForest = observedObject('foreign:battlefield:forest:18', 'Forest', 'Basic Land — Forest');
    const payWithBirds = 'opaque-pay-with-birds';
    const session = {
      decision: {
        seat: 0 as const,
        kind: 'opaque payment decision',
        prompt: 'opaque payment prompt',
        options: [
          { id: payWithBirds, text: 'first opaque source', targets: [] },
          { id: 'opaque-landwalker', text: 'second opaque source', targets: [] },
          { id: 'opaque-opposing-forest', text: 'third opaque source', targets: [] },
        ],
        complete: true,
      },
      view: {
        ...base.view,
        seats: [
          {
            ...base.view.seats[0],
            battlefield: [birds, landwalker, unofferedIsland],
          },
          { ...base.view.seats[1], battlefield: [opposingForest] },
        ] as const,
      },
      play: {
        turnStep: 'precombatMain' as const,
        passPriority: null,
        concede: null,
        objectActions: [
          { oid: birds.oid, move: payWithBirds, category: 'mana' as const },
          { oid: landwalker.oid, move: 'opaque-landwalker', category: 'mana' as const },
          { oid: unofferedIsland.oid, move: 'opaque-unoffered-island', category: 'mana' as const },
          { oid: opposingForest.oid, move: 'opaque-opposing-forest', category: 'mana' as const },
        ],
        automatic: { move: payWithBirds, reason: 'mana-payment' as const },
      },
    };

    expect(automaticBackendMove(session, 0)).toBe(payWithBirds);
  });

  it('uses declared play semantics for the shared phase bar and fixed pass without reading backend words', async () => {
    const base = await openedScript();
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: base }),
    );
    const session: ObservedSession = {
      ...base,
      view: {
        ...base.view,
        turn: { ...base.view.turn, phase: 'unfamiliar phase words', step: 'unfamiliar step words' },
      },
      decision: {
        seat: 0,
        kind: 'unfamiliar decision words',
        prompt: 'Choose a game action',
        options: [
          { id: 'opaque-pass-91', text: 'An unfamiliar pass label', targets: [] },
          { id: 'opaque-concede-92', text: 'An unfamiliar concession label', targets: [] },
          { id: 'opaque-play-93', text: 'An unfamiliar action label', targets: [] },
        ],
        complete: true,
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: 'opaque-pass-91',
        concede: 'opaque-concede-92',
        objectActions: [],
      },
      submit,
    };

    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    const bar = await screen.findByRole('group', { name: 'Phases and stops' });
    expect(within(bar).getByText('Main 1')).not.toBeNull();
    expect(
      (within(bar).getByText('Main 1') as unknown as QueryNode)
        .closest('[data-step]')
        ?.getAttribute('aria-current'),
    ).toBe('step');
    fireEvent.click(screen.getByRole('button', { name: /auto-pass settings/ }));
    expect(screen.getByRole('group', { name: 'Auto-pass' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Full control' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Until end of turn' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pass' })).not.toBeNull();
    fireEvent.keyDown(bar, { key: ' ' });
    expect(submit).toHaveBeenCalledWith('opaque-pass-91');
  });

  it('passes from a focused Convoke spell without casting it or tapping its creature', async () => {
    const base = await openedScript();
    const creature = {
      ...observedObject('foreign:battlefield:elf:11', 'Elvish Mystic', 'Creature — Elf Druid'),
      power: 1,
      toughness: 1,
    };
    const convokeSpell = observedObject('foreign:hand:siege-wurm:12', 'Siege Wurm', 'Creature — Wurm');
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: base }),
    );
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'opaque priority decision',
        prompt: 'opaque priority prompt',
        options: [
          { id: 'opaque-pass', text: 'Pass priority', targets: [] },
          { id: 'opaque-cast-siege-wurm', text: 'Cast Siege Wurm', targets: [] },
        ],
        complete: true,
      },
      view: {
        ...base.view,
        priority: 0,
        seats: [
          {
            ...base.view.seats[0],
            hand: [convokeSpell],
            handSize: 1,
            battlefield: [creature],
          },
          base.view.seats[1],
        ],
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: 'opaque-pass',
        concede: null,
        objectActions: [{ oid: convokeSpell.oid, move: 'opaque-cast-siege-wurm', category: 'cast' }],
      },
      submit,
    };
    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    const spell = await screen.findByRole('button', { name: /^Siege Wurm\./ });
    const browserMayActivateSpell = fireEvent.keyDown(spell, { key: ' ' });

    expect(browserMayActivateSpell).toBe(false);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith('opaque-pass');
  });

  it('still passes with only an untapped land available', async () => {
    const base = await openedScript();
    const land = observedObject('foreign:battlefield:forest:13', 'Forest', 'Basic Land — Forest');
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: base }),
    );
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'opaque priority decision',
        prompt: 'opaque priority prompt',
        options: [
          { id: 'opaque-pass', text: 'Pass priority', targets: [] },
          { id: 'opaque-use-forest', text: 'Add green mana', targets: [] },
        ],
        complete: true,
      },
      view: {
        ...base.view,
        priority: 0,
        seats: [{ ...base.view.seats[0], hand: [], handSize: 0, battlefield: [land] }, base.view.seats[1]],
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: 'opaque-pass',
        concede: null,
        objectActions: [{ oid: land.oid, move: 'opaque-use-forest', category: 'mana', manaOutput: 'G' }],
      },
      submit,
    };
    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    const phaseBar = await screen.findByRole('group', { name: 'Phases and stops' });
    fireEvent.keyDown(phaseBar, { key: ' ' });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith('opaque-pass');
  });

  it('auto-passes an unstopped declared priority but preserves full control and configured stops', () => {
    const view = {
      version: 4 as const,
      turn: { number: 1, active: 0 as const, phase: 'opaque', step: 'opaque' },
      priority: 0 as const,
      stack: [],
      seats: [
        {
          id: 0 as const,
          name: 'North',
          life: 20,
          hand: [],
          handSize: 0,
          librarySize: 0,
          graveyard: [],
          exile: [],
          battlefield: [],
        },
        {
          id: 1 as const,
          name: 'South',
          life: 20,
          hand: null,
          handSize: 0,
          librarySize: 0,
          graveyard: [],
          exile: [],
          battlefield: [],
        },
      ] as const,
    };
    const decision = {
      seat: 0 as const,
      kind: 'opaque',
      prompt: 'opaque',
      options: [
        { id: 'pass-opaque', text: 'opaque', targets: [] },
        { id: 'concede-opaque', text: 'opaque', targets: [] },
        { id: 'play-opaque', text: 'opaque', targets: [] },
      ],
      complete: true,
    };
    const session = {
      view,
      decision,
      play: {
        turnStep: 'upkeep' as const,
        passPriority: 'pass-opaque',
        concede: 'concede-opaque',
        objectActions: [],
      },
    };

    expect(automaticBackendPass(session, 0, DEFAULT_AUTO_PASS)).toBe('pass-opaque');
    expect(automaticBackendPass(session, 0, FULL_CONTROL)).toBeNull();
    expect(
      automaticBackendPass(
        { ...session, play: { ...session.play, turnStep: 'precombatMain' } },
        0,
        DEFAULT_AUTO_PASS,
      ),
    ).toBeNull();
    expect(
      automaticBackendPass(
        {
          ...session,
          view: {
            ...view,
            stack: [
              {
                oid: 'opaque-stack-object',
                name: 'opaque stack object',
                typeLine: 'opaque',
                power: null,
                toughness: null,
                tapped: false,
                attacking: false,
                damage: 0,
                controller: 1,
                counters: {},
              },
            ],
          },
        },
        0,
        DEFAULT_AUTO_PASS,
      ),
    ).toBeNull();
    expect(
      automaticBackendPass(
        {
          ...session,
          play: {
            ...session.play,
            objectActions: [{ oid: 'opaque-mana-source', move: 'play-opaque', category: 'mana' }],
          },
          view: {
            ...view,
            stack: [
              {
                oid: 'opaque-stack-object',
                name: 'opaque stack object',
                typeLine: 'opaque',
                power: null,
                toughness: null,
                tapped: false,
                attacking: false,
                damage: 0,
                controller: 1,
                counters: {},
              },
            ],
          },
        },
        0,
        DEFAULT_AUTO_PASS,
      ),
    ).toBe('pass-opaque');
    expect(
      automaticBackendPass(
        {
          ...session,
          play: {
            ...session.play,
            objectActions: [{ oid: 'opaque-response', move: 'play-opaque', category: 'ability' }],
          },
          view: {
            ...view,
            stack: [
              {
                oid: 'opaque-stack-object',
                name: 'opaque stack object',
                typeLine: 'opaque',
                power: null,
                toughness: null,
                tapped: false,
                attacking: false,
                damage: 0,
                controller: 1,
                counters: {},
              },
            ],
          },
        },
        0,
        DEFAULT_AUTO_PASS,
      ),
    ).toBeNull();
    expect(
      automaticBackendPass(
        {
          ...session,
          decision: { ...decision, options: decision.options.slice(0, 2) },
          play: { ...session.play, turnStep: 'precombatMain' },
        },
        0,
        DEFAULT_AUTO_PASS,
      ),
    ).toBeNull();
    expect(automaticBackendPass({ ...session, play: undefined }, 0, DEFAULT_AUTO_PASS)).toBeNull();
  });

  it('uses shared second-person grammar for a declared local priority', async () => {
    const base = await openedScript();
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'foreign-priority-vocabulary',
        prompt: 'You has priority',
        options: [{ id: 'opaque-pass', text: 'Pass priority', targets: [] }],
        complete: true,
      },
      view: {
        ...base.view,
        turn: { number: 1, active: 0, phase: 'opaque-main', step: 'opaque-main' },
        priority: 0,
        seats: [
          { ...base.view.seats[0], name: 'You' },
          { ...base.view.seats[1], name: 'Forge bot' },
        ],
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: 'opaque-pass',
        concede: null,
        objectActions: [],
      },
    };

    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    expect(await screen.findByText('You have priority')).not.toBeNull();
    expect(screen.queryByText('You has priority')).toBeNull();
  });

  it.each([
    ['AllOpponentsLost', 0, 'You win on turn 17: all opponents lost'],
    ['Draw', null, 'Game drawn on turn 17: no player won'],
    ['WinsGameSpellEffect', 1, 'Forge bot wins on turn 17: a spell or ability won the game'],
    ['AllHumansLost', 1, 'Forge bot wins on turn 17: all human players lost'],
    ['AllOpposingTeamsLost', 1, 'Forge bot wins on turn 17: all opposing teams lost'],
    ['BackendStoppedUnexpectedly', 1, 'Forge bot wins on turn 17: backend stopped unexpectedly'],
  ] as const)('renders the backend result reason %s in English', async (reason, winner, expected) => {
    const base = await openedScript();
    const session: ObservedSession = {
      ...base,
      status: 'finished',
      decision: null,
      result: { winner, reason, endedOnTurn: 17 },
      view: {
        ...base.view,
        seats: [
          { ...base.view.seats[0], name: 'You' },
          { ...base.view.seats[1], name: 'Forge bot' },
        ],
      },
    };

    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    await waitFor(() => {
      expect(screen.getAllByRole('status').some((node) => textOf(node) === expected)).toBe(true);
    });
  });

  it('uses second-person grammar for the local seat without rewriting opponent event text', async () => {
    const base = await openedScript();
    const session: ObservedSession = {
      ...base,
      events: [
        { seq: 0, type: 'opaque-keep', text: 'Forge bot has kept', detail: {}, reveals: [] },
        { seq: 1, type: 'opaque-keep', text: 'You has kept', detail: {}, reveals: [] },
        {
          seq: 2,
          type: 'opaque-rules-text',
          text: 'A permanent has protection from you',
          detail: {},
          reveals: [],
        },
      ],
      view: {
        ...base.view,
        seats: [
          { ...base.view.seats[0], name: 'You' },
          { ...base.view.seats[1], name: 'Forge bot' },
        ],
      },
    };

    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    expect(await screen.findByText('You have kept')).not.toBeNull();
    expect(screen.queryByText('You has kept')).toBeNull();
    expect(screen.getByText('Forge bot has kept')).not.toBeNull();
    expect(screen.getByText('A permanent has protection from you')).not.toBeNull();
  });

  it('offers story, detail, and the complete raw backend event list', async () => {
    const base = await openedScript();
    const events = Array.from({ length: 120 }, (_, seq) => ({
      seq,
      type: `opaque-${String(seq)}`,
      text: `Backend event ${String(seq + 1)}`,
      detail: {},
      reveals: [],
    }));
    const session: ObservedSession = { ...base, events };

    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    const group = await screen.findByRole('group', { name: DENSITY_GROUP_LABEL });
    expect(within(group).getAllByRole('button')).toHaveLength(3);
    expect(within(group).getByRole('button', { name: DENSITY_LABELS.story, pressed: true })).not.toBeNull();
    expect(screen.queryByText('Backend event 1')).toBeNull();
    expect(screen.getByText('Backend event 120')).not.toBeNull();

    fireEvent.click(within(group).getByRole('button', { name: DENSITY_LABELS.detail }));
    expect(screen.queryByText('Backend event 1')).toBeNull();
    expect(screen.getByText('Backend event 21')).not.toBeNull();

    fireEvent.click(within(group).getByRole('button', { name: EVERY_EVENT_LABEL }));
    expect(screen.getByText('Backend event 1')).not.toBeNull();
    expect(screen.getByText('nothing hidden')).not.toBeNull();
  });

  it('draws the private hand contents carried by a projected event', async () => {
    const base = await openedScript();
    const session: ObservedSession = {
      ...base,
      events: [
        {
          seq: 0,
          type: 'Private reveal',
          text: "You looked at Forge bot's hand: Forest, Giant Growth",
          detail: {},
          reveals: [
            { oid: 'forge-card-41', seats: [0] },
            { oid: 'forge-card-42', seats: [0] },
          ],
        },
      ],
    };

    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    expect(await screen.findByText("You looked at Forge bot's hand: Forest, Giant Growth")).not.toBeNull();
  });

  it('draws only projected facts and submits the exact move id behind a rendered option', async () => {
    const onNewGame = vi.fn();
    const base = await openedScript(2);
    const advanced = await base.submit('advance');
    if (!advanced.ok) throw new Error(advanced.error.message);
    const submitted = deferred<SubmitResult<ObservedSession>>();
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() => submitted.promise);
    const permanent: ObjectView = {
      oid: 'foreign:permanent:7',
      name: 'projected sentinel',
      typeLine: 'Artifact Creature',
      power: 2,
      toughness: 3,
      tapped: true,
      attacking: false,
      damage: 1,
      controller: 0,
      counters: { charge: 2 },
    };
    const opening: ObservedSession = {
      ...base,
      decision: base.decision === null ? null : { ...base.decision, complete: false },
      view: {
        ...base.view,
        stack: [{ ...permanent, oid: 'foreign:spell:8', name: 'projected spell' }],
        seats: [
          {
            ...base.view.seats[0],
            battlefield: [permanent],
            graveyard: [{ ...permanent, oid: 'foreign:grave:9', name: 'projected relic' }],
            exile: [{ ...permanent, oid: 'foreign:exile:10', name: 'projected memory' }],
          },
          base.view.seats[1],
        ],
      },
      submit,
    };
    const rendered = render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session: opening })),
        table: TABLE,
        printedCards: [PRINTED_SENTINEL],
        onNewGame,
      }),
    );

    expect(textOf(screen.getByRole('status'))).toBe(OPENING_SESSION_LABEL);
    const advance = await screen.findByRole('button', { name: 'Advance the clock' });
    const dom = rendered.container as unknown as QueryRoot;
    expect(dom.querySelector('[aria-label="Game table"] .mtg-board')).not.toBeNull();
    expect(dom.querySelector('[aria-label="Game table"] .mtg-board__lanes')).not.toBeNull();
    expect(screen.queryByRole('group', { name: 'Turn, phase, and priority' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Phases and stops' })).toBeNull();
    expect(screen.getByText('main · main')).not.toBeNull();
    expect(screen.getByLabelText("North's status")).not.toBeNull();
    expect(screen.getByLabelText("South's status")).not.toBeNull();
    expect(dom.querySelectorAll('[aria-label="Game table"] .mtg-card').length).toBeGreaterThanOrEqual(4);

    const sentinel = dom.querySelector('[data-size="board"][data-presentation="printed-card"]');
    expect(sentinel).not.toBeNull();
    expect(sentinel?.getAttribute('aria-label')).toBe(
      'projected sentinel. Mana cost {2}. Artifact Creature. 2/3.',
    );
    expect(dom.querySelector('[data-tapped="true"] [data-size="board"]')).not.toBeNull();
    expect(dom.querySelector('img[src="https://cards.example/projected-sentinel-art.jpg"]')).not.toBeNull();
    expect(dom.querySelectorAll('.mtg-art[data-art-state="pending"]').length).toBeGreaterThanOrEqual(3);
    expect(dom.querySelector('.mtg-printed-card-image')).toBeNull();
    expect(screen.getAllByText('Art pending').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByLabelText('2 charge counters.')).not.toBeNull();
    expect(screen.getByLabelText('1 damage marked against 3 toughness; 2 more is lethal.')).not.toBeNull();
    expect(screen.getByLabelText('Stack')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'North graveyard, 1 card' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'North exile, 1 card' })).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Legal moves' })).not.toBeNull();
    expect(
      screen.getByText('The backend capped this enumeration, so some legal moves are not listed.'),
    ).not.toBeNull();

    fireEvent.click(advance);
    expect(submit).toHaveBeenCalledWith('advance');
    expect(textOf(await screen.findByText(SUBMITTING_MOVE_LABEL))).toBe(SUBMITTING_MOVE_LABEL);
    await act(async () => {
      submitted.resolve(advanced);
      await submitted.promise;
    });

    expect(await screen.findByText('South, advance the clock or concede')).not.toBeNull();
    expect(screen.getByText('main · main')).not.toBeNull();
    expect(screen.queryByRole('group', { name: 'Turn, phase, and priority' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Concede' }));
    await waitFor(() => {
      expect(
        screen.getAllByRole('status').some((node) => textOf(node) === 'North wins on turn 2: concession'),
      ).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    expect(onNewGame).toHaveBeenCalledOnce();
  });

  it('plays a uniquely named land from its shared-board card and supplies pinned basic-land art', async () => {
    const base = await openedScript();
    const submitted = deferred<SubmitResult<ObservedSession>>();
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() => submitted.promise);
    const mountain = observedObject('foreign:hand:mountain:7', 'Mountain', 'Basic Land — Mountain');
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'foreign-priority-vocabulary',
        prompt: 'Choose a game action',
        options: [
          { id: 'opaque-pass', text: 'Pass priority', targets: [] },
          { id: 'opaque-land-7', text: 'Play Mountain', targets: [] },
        ],
        complete: true,
      },
      view: {
        ...base.view,
        turn: { number: 4, active: 0, phase: 'COMBAT', step: 'COMBAT_DAMAGE' },
        priority: 0,
        seats: [{ ...base.view.seats[0], hand: [mountain], handSize: 1 }, base.view.seats[1]],
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: 'opaque-pass',
        concede: null,
        objectActions: [{ oid: mountain.oid, move: 'opaque-land-7', category: 'play' }],
      },
      submit,
    };
    const rendered = render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    const land = await screen.findByRole('button', {
      name: 'Mountain. Basic Land — Mountain. Produces red mana.',
    });
    const slot = (land as unknown as QueryNode).closest('[data-permanent-key="foreign:hand:mountain:7"]');
    expect(slot).not.toBeNull();
    const root = rendered.container as unknown as QueryRoot;
    expect(root.querySelector(`img[src="${MOUNTAIN_ART}"]`)).not.toBeNull();
    const turnBand = screen.getByRole('group', { name: 'Phases and stops' });
    expect(
      (within(turnBand).getByText('Main 1') as unknown as QueryNode)
        .closest('[data-step]')
        ?.getAttribute('aria-current'),
    ).toBe('step');
    expect(screen.getByText('Play', { selector: '.mtg-choices__group-title' })).not.toBeNull();
    expect(screen.queryByText('Other', { selector: '.mtg-choices__group-title' })).toBeNull();

    fireEvent.click(land);
    expect(submit).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', {
        name: 'Mountain. Basic Land — Mountain. Produces red mana.',
      }),
    ).toBeNull();
    expect(
      (rendered.container as unknown as QueryRoot).querySelector(
        '[data-permanent-key="foreign:hand:mountain:7"]',
      ),
    ).not.toBeNull();
    expect(submit).toHaveBeenCalledWith('opaque-land-7');
    expect(textOf(await screen.findByText(SUBMITTING_MOVE_LABEL))).toBe(SUBMITTING_MOVE_LABEL);
  });

  it('adds mana from a single-output land through the ordinary battlefield click', async () => {
    const base = await openedScript();
    const forest = observedObject('foreign:battlefield:forest:8', 'Forest', 'Basic Land — Forest');
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: base }),
    );
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'opaque priority decision',
        prompt: 'opaque priority prompt',
        options: [
          { id: 'opaque-pass', text: 'Pass', targets: [] },
          {
            id: 'opaque-forest-green',
            text: 'Activate Forest for green',
            targets: [{ oid: forest.oid, name: forest.name }],
          },
        ],
        complete: true,
      },
      view: {
        ...base.view,
        priority: 0,
        seats: [{ ...base.view.seats[0], battlefield: [forest] }, base.view.seats[1]],
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: 'opaque-pass',
        concede: null,
        objectActions: [{ oid: forest.oid, move: 'opaque-forest-green', category: 'mana', manaOutput: 'G' }],
      },
      submit,
    };
    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Forest\./ }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith('opaque-forest-green'));
  });

  it('stages and confirms an attacker through the ordinary combat band without opening legal moves', async () => {
    const base = await openedScript();
    const lion = {
      ...observedObject('foreign:battlefield:lion:7', 'Savannah Lions', 'Creature — Cat'),
      power: 2,
      toughness: 1,
    };
    const continued = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: base }),
    );
    const afterAttack: ObservedSession = {
      ...base,
      submitted: 2,
      decision: {
        seat: 0,
        kind: 'opaque priority vocabulary',
        prompt: 'opaque priority prompt',
        options: [{ id: 'opaque-pass-after-attack', text: 'opaque pass label', targets: [] }],
        complete: true,
      },
      view: {
        ...base.view,
        turn: { number: 3, active: 0, phase: 'opaque combat', step: 'opaque attackers' },
        priority: 0,
        seats: [
          {
            ...base.view.seats[0],
            battlefield: [{ ...lion, tapped: true, attacking: true }],
          },
          base.view.seats[1],
        ],
      },
      play: {
        turnStep: 'declareAttackers',
        passPriority: 'opaque-pass-after-attack',
        concede: null,
        objectActions: [],
      },
      submit: continued,
    };
    const committed = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: afterAttack }),
    );
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
      submit: committed,
    };
    const stage = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: staged }),
    );
    const ready: ObservedSession = {
      ...staged,
      submitted: 0,
      decision: {
        ...staged.decision!,
        options: [
          { id: 'opaque-finish-attackers', text: 'opaque finish label', targets: [] },
          { id: 'opaque-add-lion', text: 'opaque add label', targets: [{ oid: lion.oid, name: lion.name }] },
        ],
      },
      play: {
        ...staged.play!,
        objectActions: [{ oid: lion.oid, move: 'opaque-add-lion', category: 'combat' }],
        attackers: { confirm: 'opaque-finish-attackers', staged: [] },
      },
      submit: stage,
    };
    const rendered = render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session: ready })),
        table: TABLE,
      }),
    );

    const card = await screen.findByRole('button', { name: /^Savannah Lions\./ });
    expect(screen.getByRole('button', { name: 'No attacks' })).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Current ask' })).toBeNull();
    fireEvent.click(card);
    await waitFor(() => expect(stage).toHaveBeenCalledWith('opaque-add-lion'));
    const confirm = await screen.findByRole('button', { name: 'Attack with 1' });
    expect(
      (rendered.container as unknown as QueryRoot).querySelector('[data-state="staged"]'),
    ).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Current ask' })).toBeNull();
    fireEvent.click(confirm);
    expect(committed).toHaveBeenCalledWith('opaque-finish-attackers');
    expect(await screen.findByText('Attackers declared')).not.toBeNull();
    expect(screen.getByText('North is attacking with 1 creature.')).not.toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Pass' }) as unknown as QueryNode).getAttribute('disabled'),
    ).not.toBeNull();
    expect(continued).not.toHaveBeenCalled();
    const declared = (rendered.container as unknown as QueryRoot).querySelector('[data-state="declared"]');
    expect(declared).not.toBeNull();
    expect(declared?.querySelector('[data-tapped="true"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(continued).toHaveBeenCalledWith('opaque-pass-after-attack');
  });

  it('casts from the hand click, pays with a declared mana source, and keeps lands in the shared land row', async () => {
    const base = await openedScript();
    const forest = observedObject('foreign:battlefield:forest:8', 'Forest', 'Basic Land — Forest');
    const bear = {
      ...observedObject('foreign:hand:bear:9', 'Grizzly Bears', 'Creature — Bear'),
      power: 2,
      toughness: 2,
    };
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
            battlefield: [{ ...forest, tapped: true }, bear],
          },
          base.view.seats[1],
        ],
      },
    };
    const pay = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: final }),
    );
    const payment: ObservedSession = {
      ...base,
      submitted: 1,
      decision: {
        seat: 0,
        kind: 'opaque payment decision',
        prompt: 'opaque payment prompt',
        options: [
          { id: 'opaque-use-forest', text: 'Use Forest', targets: [{ oid: forest.oid, name: forest.name }] },
          { id: 'opaque-cancel-payment', text: 'Cancel', targets: [] },
        ],
        complete: true,
      },
      view: {
        ...base.view,
        seats: [{ ...base.view.seats[0], hand: [], handSize: 0, battlefield: [forest] }, base.view.seats[1]],
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: null,
        concede: null,
        objectActions: [{ oid: forest.oid, move: 'opaque-use-forest', category: 'mana' }],
        automatic: { move: 'opaque-use-forest', reason: 'mana-payment' },
      },
      submit: pay,
    };
    const cast = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: payment }),
    );
    const priority: ObservedSession = {
      ...base,
      submitted: 0,
      decision: {
        seat: 0,
        kind: 'opaque priority decision',
        prompt: 'opaque priority prompt',
        options: [
          { id: 'opaque-pass', text: 'Pass', targets: [] },
          { id: 'opaque-cast-bear', text: 'Cast Grizzly Bears', targets: [] },
        ],
        complete: true,
      },
      view: {
        ...base.view,
        priority: 0,
        seats: [
          { ...base.view.seats[0], hand: [bear], handSize: 1, battlefield: [forest] },
          base.view.seats[1],
        ],
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: 'opaque-pass',
        concede: null,
        objectActions: [{ oid: bear.oid, move: 'opaque-cast-bear', category: 'cast' }],
      },
      submit: cast,
    };
    const rendered = render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session: priority })),
        table: TABLE,
      }),
    );

    const card = await screen.findByRole('button', { name: /^Grizzly Bears\./ });
    expect(screen.getByText('Cast Grizzly Bears')).not.toBeNull();
    fireEvent.click(card);
    await waitFor(() => {
      expect(cast).toHaveBeenCalledWith('opaque-cast-bear');
      expect(pay).toHaveBeenCalledWith('opaque-use-forest');
    });

    const root = rendered.container as unknown as QueryRoot;
    const land = root.querySelector(`[data-permanent-key="${forest.oid}"]`);
    const creature = root.querySelector(`[data-permanent-key="${bear.oid}"]`);
    expect(land?.closest('.mtg-lands')).not.toBeNull();
    expect(land?.closest('.mtg-board__spells')).toBeNull();
    expect(creature?.closest('.mtg-board__spells')).not.toBeNull();
  });

  it('routes an offered backend mana take-back through the shared priority control', async () => {
    const base = await openedScript();
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: base }),
    );
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'opaque priority decision',
        prompt: 'opaque priority prompt',
        options: [
          { id: 'opaque-pass', text: 'Pass', targets: [] },
          { id: 'opaque-undo-mana', text: 'Take back mana', targets: [] },
        ],
        complete: true,
      },
      view: { ...base.view, priority: 0 },
      play: {
        turnStep: 'precombatMain',
        passPriority: 'opaque-pass',
        concede: null,
        undo: 'opaque-undo-mana',
        manaPools: [
          { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
          { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ],
        objectActions: [],
      },
      submit,
    };
    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    const undo = await screen.findByRole('button', { name: 'Take back' });
    expect(screen.getByRole('img', { name: 'Mana pool: 1 floating' })).not.toBeNull();
    fireEvent.click(undo);
    await waitFor(() => expect(submit).toHaveBeenCalledWith('opaque-undo-mana'));
  });

  it('keeps the shared take-back visible after a commit boundary and states why it refuses', async () => {
    const base = await openedScript();
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>();
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'opaque priority decision',
        prompt: 'opaque priority prompt',
        options: [{ id: 'opaque-pass', text: 'Pass', targets: [] }],
        complete: true,
      },
      view: { ...base.view, priority: 0 },
      play: {
        turnStep: 'precombatMain',
        passPriority: 'opaque-pass',
        concede: null,
        manaPools: [
          { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
          { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ],
        objectActions: [],
      },
      submit,
    };
    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    const undo = await screen.findByRole('button', { name: 'Take back' });
    expect((undo as unknown as QueryNode).getAttribute('data-available')).toBe('false');
    fireEvent.click(undo);

    expect(textOf(screen.getByRole('alert'))).toContain(
      'Completed actions and priority passes cannot be undone',
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it('does not let take-back race an in-flight backend move', async () => {
    const base = await openedScript();
    const submitted = deferred<SubmitResult<ObservedSession>>();
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() => submitted.promise);
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'opaque priority decision',
        prompt: 'opaque priority prompt',
        options: [{ id: 'opaque-pass', text: 'Pass', targets: [] }],
        complete: true,
      },
      view: { ...base.view, priority: 0 },
      play: {
        turnStep: 'precombatMain',
        passPriority: 'opaque-pass',
        concede: null,
        objectActions: [],
      },
      submit,
    };
    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Pass' }));
    expect(submit).toHaveBeenCalledOnce();
    expect(screen.queryByText(SUBMITTING_MOVE_LABEL)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Take back' }));

    expect(submit, 'take-back cannot dispatch a second move while one is in flight').toHaveBeenCalledOnce();
    await act(async () => submitted.resolve({ ok: true, session: base }));
  });

  it('keeps a flexible creature untapped when the cast can finish paying with a land', async () => {
    const base = await openedScript();
    const birds = observedObject('foreign:battlefield:birds:54', 'Birds of Paradise', 'Creature — Bird');
    const island = observedObject('foreign:battlefield:island:61', 'Island', 'Basic Land — Island');
    const florahedron = {
      ...observedObject('foreign:hand:florahedron:59', 'Tangled Florahedron', 'Creature — Elemental'),
      power: 1,
      toughness: 1,
    };
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
    const pay = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: final }),
    );
    const payment: ObservedSession = {
      ...base,
      submitted: 1,
      decision: {
        seat: 0,
        kind: 'opaque payment decision',
        prompt: 'opaque payment prompt',
        options: [
          {
            id: 'opaque-use-birds',
            text: 'first opaque source',
            targets: [{ oid: birds.oid, name: birds.name }],
          },
          {
            id: 'opaque-use-island',
            text: 'second opaque source',
            targets: [{ oid: island.oid, name: island.name }],
          },
          { id: 'opaque-cancel-payment', text: 'Cancel', targets: [] },
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
      submit: pay,
    };
    const cast = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: payment }),
    );
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
          { ...base.view.seats[0], hand: [florahedron], handSize: 1, battlefield: [birds, island] },
          base.view.seats[1],
        ],
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: 'opaque-pass',
        concede: null,
        objectActions: [{ oid: florahedron.oid, move: 'opaque-cast-florahedron', category: 'cast' }],
      },
      submit: cast,
    };
    const rendered = render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session: priority })),
        table: TABLE,
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Tangled Florahedron\./ }));
    await waitFor(() => expect(pay).toHaveBeenCalledWith('opaque-use-island'));

    const root = rendered.container as unknown as QueryRoot;
    expect(root.querySelector(`[data-permanent-key="${birds.oid}"]`)?.getAttribute('data-tapped')).toBe(
      'false',
    );
    expect(root.querySelector(`[data-permanent-key="${island.oid}"]`)?.getAttribute('data-tapped')).toBe(
      'true',
    );
  });

  it('opens the shared card-local picker for multiple declared actions without hiding the complete rail', async () => {
    const base = await openedScript();
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>();
    const first = observedObject('foreign:hand:mountain:1', 'Mountain', 'Basic Land — Mountain');
    const second = observedObject('foreign:hand:mountain:2', 'Mountain', 'Basic Land — Mountain');
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'foreign-priority-vocabulary',
        prompt: 'Choose a game action',
        options: [
          { id: 'opaque-land-a', text: 'First Mountain action', targets: [] },
          { id: 'opaque-land-b', text: 'Second Mountain action', targets: [] },
        ],
        complete: true,
      },
      view: {
        ...base.view,
        seats: [{ ...base.view.seats[0], hand: [first, second], handSize: 2 }, base.view.seats[1]],
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: null,
        concede: null,
        objectActions: [
          { oid: first.oid, move: 'opaque-land-a' },
          { oid: first.oid, move: 'opaque-land-b' },
        ],
      },
      submit,
    };
    const rendered = render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    await screen.findByRole('group', { name: 'Legal moves' });
    const slots = (rendered.container as unknown as QueryRoot).querySelectorAll(
      '[data-permanent-key^="foreign:hand:mountain:"]',
    );
    expect(slots).toHaveLength(2);
    const firstCard = slots[0]?.querySelector('button');
    expect(firstCard).not.toBeNull();
    expect(slots[1]?.querySelector('button')).toBeNull();
    fireEvent.click(firstCard!);
    expect(submit).not.toHaveBeenCalled();
    const picker = screen.getByRole('group', { name: 'Moves for Mountain' });
    const pickerRoot = picker as unknown as QueryRoot;
    expect(pickerRoot.querySelectorAll('.mtg-choice')).toHaveLength(2);
    expect(pickerRoot.querySelector('.mtg-btn')).toBeNull();
    expect(within(picker).getByRole('button', { name: 'First Mountain action' })).not.toBeNull();
    fireEvent.click(within(picker).getByRole('button', { name: 'Second Mountain action' }));
    expect(submit).toHaveBeenCalledWith('opaque-land-b');
  });

  it('refuses to guess a double click between an aimed move and an unaimed one', async () => {
    const base = await openedScript();
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>();
    const mountain = observedObject('foreign:hand:mountain:default', 'Mountain', 'Basic Land — Mountain');
    const target = observedObject('foreign:battlefield:target', 'projected sentinel', 'Artifact Creature');
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'foreign-priority-vocabulary',
        prompt: 'Choose a game action',
        options: [
          { id: 'opaque-mana', text: 'Use Mountain alone', targets: [] },
          {
            id: 'opaque-aim',
            text: 'Use Mountain on projected sentinel',
            targets: [{ oid: target.oid, name: target.name }],
          },
        ],
        complete: true,
      },
      view: {
        ...base.view,
        seats: [
          { ...base.view.seats[0], hand: [mountain], handSize: 1 },
          { ...base.view.seats[1], battlefield: [target] },
        ],
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: null,
        concede: null,
        objectActions: [
          { oid: mountain.oid, move: 'opaque-mana', category: 'mana' },
          { oid: mountain.oid, move: 'opaque-aim', category: 'ability' },
        ],
      },
      submit,
    };
    const rendered = render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    await screen.findByRole('group', { name: 'Legal moves' });
    const card = (rendered.container as unknown as QueryRoot).querySelector(
      '[data-permanent-key="foreign:hand:mountain:default"] button',
    );
    expect(card).not.toBeNull();
    fireEvent.doubleClick(card!);

    expect(submit).not.toHaveBeenCalled();
  });

  it('scrolls the context rail into view when a coarse tap reads a hand card', async () => {
    const base = await openedScript();
    const mountain = observedObject('foreign:hand:mountain:solo', 'Mountain', 'Basic Land — Mountain');
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'foreign-priority-vocabulary',
        prompt: 'Choose a game action',
        options: [{ id: 'opaque-mana', text: 'Use Mountain alone', targets: [] }],
        complete: true,
      },
      view: {
        ...base.view,
        seats: [{ ...base.view.seats[0], hand: [mountain], handSize: 1 }, base.view.seats[1]],
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: null,
        concede: null,
        objectActions: [{ oid: mountain.oid, move: 'opaque-mana' }],
      },
    };

    await withCoarsePointer(async () => {
      const rendered = render(
        createElement(BackendGame, {
          backend: backendOpening(() => Promise.resolve({ ok: true, session })),
          table: TABLE,
        }),
      );

      await screen.findByRole('group', { name: 'Legal moves' });
      const root = rendered.container as unknown as QueryRoot;
      const rail = root.querySelector('.mtg-board__rail');
      expect(rail).not.toBeNull();
      const scrollIntoView = vi.fn();
      (rail as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollIntoView;
      const card = root.querySelector('[data-permanent-key="foreign:hand:mountain:solo"] button');
      expect(card).not.toBeNull();

      focus(card);

      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    });
  });

  it('leaves the context rail where it sits when a fine-pointer focus reads a hand card', async () => {
    const base = await openedScript();
    const mountain = observedObject('foreign:hand:mountain:solo', 'Mountain', 'Basic Land — Mountain');
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'foreign-priority-vocabulary',
        prompt: 'Choose a game action',
        options: [{ id: 'opaque-mana', text: 'Use Mountain alone', targets: [] }],
        complete: true,
      },
      view: {
        ...base.view,
        seats: [{ ...base.view.seats[0], hand: [mountain], handSize: 1 }, base.view.seats[1]],
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: null,
        concede: null,
        objectActions: [{ oid: mountain.oid, move: 'opaque-mana' }],
      },
    };
    const rendered = render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    await screen.findByRole('group', { name: 'Legal moves' });
    const root = rendered.container as unknown as QueryRoot;
    const rail = root.querySelector('.mtg-board__rail');
    expect(rail).not.toBeNull();
    const scrollIntoView = vi.fn();
    (rail as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollIntoView;
    const card = root.querySelector('[data-permanent-key="foreign:hand:mountain:solo"] button');
    expect(card).not.toBeNull();

    focus(card);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('refuses to guess a double click between a targeted cast and an untargeted cycle', async () => {
    const base = await openedScript();
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>();
    const spell = observedObject('foreign:hand:cinder-glide:default', 'Cinder Glide', 'Instant — Arcane');
    const target = observedObject('foreign:battlefield:mark', 'marked raider', 'Creature — Human Warrior');
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'foreign-priority-vocabulary',
        prompt: 'Choose a game action',
        options: [
          {
            id: 'opaque-cast-cinder-glide',
            text: 'Cast Cinder Glide targeting marked raider',
            targets: [{ oid: target.oid, name: target.name }],
          },
          { id: 'opaque-cycle-cinder-glide', text: 'Cycling {2}', targets: [] },
        ],
        complete: true,
      },
      view: {
        ...base.view,
        seats: [
          { ...base.view.seats[0], hand: [spell], handSize: 1 },
          { ...base.view.seats[1], battlefield: [target] },
        ],
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: null,
        concede: null,
        objectActions: [
          { oid: spell.oid, move: 'opaque-cast-cinder-glide', category: 'cast' },
          { oid: spell.oid, move: 'opaque-cycle-cinder-glide', category: 'cast' },
        ],
      },
      submit,
    };
    const rendered = render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    await screen.findByRole('group', { name: 'Legal moves' });
    const card = (rendered.container as unknown as QueryRoot).querySelector(
      '[data-permanent-key="foreign:hand:cinder-glide:default"] button',
    );
    expect(card).not.toBeNull();
    fireEvent.doubleClick(card!);

    expect(submit).not.toHaveBeenCalled();
  });

  it('aims an exact backend-declared player move through the shared player pod', async () => {
    const base = await openedScript();
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>();
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'foreign-target-vocabulary',
        prompt: 'Choose a player',
        options: [
          { id: 'opaque-player-0', text: 'Choose North', targets: [] },
          { id: 'opaque-player-1', text: 'Choose South', targets: [] },
          { id: 'opaque-cancel', text: 'Cancel', targets: [] },
        ],
        complete: true,
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: null,
        concede: null,
        objectActions: [],
        seatActions: [
          { seat: 0, move: 'opaque-player-0' },
          { seat: 1, move: 'opaque-player-1' },
        ],
      },
      submit,
    };
    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    const opponent = await screen.findByRole('button', { name: "South's status" });
    expect((opponent as unknown as QueryNode).getAttribute('data-aimable')).toBe('true');
    fireEvent.click(opponent);
    expect(submit).toHaveBeenCalledWith('opaque-player-1');
  });

  it('aims an exact annotated move through the shared stack strip', async () => {
    const base = await openedScript();
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>();
    const spell = observedObject('foreign:stack:spell:9', 'Observed spell', 'Instant');
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'foreign-stack-target-vocabulary',
        prompt: 'Choose an object on the stack',
        options: [
          {
            id: 'opaque-stack-target-9',
            text: 'Choose the observed spell',
            targets: [{ oid: spell.oid, name: spell.name }],
          },
        ],
        complete: true,
      },
      view: { ...base.view, stack: [spell] },
      play: {
        turnStep: 'precombatMain',
        passPriority: null,
        concede: null,
        objectActions: [],
        seatActions: [],
      },
      submit,
    };
    const rendered = render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    await screen.findByRole('group', { name: 'Stack' });
    const entry = (rendered.container as unknown as QueryRoot).querySelector(
      '[data-permanent-key="foreign:stack:spell:9"]',
    );
    expect(entry?.getAttribute('data-aimable')).toBe('true');
    fireEvent.click(entry!);
    expect(submit).toHaveBeenCalledWith('opaque-stack-target-9');
  });

  it('opens the exact printed face when a mapped stack spell is inspected', async () => {
    const base = await openedScript();
    const spell = observedObject('foreign:stack:printed:10', PRINTED_SENTINEL.name, 'Artifact Creature');
    const session: ObservedSession = {
      ...base,
      view: { ...base.view, stack: [spell] },
    };
    const rendered = render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
        printedCards: [PRINTED_SENTINEL],
      }),
    );

    await screen.findByRole('group', { name: 'Stack' });
    const entry = (rendered.container as unknown as QueryRoot).querySelector(
      '[data-permanent-key="foreign:stack:printed:10"]',
    );
    if (entry === null) throw new Error('the shared stack did not draw the mapped spell');
    fireEvent.contextMenu(entry);

    const info = screen.getByRole('group', { name: 'Info' });
    await waitFor(() => {
      expect(within(info).getByText('Vigilance')).not.toBeNull();
    });
    const face = (info as unknown as QueryRoot).querySelector('.mtg-card[data-presentation="printed-card"]');
    expect(face).not.toBeNull();
    expect(face?.querySelector('[data-region="art"] img')?.getAttribute('src')).toBe(
      'https://cards.example/projected-sentinel-art.jpg',
    );
  });

  it('uses only a neutral text descriptor to validate and encode a backend answer', async () => {
    const user = userEvent.setup();
    const base = await openedScript();
    const input = {
      kind: 'text' as const,
      id: 'foreign-question:17',
      label: 'Name the observed object',
      minLength: 2,
      maxLength: 5,
    };
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: base }),
    );
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'a-backend-kind-the-ui-does-not-know',
        prompt: 'Supply an answer',
        options: [],
        input,
        complete: true,
      },
      submit,
    };
    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    const field = await screen.findByRole('textbox', { name: input.label });
    const send = screen.getByRole('button', { name: 'Submit answer' });
    const sendNode = send as unknown as QueryNode;
    expect(sendNode.getAttribute('disabled')).not.toBeNull();
    fireEvent.change(field, { target: { value: 'x' } });
    expect(sendNode.getAttribute('disabled')).not.toBeNull();
    await user.clear(field);
    await user.type(field, 'Bolt');
    expect(sendNode.getAttribute('disabled')).toBeNull();
    await user.keyboard('{Enter}');

    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith(textSubmission(input, 'Bolt'));
  });

  it('confirms a complete proved combat damage split in one submission', async () => {
    const base = await openedScript();
    const assignment = {
      inputId: 'combat-damage-assignment:17',
      source: { oid: 'forge-card-17', name: 'Charging Rhino', power: 5 },
      total: 5,
      canDefer: false,
      overrideOrder: false,
      recipients: [
        {
          oid: 'forge-card-20',
          name: 'Bear Cub',
          kind: 'blocker' as const,
          toughness: 2,
          damage: 0,
          lethal: 2,
        },
        {
          oid: 'forge-card-21',
          name: 'Horned Turtle',
          kind: 'blocker' as const,
          toughness: 3,
          damage: 0,
          lethal: 3,
        },
        {
          oid: 'forge-player-1',
          name: 'South',
          kind: 'defender' as const,
          toughness: null,
          damage: 0,
          lethal: 0,
        },
      ],
      defaultAmounts: [2, 3, 0],
    };
    const encoded = JSON.stringify({
      ...assignment,
      version: 1,
      amounts: assignment.defaultAmounts,
      defer: false,
    });
    const input = {
      kind: 'text' as const,
      id: assignment.inputId,
      label: 'Assign combat damage',
      minLength: 2,
      maxLength: 16384,
      suggestions: [encoded],
    };
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: base }),
    );
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'combat-damage',
        prompt: 'Assign 5 combat damage from Charging Rhino',
        options: [],
        input,
        complete: true,
      },
      play: { ...base.play!, combatDamage: assignment },
      submit,
    };
    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    expect(
      (
        (await screen.findByRole('spinbutton', {
          name: 'Damage assigned to Bear Cub',
        })) as unknown as QueryNode
      ).getAttribute('value'),
    ).toBe('2');
    expect(screen.getByText('Toughness 3 · marked 0 · lethal 3')).not.toBeNull();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Damage assigned to Bear Cub' }), {
      target: { value: '1' },
    });
    expect(
      (
        screen.getByRole('spinbutton', { name: 'Damage assigned to Horned Turtle' }) as unknown as QueryNode
      ).getAttribute('disabled'),
    ).not.toBeNull();
    expect(
      (
        screen.getByRole('spinbutton', { name: 'Damage assigned to South' }) as unknown as QueryNode
      ).getAttribute('disabled'),
    ).not.toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Confirm damage' }) as unknown as QueryNode).getAttribute(
        'disabled',
      ),
    ).not.toBeNull();
    expect(
      (
        screen.getByRole('spinbutton', {
          name: 'Damage assigned to Horned Turtle',
        }) as unknown as QueryNode
      ).getAttribute('value'),
    ).toBe('0');
    expect(
      (
        screen.getByRole('spinbutton', { name: 'Damage assigned to South' }) as unknown as QueryNode
      ).getAttribute('value'),
    ).toBe('0');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Damage assigned to Bear Cub' }), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Damage assigned to Horned Turtle' }), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm damage' }));

    expect(submit).toHaveBeenCalledOnce();
    const submitted = submit.mock.calls[0]?.[0];
    expect(
      typeof submitted === 'string' ? JSON.parse(textValueOf(input, submitted) ?? '') : null,
    ).toMatchObject({
      source: assignment.source,
      amounts: [2, 3, 0],
      defer: false,
    });
  });

  it('opens regular-strike damage with a fresh backend-proved split', async () => {
    const base = await openedScript();
    const firstAssignment = {
      inputId: 'combat-damage-assignment:17',
      source: { oid: 'forge-card-17', name: 'Double Striker', power: 5 },
      total: 5,
      canDefer: false,
      overrideOrder: false,
      recipients: [
        {
          oid: 'forge-card-20',
          name: 'Bear Cub',
          kind: 'blocker' as const,
          toughness: 4,
          damage: 0,
          lethal: 2,
        },
        { oid: 'forge-card-21', name: 'Wall', kind: 'blocker' as const, toughness: 4, damage: 0, lethal: 3 },
        {
          oid: 'forge-player-1',
          name: 'South',
          kind: 'defender' as const,
          toughness: null,
          damage: 0,
          lethal: 0,
        },
      ],
      defaultAmounts: [2, 3, 0],
    };
    const secondAssignment = {
      ...firstAssignment,
      recipients: [
        { ...firstAssignment.recipients[0]!, damage: 1, lethal: 1 },
        firstAssignment.recipients[1]!,
        firstAssignment.recipients[2]!,
      ],
      defaultAmounts: [1, 3, 1],
    };
    const input = {
      kind: 'text' as const,
      id: firstAssignment.inputId,
      label: 'Assign combat damage',
      minLength: 2,
      maxLength: 16384,
      suggestions: ['proved'],
    };
    const second: ObservedSession = {
      ...base,
      submitted: base.submitted + 1,
      decision: {
        seat: 0,
        kind: 'combat-damage',
        prompt: 'Assign regular-strike damage',
        options: [],
        input,
        complete: true,
      },
      play: { ...base.play!, combatDamage: secondAssignment },
      submit: base.submit,
    };
    const first: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'combat-damage',
        prompt: 'Assign first-strike damage',
        options: [],
        input,
        complete: true,
      },
      play: { ...base.play!, combatDamage: firstAssignment },
      submit: (): Promise<SubmitResult<ObservedSession>> => Promise.resolve({ ok: true, session: second }),
    };
    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session: first })),
        table: TABLE,
      }),
    );

    fireEvent.change(await screen.findByRole('spinbutton', { name: 'Damage assigned to Bear Cub' }), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Damage assigned to Wall' }), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm damage' }));

    await waitFor(() => {
      expect(
        (
          screen.getByRole('spinbutton', { name: 'Damage assigned to Bear Cub' }) as unknown as QueryNode
        ).getAttribute('value'),
      ).toBe('1');
    });
  });

  it('closes the held session when React disposes the table', async () => {
    const base = await openedScript();
    const close = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const session: ObservedSession = { ...base, close };
    const rendered = render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );
    await screen.findByRole('button', { name: 'Advance the clock' });

    rendered.unmount();
    await waitFor(() => {
      expect(close).toHaveBeenCalledOnce();
    });
  });

  it('renders backend failure and explicit closed states', async () => {
    const failed = render(
      createElement(BackendGame, {
        backend: backendOpening(() =>
          Promise.resolve({
            ok: false,
            error: { kind: 'backend-failure', message: 'process exited' },
          }),
        ),
        table: TABLE,
      }),
    );
    expect(textOf(await screen.findByRole('alert'))).toBe('backend-failure: process exited');
    failed.unmount();

    render(createElement(BackendGame, { backend: scriptBackend(), table: TABLE }));
    await screen.findByRole('button', { name: 'Advance the clock' });
    fireEvent.click(screen.getByRole('button', { name: 'Close game' }));
    // The table mounts other live regions (Priority changes), so pick this one out by what it says.
    expect((await screen.findAllByRole('status')).map(textOf)).toContain(CLOSED_SESSION_LABEL);
  });
});

describe('the opening roll', () => {
  async function pregame(): Promise<{
    readonly mulligan: ObservedSession;
    readonly turnOne: ObservedSession;
  }> {
    const base = await openedScript();
    const turnOne: ObservedSession = {
      ...base,
      submitted: 2,
      decision: {
        seat: 0,
        kind: 'opaque priority',
        prompt: 'North has priority',
        options: [{ id: 'opaque-pass', text: 'Pass', targets: [] }],
        complete: true,
      },
      view: {
        ...base.view,
        turn: { number: 1, active: 1, phase: 'opaque', step: 'opaque' },
        priority: 0,
      },
      play: {
        turnStep: 'upkeep',
        passPriority: 'opaque-pass',
        concede: null,
        objectActions: [],
        promptRole: null,
        automatic: null,
      },
    };
    const mulligan: ObservedSession = {
      ...base,
      submitted: 1,
      decision: {
        seat: 0,
        kind: 'opaque opening decision',
        prompt: 'Keep these seven cards or draw a new seven.',
        options: [
          { id: 'opaque-keep', text: 'Keep this hand', targets: [] },
          { id: 'opaque-mulligan', text: 'Take a mulligan', targets: [] },
        ],
        complete: true,
      },
      view: { ...base.view, turn: { number: 0, active: 0, phase: 'Pregame', step: 'PREGAME' } },
      play: {
        turnStep: null,
        passPriority: null,
        concede: null,
        objectActions: [],
        promptRole: 'opening-hand',
        automatic: null,
      },
      submit: () => Promise.resolve({ ok: true, session: turnOne }),
    };
    return { mulligan, turnOne };
  }

  it('says the other seat won the roll when the local seat sat through pregame unasked', async () => {
    const { mulligan } = await pregame();
    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session: mulligan })),
        table: TABLE,
      }),
    );
    await screen.findByText('Opening hand');
    expect(screen.queryByText(/won the die roll/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keep this hand' }));
    const notes = await screen.findAllByText('South won the die roll and plays first.');
    expect(notes.length).toBeGreaterThan(0);
  });

  it('stays quiet when the local seat was the one asked', async () => {
    const { mulligan, turnOne } = await pregame();
    const starting: ObservedSession = {
      ...mulligan,
      submitted: 0,
      decision: {
        seat: 0,
        kind: 'opaque setup decision',
        prompt: 'opaque setup prompt',
        options: [
          { id: 'opaque-local-start', text: 'first opaque option', targets: [] },
          { id: 'opaque-engine-start', text: 'second opaque option', targets: [] },
        ],
        complete: true,
      },
      play: {
        ...mulligan.play!,
        promptRole: null,
        automatic: { move: 'opaque-local-start', reason: 'local-starts' },
      },
      submit: () => Promise.resolve({ ok: true, session: mulligan }),
    };
    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session: starting })),
        table: TABLE,
      }),
    );
    await screen.findByText('You won the die roll');
    fireEvent.click(screen.getByRole('button', { name: 'Play second' }));
    await screen.findByText('Opening hand');
    fireEvent.click(screen.getByRole('button', { name: 'Keep this hand' }));
    await waitFor(() => expect(screen.getByText(`${String(turnOne.submitted)} choices made`)).not.toBeNull());
    expect(screen.queryByText(/won the die roll and/)).toBeNull();
  });

  it('opens the play-or-draw choice on a shut column without a press on the alert', async () => {
    const { mulligan } = await pregame();
    const starting: ObservedSession = {
      ...mulligan,
      submitted: 0,
      decision: {
        seat: 0,
        kind: 'opaque setup decision',
        prompt: 'opaque setup prompt',
        options: [
          { id: 'opaque-local-start', text: 'first opaque option', targets: [] },
          { id: 'opaque-engine-start', text: 'second opaque option', targets: [] },
        ],
        complete: true,
      },
      play: {
        ...mulligan.play!,
        promptRole: null,
        automatic: { move: 'opaque-local-start', reason: 'local-starts' },
      },
    };
    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session: starting })),
        table: TABLE,
      }),
    );
    await screen.findByText('You won the die roll');
    fireEvent.click(screen.getByRole('button', { name: 'Game details' }));
    expect(
      (screen.getByRole('button', { name: 'Game details' }) as unknown as QueryNode).getAttribute(
        'aria-expanded',
      ),
    ).toBe('false');
    expect(screen.getByRole('button', { name: 'Play first' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Play second' })).not.toBeNull();
  });

  it('strips a bridge-composed move id from an option label and disambiguates twins by position', async () => {
    const base = await openedScript();
    const islandOne = observedObject('forge-card-21', 'Island', 'Basic Land — Island');
    const islandTwo = observedObject('forge-card-22', 'Island', 'Basic Land — Island');
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: { ...base, submitted: 2, decision: null } }),
    );
    const session: ObservedSession = {
      ...base,
      submitted: 1,
      decision: {
        seat: 0,
        kind: 'opaque discard cost',
        prompt: 'Discard a card',
        options: [
          {
            id: 'cost-discard-21',
            text: 'Discard Island [cost-discard-21]',
            targets: [{ oid: islandOne.oid, name: islandOne.name }],
          },
          {
            id: 'cost-discard-22',
            text: 'Discard Island [cost-discard-22]',
            targets: [{ oid: islandTwo.oid, name: islandTwo.name }],
          },
        ],
        complete: true,
      },
      view: {
        ...base.view,
        seats: [{ ...base.view.seats[0], hand: [islandOne, islandTwo] }, base.view.seats[1]],
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: null,
        concede: null,
        objectActions: [],
        automatic: null,
      },
      submit,
    };

    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    expect(await screen.findByRole('button', { name: 'Discard Island (1 of 2)' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Discard Island (2 of 2)' })).not.toBeNull();
    expect(screen.queryByText(/cost-discard-21/)).toBeNull();
    expect(screen.queryByText(/cost-discard-22/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Discard Island (2 of 2)' }));
    expect(submit).toHaveBeenCalledWith('cost-discard-22');
  });

  it('disambiguates by position, never by id, when the projection cannot tell two options apart itself', async () => {
    const base = await openedScript();
    const twinOne = observedObject('forge-card-31', 'Emberflow Raider', 'Creature — Elemental');
    const twinTwo = observedObject('forge-card-32', 'Emberflow Raider', 'Creature — Elemental');
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: { ...base, submitted: 2, decision: null } }),
    );
    const session: ObservedSession = {
      ...base,
      submitted: 1,
      decision: {
        seat: 0,
        kind: 'opaque cast decision',
        prompt: 'Choose a game action',
        options: [
          {
            id: 'opaque-cast-31',
            text: 'Cast Lightning Lash',
            targets: [{ oid: twinOne.oid, name: twinOne.name }],
          },
          {
            id: 'opaque-cast-32',
            text: 'Cast Lightning Lash',
            targets: [{ oid: twinTwo.oid, name: twinTwo.name }],
          },
        ],
        complete: true,
      },
      view: {
        ...base.view,
        seats: [{ ...base.view.seats[0], battlefield: [twinOne, twinTwo] }, base.view.seats[1]],
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: null,
        concede: null,
        objectActions: [],
        automatic: null,
      },
      submit,
    };

    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    expect(await screen.findByRole('button', { name: 'Cast Lightning Lash (1 of 2)' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Cast Lightning Lash (2 of 2)' })).not.toBeNull();
    expect(screen.queryByText(/opaque-cast-3[12]/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cast Lightning Lash (2 of 2)' }));
    expect(submit).toHaveBeenCalledWith('opaque-cast-32');
  });

  it('strips the card identifiers the bridge writes into combat labels', async () => {
    const base = await openedScript();
    const ronin = observedObject('forge-card-125', 'Akki Ronin', 'Creature — Goblin Samurai');
    const hydra = observedObject('forge-card-131', 'Molten Hydra', 'Creature — Hydra');
    const servant = observedObject('forge-card-140', 'Civil Servant', 'Creature — Cat Citizen');
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: { ...base, submitted: 2, decision: null } }),
    );
    const session: ObservedSession = {
      ...base,
      submitted: 1,
      decision: {
        seat: 0,
        kind: 'opaque combat decision',
        prompt: 'Declare attackers; finish only when the declaration is legal',
        options: [
          {
            id: 'combat-attack-remove-125',
            text: 'Remove Akki Ronin [forge-card-125] from combat',
            targets: [{ oid: ronin.oid, name: ronin.name }],
          },
          {
            id: 'combat-attack-add-131-player-1',
            text: 'Attack Forge bot with Molten Hydra [forge-card-131]',
            targets: [{ oid: hydra.oid, name: hydra.name }],
          },
          {
            id: 'combat-block-add-131-140',
            text: 'Block Civil Servant [forge-card-140] with Molten Hydra [forge-card-131]',
            targets: [
              { oid: hydra.oid, name: hydra.name },
              { oid: servant.oid, name: servant.name },
            ],
          },
          {
            id: 'combat-order-insert-140-131-1',
            text: 'Put Molten Hydra [forge-card-131] after Akki Ronin [forge-card-125]',
            targets: [{ oid: hydra.oid, name: hydra.name }],
          },
        ],
        complete: true,
      },
      view: {
        ...base.view,
        seats: [
          { ...base.view.seats[0], battlefield: [ronin, hydra] },
          { ...base.view.seats[1], battlefield: [servant] },
        ],
      },
      play: {
        turnStep: 'declareAttackers',
        passPriority: null,
        concede: null,
        objectActions: [],
        automatic: null,
      },
      submit,
    };

    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    expect(await screen.findByRole('button', { name: 'Remove Akki Ronin from combat' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Attack Forge bot with Molten Hydra' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Block Civil Servant with Molten Hydra' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Put Molten Hydra after Akki Ronin' })).not.toBeNull();
    expect(screen.queryByText(/forge-card-/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Attack Forge bot with Molten Hydra' }));
    expect(submit).toHaveBeenCalledWith('combat-attack-add-131-player-1');
  });

  it('tells two attackers of one name apart by position once their identifiers are gone', async () => {
    const base = await openedScript();
    const bearOne = observedObject('forge-card-51', 'Grizzly Bears', 'Creature — Bear');
    const bearTwo = observedObject('forge-card-52', 'Grizzly Bears', 'Creature — Bear');
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: { ...base, submitted: 2, decision: null } }),
    );
    const session: ObservedSession = {
      ...base,
      submitted: 1,
      decision: {
        seat: 0,
        kind: 'opaque combat decision',
        prompt: 'Declare attackers; finish only when the declaration is legal',
        options: [
          {
            id: 'combat-attack-add-51-player-1',
            text: 'Attack Forge bot with Grizzly Bears [forge-card-51]',
            targets: [{ oid: bearOne.oid, name: bearOne.name }],
          },
          {
            id: 'combat-attack-add-52-player-1',
            text: 'Attack Forge bot with Grizzly Bears [forge-card-52]',
            targets: [{ oid: bearTwo.oid, name: bearTwo.name }],
          },
        ],
        complete: true,
      },
      view: {
        ...base.view,
        seats: [{ ...base.view.seats[0], battlefield: [bearOne, bearTwo] }, base.view.seats[1]],
      },
      play: {
        turnStep: 'declareAttackers',
        passPriority: null,
        concede: null,
        objectActions: [],
        automatic: null,
      },
      submit,
    };

    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    expect(
      await screen.findByRole('button', { name: 'Attack Forge bot with Grizzly Bears (1 of 2)' }),
    ).not.toBeNull();
    expect(screen.queryByText(/forge-card-/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Attack Forge bot with Grizzly Bears (2 of 2)' }));
    expect(submit).toHaveBeenCalledWith('combat-attack-add-52-player-1');
  });

  it('never renders a choice label containing a move id from its own decision', async () => {
    const base = await openedScript();
    const island = observedObject('forge-card-41', 'Island', 'Basic Land — Island');
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'opaque mixed decision',
        prompt: 'Choose a game action',
        options: [
          {
            id: 'cost-discard-41',
            text: 'Discard Island [cost-discard-41]',
            targets: [{ oid: island.oid, name: island.name }],
          },
          { id: 'opaque-pass-93', text: 'Pass priority', targets: [] },
        ],
        complete: true,
      },
      view: {
        ...base.view,
        seats: [{ ...base.view.seats[0], hand: [island] }, base.view.seats[1]],
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: 'opaque-pass-93',
        concede: null,
        objectActions: [],
        automatic: null,
      },
    };

    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );

    await screen.findByText('Choose an action');
    for (const option of session.decision!.options) {
      expect(screen.queryByText(new RegExp(option.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeNull();
    }
  });
});
