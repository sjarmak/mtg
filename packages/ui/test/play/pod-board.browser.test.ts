// @vitest-environment node
/**
 * A table of four, drawn in the ordinary play shell and measured in a browser.
 *
 * `mtg-bc2.154.6.5.4`. the playtester's ruling (2026-09-20): all three opponents'
 * boards are visible at once, compressed to fit, and when the compression forces
 * a choice it keeps what another player's turn depends on. This is the check that
 * the compression fits, because jsdom lays nothing out and the claim is geometry:
 * the seat rail, three opponent tiles each holding a board and a command-zone
 * strip, the viewer's own pod and command zone, and the attack picker in the
 * combat band, at the three viewports the played table is held to.
 *
 * The position is built by hand from the engine's `TableView`. The kernel deals
 * two seats and the Forge wire carries two, so no backend can send this table yet;
 * `backendBoardPosition` is the function that will draw it when one does, and the
 * Board it feeds is the one a duel is drawn with (a board handed no `pod` is a
 * duel, byte for byte: `test/seat-rail.test.ts`).
 *
 * ## What is asserted
 *
 * - The page does not scroll sideways at any viewport.
 * - The rail draws one row per seat inside the viewport, with each seat's poison and
 *   the commander damage it has taken from each dealer.
 * - Three opponent tiles, side by side, each inside the lanes column, none overlapping.
 * - Every permanent in every opponent's board is in the DOM and drawn at a size, so
 *   compression never becomes omission; none is drawn taller than a tile's stated size.
 * - A board too big for its tile scrolls inside it and never spills out of it, never
 *   widens it, and is never hidden behind overflow that cannot scroll. From 1280 wide
 *   up, all three boards, the sixteen-permanent one included, show with nothing scrolled.
 * - No tile claims the lane's crowded-row contract (`data-crowded`), which would lower
 *   the viewer's hand for the whole board; the one crowded tile says so with
 *   `data-tile-crowded`.
 * - Each seat's command zone is drawn inside its tile with the commander tax in words,
 *   including Di's, whose commander is in play and whose zone is the tally alone.
 * - The viewer's own battlefield keeps at least 70% of the height a duel gives it.
 * - The picker's radios are inside the viewport, none overlaps the confirm, and the
 *   one picked is checked.
 *
 * ## Measured
 *
 * Chrome (chrome-headless-shell) driven over CDP by this test, with the pixel lane
 * held alone.
 * The position is Ana's turn, declaring two attackers, against Bo (7 permanents),
 * Cy (9, one a planeswalker) and Di (16).
 *
 * | viewport  | tile (w x h) | tile board scrolls | viewer battlefield | viewer face  |
 * | --------- | ------------ | ------------------ | ------------------ | ------------ |
 * | 1024x768  | 176 x 243    | Bo 0, Cy 41, Di 89 | 140 (duel 182)     | 44x61 (57x79) |
 * | 1280x800  | 255 x 256    | none               | 147 (duel 189)     | 44x61 (72x101) |
 * | 1440x900  | 309 x 279    | none               | 208 (duel 241)     | 85x119 (98x137) |
 *
 * The viewer's lane pays for the three tiles. At 1280x800 its spells row sits on
 * the 4.5rem identity floor, so a permanent is drawn 61px tall where a duel draws
 * 101px. At 1024x768 the two fuller boards, Cy's and Di's, scroll inside their tiles;
 * Bo's fits. Before the opponents' row was given a basis of its own, its content-driven
 * size (375px of wrapped permanents) took the lane and the viewer's battlefield drew
 * 39px against a duel's 182px, which `VIEWER_LANE_MIN_SHARE` now refuses.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ObjectView, SeatId, SeatView, TableView } from '@mtg/engine';
import { DEFAULT_AUTO_PASS } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { Board } from '../../src/board/Board';
import { backendBoardPosition } from '../../src/routes/play/backend-position';
import { attackControls, NO_STAGING } from '../../src/routes/play/combat';
import type { AttackDefender } from '../../src/routes/play/attack-targets';
import { stepBar } from '../../src/routes/play/toolbar';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

const NAMES = ['Ana', 'Bo', 'Cy', 'Di'] as const;

function permanent(oid: string, controller: SeatId, extra: Partial<ObjectView> = {}): ObjectView {
  return {
    oid,
    name: `Creature ${oid}`,
    typeLine: 'Creature — Bear',
    power: 2,
    toughness: 3,
    tapped: false,
    attacking: false,
    damage: 0,
    controller,
    counters: {},
    ...extra,
  };
}

function land(oid: string, controller: SeatId): ObjectView {
  return permanent(oid, controller, {
    name: 'Forest',
    typeLine: 'Basic Land — Forest',
    power: null,
    toughness: null,
  });
}

/** `count` lands and `creatures` creatures, the mix a mid-game board is. */
function board(seat: SeatId, lands: number, creatures: number): ObjectView[] {
  return [
    ...Array.from({ length: lands }, (_, at) => land(`s${String(seat)}-land-${String(at)}`, seat)),
    ...Array.from({ length: creatures }, (_, at) =>
      permanent(`s${String(seat)}-creature-${String(at)}`, seat, { tapped: at % 3 === 2 }),
    ),
  ];
}

const COMMANDERS: readonly ObjectView[] = NAMES.map((name, seat) =>
  permanent(`cmd-${String(seat)}`, seat as SeatId, {
    name: `${name} the Commander`,
    typeLine: 'Legendary Creature — Human Wizard',
  }),
);

const JACE = permanent('s2-jace', 2, {
  name: 'Jace, Telepath Unbound',
  typeLine: 'Legendary Planeswalker — Jace',
  power: null,
  toughness: null,
  counters: { loyalty: 5 },
});

const ATTACKERS = [
  permanent('s0-creature-0', 0, { attacking: true, tapped: true }),
  permanent('s0-creature-1', 0, { attacking: true, tapped: true }),
];

/** Casts per seat: the tax the command-zone tile has to say without overflowing. */
const CASTS = [2, 0, 1, 3] as const;

function seat(id: SeatId, extra: Partial<SeatView>): SeatView {
  const commander = COMMANDERS[id] as ObjectView;
  return {
    id,
    name: NAMES[id] ?? `Seat ${String(id)}`,
    life: 40,
    hand: id === 0 ? [permanent('s0-hand-0', 0), permanent('s0-hand-1', 0), land('s0-hand-2', 0)] : null,
    handSize: id === 0 ? 3 : 6,
    librarySize: 71,
    graveyard: [],
    exile: [],
    battlefield: [],
    commandZone: id === 3 ? [] : [commander],
    commanderCasts: { [commander.oid]: CASTS[id] ?? 0 },
    commanderDamage: {},
    poison: 0,
    ...extra,
  };
}

/**
 * Ana's turn, declaring attackers. Bo is the seat after her and so the seat the
 * band is drawn from; Cy is crowded with a planeswalker in play and is at low life
 * with poison; Di has the most permanents on the table and no commander in the zone.
 */
const VIEW: TableView = {
  version: 4,
  turn: { number: 9, active: 0, phase: 'combat', step: 'declareAttackers' },
  priority: 0,
  stack: [],
  seats: [
    seat(0, {
      life: 31,
      battlefield: [
        ...board(0, 4, 2).filter((one) => one.power === null),
        ...ATTACKERS,
        permanent('s0-creature-2', 0),
      ],
    }),
    seat(1, { life: 27, battlefield: board(1, 4, 3), poison: 2 }),
    seat(2, { life: 9, battlefield: [...board(2, 5, 3), JACE], poison: 7 }),
    seat(3, { life: 40, battlefield: board(3, 7, 9) }),
  ],
  // matrix[dealer][receiver], summed per dealer: Cy has hit Ana for 14 and Di for 6.
  commanderDamageMatrix: [
    [0, 0, 0, 0],
    [4, 0, 0, 0],
    [14, 0, 0, 6],
    [0, 12, 0, 0],
  ],
} as TableView;

const BO: AttackDefender = { key: 'seat:1', label: 'Bo', kind: 'player' };
const CY: AttackDefender = { key: 'seat:2', label: 'Cy', kind: 'player' };
const DI: AttackDefender = { key: 'seat:3', label: 'Di', kind: 'player' };
const JACE_DEFENDER: AttackDefender = {
  key: 'card:s2-jace',
  label: 'Jace, Telepath Unbound',
  kind: 'planeswalker',
};

/** The same first two seats with nobody else at the table: the duel a pod's lane is compared to. */
const DUEL = {
  version: VIEW.version,
  turn: VIEW.turn,
  priority: VIEW.priority,
  stack: VIEW.stack,
  seats: [VIEW.seats[0], VIEW.seats[1]],
} as TableView;

function page(table: TableView): string {
  const position = backendBoardPosition(table, 0);
  const controls = attackControls(
    {
      ...NO_STAGING,
      eligible: new Set(['s0-creature-0', 's0-creature-1', 's0-creature-2']),
      staged: new Set(['s0-creature-0', 's0-creature-1']),
      confirm: 0,
      targets: {
        options: [BO, CY, DI, JACE_DEFENDER],
        picked: CY.key,
        pick: () => undefined,
        counts: new Map([[CY.key, 2]]),
      },
    },
    () => undefined,
  );
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(
        'div',
        { className: 'mtg-live' },
        h(
          'div',
          { className: 'mtg-play' },
          h('div', { className: 'mtg-toolbar' }, h('button', { className: 'mtg-btn' }, 'Close game')),
          h(
            'div',
            { className: 'mtg-play__table', role: 'region', 'aria-label': 'Game table' },
            h(Board, {
              ...position,
              prompt: h(
                'p',
                null,
                'Declare attackers: choose who to attack, then the creatures that go at them.',
              ),
              steps: stepBar({
                step: 'declareAttackers',
                turnText: 'Turn 9: Ana',
                stepText: 'combat · declare attackers',
                autoPass: DEFAULT_AUTO_PASS,
                onAutoPass: () => undefined,
                canYield: false,
              }),
              combat: controls,
              rail: h('p', null, 'The game log.'),
            }),
          ),
        ),
      ),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pod board</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

const MEASURE = `(() => {
  const box = (node) => {
    if (node === null || node === undefined) return null;
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
  };
  const within = (inner, outer, slack = 1) =>
    inner !== null && outer !== null &&
    inner.left >= outer.left - slack && inner.right <= outer.right + slack &&
    inner.top >= outer.top - slack && inner.bottom <= outer.bottom + slack;
  const overlap = (a, b) =>
    a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const lanes = box(document.querySelector('.mtg-board__lanes'));
  const rail = document.querySelector('.mtg-seat-rail');
  const railRows = [...document.querySelectorAll('.mtg-seat-rail__item')].map((row) => ({
    seat: row.getAttribute('data-seat-index'),
    box: box(row),
    inViewport: within(box(row), viewport),
  }));
  const tiles = [...document.querySelectorAll('.mtg-pod-tile')].map((tile) => {
    const tileBox = box(tile);
    const command = tile.querySelector('.mtg-command');
    const ledger = tile.querySelector('.mtg-command__ledger');
    const well = tile.querySelector('.mtg-zone__body[data-layout="board"]');
    const permanents = well === null ? [] : [...well.querySelectorAll('[data-permanent-key]')];
    const drawn = permanents.filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const wellBox = box(well);
    const body = tile.querySelector('.mtg-board__side');
    return {
      seat: tile.getAttribute('data-seat-index'),
      box: tileBox,
      inLanes: within(tileBox, lanes),
      inViewport: within(tileBox, viewport),
      commandInTile: command === null ? null : within(box(command), tileBox),
      commandText: command?.textContent ?? null,
      ledgerText: ledger?.textContent ?? null,
      ledgerInTile: ledger === null ? null : within(box(ledger), tileBox),
      permanents: permanents.length,
      drawn: drawn.length,
      wellHeight: wellBox === null ? null : wellBox.height,
      wellScroll: well === null ? null : well.scrollHeight - well.clientHeight,
      wellOverflowY: well === null ? null : getComputedStyle(well).overflowY,
      bodySpill: body === null ? null : body.scrollHeight - body.clientHeight,
      tileSpill: tile.scrollWidth - tile.clientWidth,
      tallest: Math.max(0, ...permanents.map((node) => node.getBoundingClientRect().height)),
    };
  });
  const overlaps = [];
  for (let a = 0; a < tiles.length; a += 1) {
    for (let b = a + 1; b < tiles.length; b += 1) {
      if (overlap(tiles[a].box, tiles[b].box)) overlaps.push([tiles[a].seat, tiles[b].seat]);
    }
  }
  const you = document.querySelector('.mtg-board__side[data-seat="you"]');
  const yourCommand = you?.querySelector('.mtg-command') ?? null;
  const yourHand = you?.querySelector('.mtg-hand, [aria-label="Ana hand"]') ?? null;
  const confirm = document.querySelector('.mtg-combat__button[data-kind="confirm"]');
  const radios = [...document.querySelectorAll('.mtg-combat__target')].map((radio) => ({
    label: radio.textContent,
    box: box(radio),
    inViewport: within(box(radio), viewport),
    clashesWithConfirm: confirm === null ? false : overlap(box(radio), box(confirm)),
  }));
  const pods = document.querySelector('.mtg-board__pods');
  const yourBattlefield = you?.querySelector('.mtg-zone__body[data-layout="board"]') ?? null;
  const yourFace = you?.querySelector('.mtg-slot[data-slot="play"] > .mtg-card') ?? null;
  return {
    yourBattlefield: box(yourBattlefield),
    yourFace: box(yourFace),
    viewport: [window.innerWidth, window.innerHeight],
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    lanes,
    railPresent: rail !== null,
    railRows,
    railBox: box(rail),
    railText: rail?.textContent ?? '',
    damageChips: [...document.querySelectorAll('.mtg-seat-rail__damage')].map((chip) => ({
      dealer: chip.getAttribute('data-dealer'),
      amount: chip.querySelector('.mtg-seat-rail__damage-amount')?.textContent ?? null,
      tone: chip.getAttribute('data-tone'),
    })),
    laneCrowded: document.querySelectorAll('.mtg-board__spells[data-crowded]').length,
    tileCrowded: document.querySelectorAll('.mtg-pod-tile .mtg-board__spells[data-tile-crowded="true"]').length,
    poison: [...document.querySelectorAll('.mtg-seat-rail__poison')].map((one) => one.getAttribute('data-amount')),
    tiles,
    overlaps,
    opponentsGroup: document.querySelector('.mtg-board__opponents')?.getAttribute('data-opponents') ?? null,
    yourCommand: box(yourCommand),
    yourCommandInViewport: within(box(yourCommand), viewport),
    yourCommandText: yourCommand?.textContent ?? '',
    yourHandInViewport: within(box(yourHand), viewport),
    podsScroll: pods === null ? null : pods.scrollHeight - pods.clientHeight,
    podsBox: box(pods),
    radios,
    picked: document.querySelector('.mtg-combat__target[aria-checked="true"]')?.getAttribute('data-target') ?? null,
    confirmText: confirm?.textContent ?? null,
    confirmInViewport: within(box(confirm), viewport),
  };
})()`;

const VIEWPORTS = [
  [1024, 768],
  [1280, 800],
  [1440, 900],
] as const;

/** From this width the three opponents' boards, the crowded one included, fit with nothing scrolled. */
const FITS_WITHOUT_SCROLL_FROM = 1280;

/**
 * The share of a duel's battlefield the viewer keeps at a pod. Before the opponents'
 * row was given a stated basis it drew 39px against a duel's 182px at 1024x768 (0.21);
 * the measured share is about 0.77 there and higher on wider tables.
 */
const VIEWER_LANE_MIN_SHARE = 0.7;

interface Box {
  readonly width: number;
  readonly height: number;
}

interface Tile {
  readonly seat: string;
  readonly inLanes: boolean;
  readonly inViewport: boolean;
  readonly commandInTile: boolean | null;
  readonly commandText: string | null;
  readonly ledgerText: string | null;
  readonly ledgerInTile: boolean | null;
  readonly permanents: number;
  readonly drawn: number;
  readonly wellScroll: number | null;
  readonly wellOverflowY: string | null;
  readonly bodySpill: number | null;
  readonly tileSpill: number;
  readonly tallest: number;
}

interface Radio {
  readonly label: string;
  readonly inViewport: boolean;
  readonly clashesWithConfirm: boolean;
}

interface Chip {
  readonly dealer: string;
  readonly amount: string;
  readonly tone: string;
}

describe('a table of four on the shared play board', () => {
  browserIt(
    'draws the rail, every opponent’s board at once with its command zone, and the attack picker, inside the viewport',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-pod-board-'));
      const podFile = join(directory, 'pod.html');
      const duelFile = join(directory, 'duel.html');
      await writeFile(podFile, page(VIEW), 'utf8');
      await writeFile(duelFile, page(DUEL), 'utf8');
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [width, height] of VIEWPORTS) {
          const where = `${String(width)}x${String(height)}`;
          const result = await measurePage(chrome.client, podFile, width, height, MEASURE, 'pod board');
          expect(result['viewport'], where).toEqual([width, height]);
          expect(result['documentWidth'], `${where} page width`).toBeLessThanOrEqual(width);

          expect(result['railPresent'], `${where} rail`).toBe(true);
          const rows = result['railRows'] as readonly {
            readonly seat: string;
            readonly inViewport: boolean;
          }[];
          expect(
            rows.map((row) => row.seat),
            `${where} rail rows`,
          ).toEqual(['0', '1', '2', '3']);
          for (const row of rows) expect(row.inViewport, `${where} rail row ${row.seat}`).toBe(true);
          expect(result['poison'], `${where} poison`).toEqual(['0', '2', '7', '0']);
          expect(result['railText'], `${where} rail text`).toContain('Cy');
          // Ana's row, then Bo's, Cy's and Di's: the matrix [dealer][receiver] read by receiver.
          const chips = result['damageChips'] as readonly Chip[];
          expect(
            chips.map((chip) => `${chip.dealer}:${chip.amount}`),
            `${where} commander damage`,
          ).toEqual(['1:4', '2:14', '3:0', '0:0', '2:0', '3:12', '0:0', '1:0', '3:0', '0:0', '1:0', '2:6']);
          // Fourteen of twenty-one is the two-thirds line; twelve is under it.
          expect(
            chips.find((chip) => chip.dealer === '2' && chip.amount === '14')?.tone,
            `${where} tone`,
          ).toBe('warn');
          expect(
            chips.find((chip) => chip.dealer === '3' && chip.amount === '12')?.tone,
            `${where} tone`,
          ).toBe('none');

          expect(result['opponentsGroup'], `${where} opponents`).toBe('3');
          const tiles = result['tiles'] as readonly Tile[];
          expect(
            tiles.map((tile) => tile.seat),
            `${where} tile order`,
          ).toEqual(['1', '2', '3']);
          for (const tile of tiles) {
            expect(tile.inLanes, `${where} tile ${tile.seat} in lanes`).toBe(true);
            expect(tile.inViewport, `${where} tile ${tile.seat} in viewport`).toBe(true);
            // Compression is not omission: every permanent is in the DOM and drawn at a size.
            expect(tile.drawn, `${where} tile ${tile.seat} drawn`).toBe(tile.permanents);
            // A board too big for its tile scrolls inside the tile. It never spills out of it,
            // never widens it, and never hides behind overflow that cannot be scrolled.
            expect(tile.bodySpill, `${where} tile ${tile.seat} spills past its side`).toBeLessThanOrEqual(1);
            expect(tile.tileSpill, `${where} tile ${tile.seat} widens`).toBeLessThanOrEqual(1);
            if ((tile.wellScroll ?? 0) > 1) {
              expect(['auto', 'scroll'], `${where} tile ${tile.seat} scrolls`).toContain(tile.wellOverflowY);
            }
            if (width >= FITS_WITHOUT_SCROLL_FROM) {
              expect(tile.wellScroll, `${where} tile ${tile.seat} scrolls`).toBeLessThanOrEqual(1);
            }
            // A permanent is drawn at the size the tile states, not at a lane's.
            expect(tile.tallest, `${where} tile ${tile.seat} tallest permanent`).toBeLessThanOrEqual(60);
          }
          expect(result['overlaps'], `${where} tile overlaps`).toEqual([]);
          expect(
            tiles.map((tile) => tile.permanents),
            `${where} permanents per tile`,
          ).toEqual([7, 9, 16]);

          // The crowded row's lane contract is never claimed by a tile: a crowded opponent
          // would otherwise lower the viewer's hand for the whole board.
          expect(result['laneCrowded'], `${where} lane crowded`).toBe(0);
          expect(result['tileCrowded'], `${where} tile crowded`).toBe(1);

          // A command zone per seat, with the tax in words. Di's commander is in play, so its
          // zone is the tally alone.
          expect(
            tiles.map((tile) => tile.commandInTile),
            `${where} command zones`,
          ).toEqual([true, true, true]);
          expect(
            tiles.filter((tile) => tile.ledgerText !== null).map((tile) => [tile.seat, tile.ledgerText]),
            `${where} tax`,
          ).toEqual([
            ['1', 'not yet cast'],
            ['2', 'cast 1× · tax {2}next {2}'],
          ]);
          for (const tile of tiles.filter((one) => one.ledgerText !== null)) {
            expect(tile.ledgerInTile, `${where} tile ${tile.seat} ledger in tile`).toBe(true);
          }
          const di = tiles[2] as Tile;
          expect(di.commandText, `${where} Di's zone`).toContain('commander in play');
          expect(di.commandText, `${where} Di's tax`).toContain('cast 3×');
          expect(di.commandText, `${where} Di's tax`).toContain('tax {6}');

          expect(result['yourCommandInViewport'], `${where} your command zone`).toBe(true);
          expect(result['yourCommandText'], `${where} your tax`).toContain('cast 2×');
          expect(result['yourHandInViewport'], `${where} your hand`).toBe(true);

          // The viewer's own lane is not starved to make room for three others.
          const duel = await measurePage(chrome.client, duelFile, width, height, MEASURE, 'duel board');
          const yours = result['yourBattlefield'] as Box;
          const inDuel = duel['yourBattlefield'] as Box;
          expect(
            yours.height / inDuel.height,
            `${where} viewer battlefield ${String(yours.height)} vs duel ${String(inDuel.height)}`,
          ).toBeGreaterThanOrEqual(VIEWER_LANE_MIN_SHARE);
          expect((result['yourFace'] as Box).height, `${where} your face`).toBeGreaterThan(0);

          const radios = result['radios'] as readonly Radio[];
          expect(
            radios.map((radio) => radio.label.replace(/\d+$/, '')),
            `${where} picker`,
          ).toEqual(['Bo', 'Cy', 'Di', 'Jace, Telepath Unbound']);
          for (const radio of radios) {
            expect(radio.inViewport, `${where} radio ${radio.label}`).toBe(true);
            expect(radio.clashesWithConfirm, `${where} radio ${radio.label} vs confirm`).toBe(false);
          }
          expect(result['picked'], `${where} picked`).toBe('seat:2');
          expect(result['confirmText'], `${where} confirm`).toBe('Attack with 2');
          expect(result['confirmInViewport'], `${where} confirm in viewport`).toBe(true);
        }
      } catch (error) {
        bodyError = error;
      }

      const cleanupErrors: Error[] = [];
      if (chrome !== null) {
        try {
          await shutdownChrome(chrome);
        } catch (error) {
          cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(new Error(`could not remove Chrome fixture ${directory}: ${reason(error)}`));
      }
      if (bodyError !== undefined) {
        cleanupErrors.unshift(bodyError instanceof Error ? bodyError : new Error(String(bodyError)));
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          `pod board Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }
    },
    120_000,
  );
});
