// @vitest-environment jsdom
/**
 * Four players on the live table: the rail, a tile per opponent, and the attack
 * step asking whom each attacker goes at.
 *
 * `mtg-bc2.154.6.5.4`. The backend here is a script that reports four seats,
 * because that is what a backend that plays a pod will send. Neither the kernel
 * nor the Forge wire can yet (`../../src/net/backend-gateway.ts` refuses a third
 * seat), so this is the contract the surface reads, exercised end to end through
 * `BackendGame` rather than through the projection alone.
 *
 * The property under test is that the table never chooses a defender for the
 * player: with more than one to attack, a click on a creature does nothing until
 * somebody is picked, and the move it then submits is the one the backend
 * attached to that defender.
 */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ObjectView,
  ObservedBackend,
  ObservedSession,
  OpenResult,
  SeatView,
  SessionSpec,
  SubmitResult,
} from '@mtg/engine';
import { scriptBackend } from '@mtg/engine';
import { BackendGame } from '@mtg/ui';

afterEach(cleanup);

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy' },
  seats: [
    { name: 'Ana', controller: 'local', deck: { name: 'ana', cards: [] } },
    { name: 'Bo', controller: 'engine', deck: { name: 'bo', cards: [] } },
  ],
  seed: 'ui/backend-pod-attack',
  maximumTurns: null,
};

interface QueryNode {
  readonly textContent?: string | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): QueryNode | null;
  querySelectorAll(selector: string): { readonly [index: number]: QueryNode; readonly length: number };
}

const root = (container: unknown): QueryNode => container as QueryNode;
/** The workspace tsconfig has no `lib: dom`, so testing-library's elements are read through this slice. */
const node = (element: unknown): QueryNode => element as QueryNode;
const nodes = (list: { readonly [index: number]: QueryNode; readonly length: number }): QueryNode[] =>
  Array.from({ length: list.length }, (_, at) => list[at]!);

function backendOpening(open: () => Promise<OpenResult<ObservedSession>>): ObservedBackend {
  return {
    id: 'unfamiliar-backend-name',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
    supports: (): Promise<readonly string[]> => Promise.resolve([]),
    open,
  };
}

function creature(oid: string, name: string, controller: 0 | 1 | 2 | 3): ObjectView {
  return {
    oid,
    name,
    typeLine: 'Creature — Wolf',
    power: 2,
    toughness: 2,
    tapped: false,
    attacking: false,
    damage: 0,
    controller,
    counters: {},
  };
}

const wolf = creature('foreign:wolf:1', 'Timber Wolf', 0);
const bear = creature('foreign:bear:2', 'Grizzly Bears', 2);
const jace = {
  ...creature('foreign:jace:3', 'Jace, Unraveler', 3),
  typeLine: 'Legendary Planeswalker — Jace',
};

const NAMES = ['Ana', 'Bo', 'Cy', 'Di'] as const;

function seats(base: ObservedSession, staged: boolean): readonly [SeatView, SeatView, ...SeatView[]] {
  const at = (
    id: 0 | 1 | 2 | 3,
    battlefield: readonly ObjectView[],
    extra: Partial<SeatView> = {},
  ): SeatView => ({
    ...base.view.seats[0],
    id,
    name: NAMES[id],
    life: 40,
    hand: id === 0 ? [] : null,
    handSize: 7,
    librarySize: 80,
    graveyard: [],
    exile: [],
    battlefield,
    ...extra,
  });
  return [
    at(0, [staged ? { ...wolf, tapped: true, attacking: true } : wolf]),
    at(1, []),
    at(2, [bear], { poison: 3 }),
    at(3, [jace]),
  ];
}

async function attackDeclaration(): Promise<{
  readonly ready: ObservedSession;
  readonly submit: ReturnType<typeof vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>>;
}> {
  const opened = await scriptBackend({ clock: 3 }).open(TABLE);
  if (!opened.ok) throw new Error(opened.error.message);
  const base = opened.session;
  const decision = (moves: ObservedSession['decision']): ObservedSession['decision'] => moves;
  const staged: ObservedSession = {
    ...base,
    submitted: 1,
    decision: decision({
      seat: 0,
      kind: 'opaque combat vocabulary',
      prompt: 'opaque attacker prompt',
      options: [
        { id: 'finish', text: 'finish', targets: [] },
        { id: 'wolf-out', text: 'remove', targets: [{ oid: wolf.oid, name: wolf.name }] },
      ],
      complete: true,
    }),
    view: {
      ...base.view,
      turn: { number: 3, active: 0, phase: 'opaque combat', step: 'opaque attackers' },
      priority: null,
      seats: seats(base, false),
    },
    play: {
      turnStep: 'declareAttackers',
      passPriority: null,
      concede: null,
      objectActions: [{ oid: wolf.oid, move: 'wolf-out', category: 'combat' }],
      attackers: { confirm: 'finish', staged: [wolf.oid] },
    },
  };
  const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
    Promise.resolve({ ok: true, session: staged }),
  );
  const target = (name: string): { readonly oid: string; readonly name: string }[] => [
    { oid: wolf.oid, name: `${wolf.name} → ${name}` },
  ];
  const ready: ObservedSession = {
    ...staged,
    submitted: 0,
    decision: decision({
      seat: 0,
      kind: 'opaque combat vocabulary',
      prompt: 'opaque attacker prompt',
      options: [
        { id: 'finish', text: 'finish', targets: [] },
        { id: 'wolf-bo', text: 'add', targets: target('Bo') },
        { id: 'wolf-cy', text: 'add', targets: target('Cy') },
        { id: 'wolf-jace', text: 'add', targets: target('Jace') },
      ],
      complete: true,
    }),
    play: {
      turnStep: 'declareAttackers',
      passPriority: null,
      concede: null,
      objectActions: [
        { oid: wolf.oid, move: 'wolf-bo', category: 'combat', defender: { seat: 1 } },
        { oid: wolf.oid, move: 'wolf-cy', category: 'combat', defender: { seat: 2 } },
        { oid: wolf.oid, move: 'wolf-jace', category: 'combat', defender: { oid: jace.oid } },
      ],
      attackers: { confirm: 'finish', staged: [] },
    },
    submit,
  };
  return { ready, submit };
}

describe('the live table at a pod', () => {
  it('draws a rail row per player and a tile per opponent, and no duel pod for the opponent', async () => {
    const { ready } = await attackDeclaration();
    const pod = { ...ready, view: { ...ready.view, seats: seats(ready, false) } } as ObservedSession;
    const rendered = render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session: pod })),
        table: TABLE,
      }),
    );
    await screen.findByLabelText('Players');
    const board = root(rendered.container);
    expect(board.querySelector('.mtg-board')?.getAttribute('data-pod')).toBe('4');
    expect(
      nodes(board.querySelectorAll('.mtg-seat-rail__item')).map((row) => row.getAttribute('data-seat-index')),
    ).toEqual(['0', '1', '2', '3']);
    expect(
      nodes(board.querySelectorAll('.mtg-pod-tile')).map((tile) => tile.getAttribute('data-seat-index')),
    ).toEqual(['1', '2', '3']);
    // One tile is the band's opponent; the row runs in the order the seats sit.
    expect(
      nodes(board.querySelectorAll('.mtg-pod-tile')).map((tile) => tile.getAttribute('data-primary')),
    ).toEqual(['true', 'false', 'false']);
    // The opponent's vitals are the rail's now, not a second pod above the lanes.
    expect(board.querySelector('.mtg-board__pods .mtg-pod[data-seat="opponent"]')).toBeNull();
    // Poison is the rail's: reported where the backend reports it, a dash where it does not.
    const poison = nodes(board.querySelectorAll('.mtg-seat-rail__poison')).map((one) =>
      one.getAttribute('data-amount'),
    );
    expect(poison).toEqual(['unreported', 'unreported', '3', 'unreported']);
    // Every opponent's permanents are on screen at once, each in its own seat's tile.
    const tiles = nodes(board.querySelectorAll('.mtg-pod-tile'));
    expect(tiles.map((tile) => (tile.textContent ?? '').includes(bear.name))).toEqual([false, true, false]);
    expect(tiles.map((tile) => (tile.textContent ?? '').includes(jace.name))).toEqual([false, false, true]);
  });

  it('asks whom to attack, stages nothing until somebody is picked, and submits the picked defender’s move', async () => {
    const { ready, submit } = await attackDeclaration();
    const rendered = render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session: ready })),
        table: TABLE,
      }),
    );
    const card = await screen.findByRole('button', { name: /^Timber Wolf\./ });
    const picker = await screen.findByRole('radiogroup', { name: 'Who to attack' });
    const options = within(picker).getAllByRole('radio');
    expect(options.map((option) => node(option).textContent)).toEqual(['Bo', 'Cy', 'Jace, Unraveler']);
    expect(options.every((option) => node(option).getAttribute('aria-checked') === 'false')).toBe(true);
    expect(node(picker).textContent).toContain('Choose who to attack');

    // Nobody is picked: the click means nothing, rather than choosing a defender.
    fireEvent.click(card);
    expect(submit).not.toHaveBeenCalled();

    fireEvent.click(within(picker).getByRole('radio', { name: 'Cy' }));
    await waitFor(() =>
      expect(node(within(picker).getByRole('radio', { name: 'Cy' })).getAttribute('aria-checked')).toBe(
        'true',
      ),
    );
    // The rail marks the seat being attacked, and only that one.
    const attacked = nodes(root(rendered.container).querySelectorAll('.mtg-seat-rail__item')).map((row) =>
      row.getAttribute('data-attacked'),
    );
    expect(attacked).toEqual(['false', 'false', 'true', 'false']);

    fireEvent.click(card);
    await waitFor(() => expect(submit).toHaveBeenCalledWith('wolf-cy'));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('sends a creature at a planeswalker when that is who was picked', async () => {
    const { ready, submit } = await attackDeclaration();
    render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session: ready })),
        table: TABLE,
      }),
    );
    const card = await screen.findByRole('button', { name: /^Timber Wolf\./ });
    const picker = await screen.findByRole('radiogroup', { name: 'Who to attack' });
    fireEvent.click(within(picker).getByRole('radio', { name: 'Jace, Unraveler' }));
    fireEvent.click(card);
    await waitFor(() => expect(submit).toHaveBeenCalledWith('wolf-jace'));
  });

  it('counts the creature under the defender it was sent at once it is staged', async () => {
    const { ready, submit } = await attackDeclaration();
    const rendered = render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session: ready })),
        table: TABLE,
      }),
    );
    const card = await screen.findByRole('button', { name: /^Timber Wolf\./ });
    fireEvent.click(
      within(await screen.findByRole('radiogroup', { name: 'Who to attack' })).getByRole('radio', {
        name: 'Bo',
      }),
    );
    fireEvent.click(card);
    await waitFor(() => expect(submit).toHaveBeenCalledWith('wolf-bo'));
    const confirm = await screen.findByRole('button', { name: 'Attack with 1' });
    expect(confirm).not.toBeNull();
    const count = root(rendered.container).querySelector(
      '.mtg-combat__target[data-target="seat:1"] .mtg-combat__target-count',
    );
    expect(count?.textContent).toBe('1');
    // The backend offers the one creature nothing but its way back out, so the picker
    // holds only the defender it is going at: it stays to say whom, and does not vanish.
    const options = nodes(root(rendered.container).querySelectorAll('.mtg-combat__target'));
    expect(
      options.map((option) => [option.getAttribute('data-target'), option.getAttribute('aria-checked')]),
    ).toEqual([['seat:1', 'true']]);
  });

  it('gives every seat a command zone with its tax, and lets only the viewer cast from theirs', async () => {
    const opened = await scriptBackend({ clock: 3 }).open(TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    const base = opened.session;
    const general = (oid: string, name: string, controller: 0 | 1 | 2 | 3): ObjectView => ({
      ...creature(oid, name, controller),
      typeLine: 'Legendary Creature — Elf Cleric',
      characteristics: { colors: ['W', 'G'], manaCost: '{W}{G}', token: false },
    });
    const commanders = [
      general('cmd:ana', 'Emmara, Soul of the Accord', 0),
      general('cmd:bo', 'Bo Commander', 1),
      general('cmd:cy', 'Cy Commander', 2),
      general('cmd:di', 'Di Commander', 3),
    ] as const;
    const cast = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>(() =>
      Promise.resolve({ ok: true, session: base }),
    );
    const tally = [1, 0, 2, 0] as const;
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'opaque priority vocabulary',
        prompt: 'opaque priority prompt',
        options: [{ id: 'cast-emmara', text: 'Cast', targets: [] }],
        complete: true,
      },
      view: {
        ...base.view,
        turn: { number: 4, active: 0, phase: 'opaque main', step: 'opaque main' },
        priority: 0,
        seats: seats(base, false).map((one, id) => ({
          ...one,
          battlefield: [],
          commandZone: [commanders[id]!],
          commanderCasts: { [commanders[id]!.oid]: tally[id]! },
          commanderDamage: {},
        })) as unknown as ObservedSession['view']['seats'],
      },
      play: {
        turnStep: 'precombatMain',
        passPriority: null,
        concede: null,
        objectActions: [{ oid: 'cmd:ana', move: 'cast-emmara', category: 'cast' }],
      },
      submit: cast,
    };
    const rendered = render(
      createElement(BackendGame, {
        backend: backendOpening(() => Promise.resolve({ ok: true, session })),
        table: TABLE,
      }),
    );
    await screen.findByLabelText('Players');
    const board = root(rendered.container);
    // One commander per tile, each with the engine's cast count under it.
    const ledgers = nodes(board.querySelectorAll('.mtg-pod-tile .mtg-command__ledger')).map((one) =>
      one.getAttribute('data-casts'),
    );
    expect(ledgers).toEqual(['0', '2', '0']);
    const taxed = nodes(board.querySelectorAll('.mtg-pod-tile .mtg-command__cost')).map(
      (one) => one.textContent,
    );
    expect(taxed).toEqual(['next {W}{G}', 'next {4}{W}{G}', 'next {W}{G}']);
    // Each seat has a row of commander damage chips, one per opponent, read before the
    // cast below hands back a different table.
    const chips = nodes(board.querySelectorAll('.mtg-seat-rail__damage-list')).map(
      (list) => nodes(list.querySelectorAll('.mtg-seat-rail__damage')).length,
    );
    expect(chips).toEqual([3, 3, 3, 3]);
    // Yours is castable from the command zone, and the opponents' are not controls.
    const own = await screen.findByRole('button', { name: /^Emmara, Soul of the Accord\./ });
    for (const name of ['Bo Commander', 'Cy Commander', 'Di Commander']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${name}\\.`) })).toBeNull();
    }
    fireEvent.click(own);
    await waitFor(() => expect(cast).toHaveBeenCalledWith('cast-emmara'));
  });

  it('aims a player move at the third opponent through the rail, the pod every seat shares', async () => {
    const opened = await scriptBackend({ clock: 3 }).open(TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    const base = opened.session;
    const submit = vi.fn<(move: string) => Promise<SubmitResult<ObservedSession>>>();
    const session: ObservedSession = {
      ...base,
      decision: {
        seat: 0,
        kind: 'foreign-target-vocabulary',
        prompt: 'Choose a player',
        options: [
          { id: 'player-2', text: 'Choose Cy', targets: [] },
          { id: 'player-3', text: 'Choose Di', targets: [] },
          { id: 'cancel', text: 'Cancel', targets: [] },
        ],
        complete: true,
      },
      view: { ...base.view, seats: seats(base, false) },
      play: {
        turnStep: 'precombatMain',
        passPriority: null,
        concede: null,
        objectActions: [],
        seatActions: [
          { seat: 2, move: 'player-2' },
          { seat: 3, move: 'player-3' },
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
    const cy = await screen.findByRole('button', { name: "Cy's status" });
    expect(node(cy).getAttribute('data-aimable')).toBe('true');
    // Bo is not a candidate, so Bo's row is not a control.
    expect(screen.queryByRole('button', { name: "Bo's status" })).toBeNull();
    fireEvent.click(cy);
    expect(submit).toHaveBeenCalledWith('player-2');
  });
});
