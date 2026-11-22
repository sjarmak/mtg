/**
 * What the combat board's face ceiling costs and what it buys, measured.
 *
 * `mtg-zhbz`. Off combat a battlefield face is the largest card the row can
 * hold on both axes, because the row is a size container. In combat the
 * container is deliberately absent — `../src/styles/board/band.ts`'s lane grow
 * factors need the row's content in its flex basis — and the ceiling is a
 * subtraction from the viewport instead:
 * `clamp(4.5rem, (100vh - COMBAT_BOARD_VERTICAL_CHROME_REM)/4, 10rem)`.
 * The bead's question is whether 29.875 is the right number for that
 * subtraction, which nothing had measured.
 *
 * This is the instrument. It renders the four boards of `./combat-board.ts` at
 * six viewports under a sweep of chrome numbers, plus two controls: `ship` is
 * the sheet as it stands, and `strip` deletes the whole combat rule from the
 * sheet so the non-combat ladder applies instead. `flat` is the bead's own
 * 2026-08-16 arm, a flat 10rem ceiling, and it measures identically to `strip`
 * at every cell.
 *
 *     npx tsx packages/ui/tools/combat-cap.ts
 *
 * # What the 2026-08-27 run found
 *
 * **Nothing clips at any arm, including `strip`.** Card faces, mana tiles, hand
 * faces and combat band entries are all inside their containers at every one of
 * the 4 boards x 6 viewports x 7 arms, and neither the page nor the table
 * overflows on the block axis. So the ceiling is not what keeps the combat board
 * from cutting a card: `../src/styles/board/slot.ts`'s height guard on the
 * rotated face is, exactly as `../src/styles/board/hand.ts` says.
 *
 * The hand does not move at all. Its face varies with the board and the viewport
 * (78.2px tall on a sparse board, 156.4 on the crowded one at 1440x900) and is
 * identical across all ten arms, because it is held by its own
 * `COMBAT_HAND_FACE_MAX_REM` rather than by this ceiling.
 *
 * What the number does control is a trade, and the sweep found no arm that wins
 * both halves of it. On a **sparse** board it only shrinks the face: at 1440x900
 * the row can afford 129.2px of card width, an unbound face draws 124.0, and the
 * shipped ceiling draws 105.5.
 * On a **crowded** board the row overflows on the inline axis (`overflow-x:
 * auto`, so the cards are reachable but off screen), and there a smaller face is
 * more creatures visible without scrolling — at 1392x766 the shipped number
 * shows 8 of the near seat's 12 where `strip` shows 7 and `flat` shows 6.
 *
 * | viewport | widest face, ship | strip | near seat visible of 12, ship | strip |
 * | -------- | ----------------- | ----- | ----------------------------- | ----- |
 * | 1440x900 |             105.5 | 124.0 |                             5 |     5 |
 * | 1394x824 |              86.5 | 117.4 |                             6 |     5 |
 * | 1280x800 |              80.5 |  92.0 |                             6 |     6 |
 * | 1024x768 |              72.0 |  72.0 |                             4 |     4 |
 * | 1392x766 |              72.0 |  92.0 |                             8 |     7 |
 * | 1440x560 |              72.0 |  89.8 |                             5 |     5 |
 *
 * The bead's note reported that deleting the arithmetic cuts the near seat's
 * mana band at 1440x560 by 8.2px. It does: the lane's slack goes from 47.7 to
 * 39.4. That is the clamp's **floor** doing the work rather than its arithmetic,
 * though — at 1440x560 the subtraction yields 20.5px and every chrome number
 * from 20rem to 36rem lands on the same 4.5rem floor and the same 47.7.
 *
 * So 29.875 is not uniquely right and nothing in the sweep says it is wrong: it
 * sits on a frontier between card size on a sparse board and reachability on a
 * crowded one, and the two are not commensurable from pixels alone. It stays,
 * and `../test/play/combat-cap.browser.test.ts` holds it, because the neuter
 * that produced this report also showed that deleting the rule outright left
 * both the `browser` and the `unit` projects byte-identical to baseline.
 *
 * Node-only, like everything under `tools/`. It writes its pages to a temporary
 * directory and removes them.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TABLE, THREE_COLUMN_MIN_WIDTH_PX } from '../src/styles/board/geometry';
import { launchChrome, measurePage, shutdownChrome } from '../test/support/chrome-driver';
import { COMBAT_BOARDS, COMBAT_VIEWPORTS, combatBoard, combatPage } from './combat-board';

/**
 * A chrome number in rem, or one of the two controls.
 *
 * `null` is the sheet as it ships. `strip` removes the combat rule from the
 * sheet, which is what deleting the constant would do. `flat` restates the rule
 * with a 10rem ceiling and no arithmetic, which is the arm the bead's
 * 2026-08-16 note measured.
 */
type Arm = number | 'flat' | 'strip' | null;

const SWEEP: readonly Arm[] = [null, 'flat', 'strip', 20, 24, 26, 28, 29.875, 32, 36];

/**
 * The shipped combat rule, verbatim from `uiStyleSheet()`.
 *
 * Matched as a literal rather than by pattern so the `strip` arm cannot quietly
 * remove nothing: if the sheet's wording moves, the run fails instead of
 * reporting a control that was never applied.
 */
const SHIPPED_RULE = `@media (min-width: 901px) {
  :is([data-mtg-mode='play'], [data-mtg-mode='draft'], [data-mtg-mode='replay']) .mtg-board:has(.mtg-board__divider[data-combat='true']) .mtg-board__spells {
    --board-face-max: clamp(
      4.5rem,
      calc((100vh - 29.875rem) / 4),
      10rem
    );
  }
}
`;

/**
 * The shipped rule restated with a different chrome number.
 *
 * Same selector and same media query, appended after the sheet, so it is the
 * later of two equally specific declarations rather than a new rule. Baked into
 * the file rather than set on the element at measuring time: `measurePage`
 * evaluates synchronously and Chrome runs no style recalculation inside that
 * evaluation, so a mutation between two readings lands in the style attribute
 * and changes nothing either `getComputedStyle` or `getBoundingClientRect`
 * reports. A first cut of this sweep did exactly that and produced 240
 * identical measurements.
 */
function override(arm: number | 'flat'): string {
  const value = arm === 'flat' ? '10rem' : `clamp(4.5rem, calc((100vh - ${String(arm)}rem) / 4), 10rem)`;
  return `@media (min-width: ${String(THREE_COLUMN_MIN_WIDTH_PX)}px) {
  ${TABLE} .mtg-board:has(.mtg-board__divider[data-combat='true']) .mtg-board__spells {
    --board-face-max: ${value};
  }
}`;
}

function pageFor(arm: Arm, label: string): string {
  const spec = COMBAT_BOARDS.get(label);
  if (spec === undefined) throw new Error(`no board spec named ${label}`);
  const game = combatBoard(spec);
  if (arm === null) return combatPage(game, { title: 'Combat cap: ship' });
  if (arm === 'strip') {
    const stripped = combatPage(game, { title: 'Combat cap: strip' });
    if (!stripped.includes(SHIPPED_RULE))
      throw new Error('the shipped combat rule moved; update SHIPPED_RULE');
    return stripped.replace(SHIPPED_RULE, '');
  }
  return combatPage(game, { title: `Combat cap: ${String(arm)}`, extraCss: override(arm) });
}

/**
 * Every drawn face against the room its row has, plus what the ceiling's two
 * costs look like from the near seat.
 *
 * Widths are rotation-normalized: a tapped slot is square with the card's height
 * for a side, so the card's *width* is its bounding box's height once it is
 * turned, and comparing a turned card's box width to an upright one's would
 * compare a height to a width.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const seats = [...document.querySelectorAll('.mtg-board__spells')].map((row) => {
    const style = getComputedStyle(row);
    const rowBox = row.getBoundingClientRect();
    const content = row.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const slots = [...row.querySelectorAll(":scope > .mtg-attach > .mtg-slot[data-slot='play']")];
    const clientLeft = rowBox.left;
    const clientRight = rowBox.left + row.clientWidth;
    let faceW = 0;
    let clip = 0;
    let visible = 0;
    for (const slot of slots) {
      const face = slot.querySelector(':scope > .mtg-card');
      const slotBox = slot.getBoundingClientRect();
      if (slotBox.left >= clientLeft - 0.5 && slotBox.right <= clientRight + 0.5) visible += 1;
      if (face === null) continue;
      const faceBox = face.getBoundingClientRect();
      const turned = slot.getAttribute('data-tapped') === 'true';
      faceW = Math.max(faceW, turned ? faceBox.height : faceBox.width);
      clip = Math.max(clip, rowBox.top - faceBox.top, faceBox.bottom - rowBox.bottom);
    }
    return {
      seat: row.closest('.mtg-board__side').getAttribute('data-seat'),
      row: round(rowBox.height),
      content: round(content),
      slots: slots.length,
      visible,
      faceW: round(faceW),
      clip: round(Math.max(0, clip)),
      overflowX: round(row.scrollWidth - row.clientWidth),
    };
  });
  let tileClip = 0;
  let laneSlack = Infinity;
  for (const tile of document.querySelectorAll(".mtg-board__side[data-seat='you'] .mtg-lands > .mtg-slot")) {
    const lane = tile.closest('.mtg-zone__body');
    const tileBox = tile.getBoundingClientRect();
    const laneBox = lane.getBoundingClientRect();
    tileClip = Math.max(tileClip, laneBox.top - tileBox.top, tileBox.bottom - laneBox.bottom);
    laneSlack = Math.min(laneSlack, tileBox.top - laneBox.top, laneBox.bottom - tileBox.bottom);
  }
  let handH = 0;
  for (const face of document.querySelectorAll(".mtg-slot[data-slot='hand'] > .mtg-card")) {
    handH = Math.max(handH, face.getBoundingClientRect().height);
  }
  const divider = document.querySelector('.mtg-board__divider');
  return {
    viewport: [window.innerWidth, window.innerHeight],
    combat: divider === null ? null : divider.getAttribute('data-combat'),
    seats,
    handH: round(handH),
    tileClip: round(Math.max(0, tileClip)),
    laneSlack: laneSlack === Infinity ? null : round(laneSlack),
    pageOverflow: round(Math.max(0, document.documentElement.scrollHeight - window.innerHeight)),
  };
})()`;

interface SeatReading {
  readonly seat: string;
  readonly row: number;
  readonly content: number;
  readonly slots: number;
  readonly visible: number;
  readonly faceW: number;
  readonly clip: number;
  readonly overflowX: number;
}

/** The room a row of this content height can give a card's width, in px. */
function roomForWidth(contentHeight: number): number {
  return Math.round(contentHeight * 0.96 * (63 / 88) * 10) / 10;
}

function armLabel(arm: Arm): string {
  return arm === null ? 'ship' : String(arm);
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'mtg-combat-cap-'));
  const pages: { label: string; arm: Arm; file: string }[] = [];
  for (const label of COMBAT_BOARDS.keys()) {
    for (const arm of SWEEP) {
      const file = join(directory, `board-${label}-${armLabel(arm)}.html`);
      await writeFile(file, pageFor(arm, label), 'utf8');
      pages.push({ label, arm, file });
    }
  }
  const chrome = await launchChrome(join(directory, 'chrome'));
  try {
    console.log(
      'board | viewport | arm | seat | rowH | roomW | faceW | slots | visible | clip | overflowX | tileClip | laneSlack | handH | pageOverflow',
    );
    for (const [width, height] of COMBAT_VIEWPORTS) {
      for (const entry of pages) {
        const result = await measurePage(chrome.client, entry.file, width, height, MEASURE, 'combat cap');
        if (result['combat'] !== 'true') throw new Error(`${entry.label} is not mid-combat`);
        for (const seat of result['seats'] as readonly SeatReading[]) {
          console.log(
            [
              entry.label,
              `${String(width)}x${String(height)}`,
              armLabel(entry.arm),
              seat.seat,
              String(seat.row),
              String(roomForWidth(seat.content)),
              String(seat.faceW),
              String(seat.slots),
              String(seat.visible),
              String(seat.clip),
              String(seat.overflowX),
              String(result['tileClip']),
              String(result['laneSlack']),
              String(result['handH']),
              String(result['pageOverflow']),
            ].join(' | '),
          );
        }
      }
    }
  } finally {
    await shutdownChrome(chrome);
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
