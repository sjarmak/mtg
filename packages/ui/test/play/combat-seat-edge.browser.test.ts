// @vitest-environment node
/**
 * The seat strip: where it sits when it is drawn, and when it is drawn at all.
 *
 * `../../src/board/CombatZone.ts` says what the strip is for: the band is one
 * seam shared by both halves of the table, so a card that has moved into it has
 * left the position that said whose it was, and the strip says it again in that
 * half's own paper.
 *
 * Two claims, and they landed a day apart.
 *
 * **Where.** It was drawn as a border on the entry, which is the same line as
 * the card's edge only while the card is upright. Attacking taps, `rotate` is
 * paint-only, and `../../src/styles/board/slot.ts` squares a tapped slot so the
 * quarter turn has somewhere to land - the card then paints 63/88 of that
 * square, centered, so a seventh of the slot is empty above it and a seventh
 * below. Measured in chrome-headless-shell at 1440x900 before the fix: slot
 * 140.6 square, card painted 140.6 x 100.6, strip on the entry's own edge 20.1px
 * clear of the card. the playtester, 2026-08-18, on what that reads as: a pale bar
 * loose under the card, "some of the attacking card boundary box showing through
 * rather than the actual card border" (`mtg-oeq0`). So the claim is a distance:
 * the strip's near edge is *on* the card's painted edge, whatever the turn did.
 *
 * **When.** The playtester, 2026-08-18, on the fixed strip: draw it only when the row
 * actually contains both seats. A row every card came from one half of already
 * says so without it, which is the whole of declare-attackers, because attacking
 * is one seat's declaration. The case the strip was drawn for is the block - the
 * seam interleaves each attacker with the blockers staged against it, and only
 * there do two cards side by side belong to different people.
 *
 * One position covers both claims and that is not a convenience. Attackers are
 * tapped and staged blockers are not, so the mixed row holds the turned case and
 * the upright case and both seats at once; the same position without the staging
 * is the row that must draw nothing.
 *
 * The strip is a pseudo-element, so there is no box to measure: it is read back
 * off `getComputedStyle(slot, '::before')`, whose insets Chrome resolves to the
 * used pixel values for a positioned pseudo, and whose `content` is `none` when
 * the rule did not match at all. The entry's own height is checked with it,
 * because the strip paints outside the slot and the entry has to keep holding
 * the three pixels either way - reserved whether or not anything is painted in
 * them, so the first staged blocker turns the strips on and moves nothing.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exampleCard } from '@mtg/dsl';
import { reduce, scenario } from '@mtg/kernel';
import type { ObjectId, PlayerId } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { Board } from '../../src/board/Board';
import type { BoardProps } from '../../src/board/Board';
import { boardPosition } from '../../src/routes/play/position';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

/** The neutral example set: nothing here is a claim about a card. */
const SPELLS = [
  exampleCard('slc-skywatch-sentinel'),
  exampleCard('slc-windrider-drake'),
  exampleCard('slc-lifebound-cleric'),
  exampleCard('slc-emberflow-raider'),
] as const;
const LANDS = [exampleCard('slc-plains'), exampleCard('slc-island')] as const;

/** The viewer is always seat 0, so the attack always comes across the seam. */
const VIEWER = 0 as PlayerId;
const ATTACKER = 1 as PlayerId;

/**
 * A mid-combat position with two of the far seat's creatures attacking, drawn
 * from the viewer's chair. The attack goes through `reduce` rather than being
 * written into the state by hand, so the attackers are tapped because the rules
 * tapped them.
 */
function position(): BoardProps {
  const battlefield = [
    ...Array.from({ length: 4 }, (_unused, index) => ({
      card: SPELLS[index % SPELLS.length] ?? SPELLS[0],
      controller: ATTACKER,
      tapped: false,
      summoningSick: false,
    })),
    ...Array.from({ length: 4 }, (_unused, index) => ({
      card: LANDS[index % LANDS.length] ?? LANDS[0],
      controller: ATTACKER,
      tapped: false,
      summoningSick: false,
    })),
    ...Array.from({ length: 3 }, (_unused, index) => ({
      card: SPELLS[(index + 2) % SPELLS.length] ?? SPELLS[0],
      controller: VIEWER,
      tapped: false,
      summoningSick: false,
    })),
  ];
  const built = scenario({
    seed: 'ui/combat-seat-edge',
    battlefield,
    hands: [
      [SPELLS[0], SPELLS[1]],
      [SPELLS[1], SPELLS[2]],
    ],
    step: 'declareAttackers',
    active: ATTACKER,
    turn: 10,
  });
  const attackers: readonly ObjectId[] = built.state.battlefield
    .filter((oid) => {
      const object = built.state.objects[oid];
      return object !== undefined && object.controller === ATTACKER && object.card.kind === 'creature';
    })
    .slice(0, 2);
  expect(attackers, 'the stated attack has creatures to declare').toHaveLength(2);
  const declared = reduce(built.state, {
    type: 'declareAttackers',
    player: ATTACKER,
    attackers: attackers.map((oid) => ({ oid, defender: VIEWER })),
  });
  return boardPosition(declared.state, VIEWER, ['You', 'Bot']);
}

/**
 * The same position with every creature of the viewer's staged in front of the
 * attack, which is the only arrangement this band ever holds both seats in.
 *
 * Staging is the view's own state and never reaches the kernel
 * (`../../src/board/Battlefield.ts`), so it is written onto the projection here
 * exactly as `../../src/routes/play/table.ts` writes it: the name for the
 * sentence, the key for the pairing the seam lays out on.
 */
function blocking(props: BoardProps): BoardProps {
  const attackers = props.opponent.battlefield.permanents.filter((permanent) => permanent.attacking === true);
  expect(attackers.length, 'attackers to stage a block against').toBeGreaterThan(0);
  const blockers = props.you.battlefield.permanents.filter((permanent) => permanent.card.kind === 'creature');
  expect(blockers.length, 'creatures of the viewer to stage').toBeGreaterThan(0);
  const pairing = new Map(
    blockers.map((permanent, index) => [permanent.key, attackers[index % attackers.length]] as const),
  );
  const permanents = props.you.battlefield.permanents.map((permanent) => {
    const attacker = pairing.get(permanent.key);
    if (attacker === undefined) return permanent;
    return { ...permanent, stagedBlock: attacker.card.name, stagedBlockKey: attacker.key };
  });
  return {
    ...props,
    you: { ...props.you, battlefield: { ...props.you.battlefield, permanents } },
  };
}

/**
 * The board in the chrome the play route wraps it in, which is what the band's
 * height share is scoped to (`../../src/styles/board/geometry.ts`). The route's
 * own toolbar and rails are left off: nothing measured here is downstream of
 * them, and the session they need is the one thing this file deliberately does
 * not build, because staging is not in it.
 */
function page(props: BoardProps): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(
        'div',
        { className: 'mtg-play' },
        h('div', { className: 'mtg-play__table' }, h(Board, props)),
      ),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Seat strip</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * One entry: where the card is actually painted, and where the strip landed.
 *
 * A rotated face hands back its turned bounding box, which is exactly what is
 * wanted here - the strip is drawn against what the eye sees, not against the
 * layout box the turn left behind.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const entries = [...document.querySelectorAll('.mtg-combat__entry')].map((entry) => {
    const slot = entry.querySelector('.mtg-slot');
    const card = slot === null ? null : slot.querySelector('.mtg-card');
    if (slot === null || card === null) return null;
    const slotBox = slot.getBoundingClientRect();
    const cardBox = card.getBoundingClientRect();
    const entryBox = entry.getBoundingClientRect();
    const strip = getComputedStyle(slot, '::before');
    const height = parseFloat(strip.blockSize);
    const top = slotBox.top + parseFloat(strip.insetBlockStart);
    return {
      seat: entry.getAttribute('data-seat'),
      tapped: slot.getAttribute('data-tapped') === 'true',
      drawn: strip.content === '""' && strip.backgroundColor !== 'rgba(0, 0, 0, 0)',
      height: round(height),
      width: round(parseFloat(strip.inlineSize)),
      slotWidth: round(slotBox.width),
      // The card's painted edge on the seat's own side, and the strip's edge
      // that is meant to be sitting on it.
      cardEdge: round(entry.getAttribute('data-seat') === 'you' ? cardBox.bottom : cardBox.top),
      stripEdge: round(entry.getAttribute('data-seat') === 'you' ? top : top + height),
      // How far the strip's far side reaches past the entry's own edge, which
      // is what the band's scroller would clip. Never positive.
      overhang: round(
        entry.getAttribute('data-seat') === 'you'
          ? top + height - entryBox.bottom
          : entryBox.top - top,
      ),
      entryHeight: round(entryBox.height),
      slotHeight: round(slotBox.height),
    };
  });
  const divider = document.querySelector('.mtg-board__divider');
  const strip = document.querySelector('.mtg-combat__strip');
  return {
    viewport: [window.innerWidth, window.innerHeight],
    combat: divider === null ? null : divider.getAttribute('data-combat'),
    seats: strip === null ? null : strip.getAttribute('data-seats'),
    entries,
  };
})()`;

interface EntryReading {
  readonly seat: string;
  readonly tapped: boolean;
  readonly drawn: boolean;
  readonly height: number;
  readonly width: number;
  readonly slotWidth: number;
  readonly cardEdge: number;
  readonly stripEdge: number;
  readonly overhang: number;
  readonly entryHeight: number;
  readonly slotHeight: number;
}

function readings(result: Record<string, unknown>): readonly EntryReading[] {
  return (result['entries'] as readonly (EntryReading | null)[]).filter(
    (entry): entry is EntryReading => entry !== null,
  );
}

/**
 * One CSS pixel. The card's painted edge is a fraction of the band's height and
 * the strip is placed from a `calc()` over container units, so the two agree to
 * the pixel rather than to the bit.
 */
const TOLERANCE_PX = 1;

/** What the strip is: `SEAT_EDGE_PX` in `../../src/styles/board/band.ts`. */
const STRIP_PX = 3;

const VIEWPORTS = [
  [1440, 900],
  [1280, 800],
] as const;

describe('the seat strip runs along the attacker, and only in a row holding both seats', () => {
  browserIt(
    'sits on the card the turn actually painted, and is absent from a one-seat row',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-seat-edge-'));
      const attack = position();
      const mixedFile = join(directory, 'mixed.html');
      const oneSeatFile = join(directory, 'one-seat.html');
      await writeFile(mixedFile, page(blocking(attack)), 'utf8');
      await writeFile(oneSeatFile, page(attack), 'utf8');
      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      let rotated = 0;
      let upright = 0;
      const seats = new Set<string>();
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        for (const [width, height] of VIEWPORTS) {
          const where = `${String(width)}x${String(height)}`;

          const mixed = await measurePage(chrome.client, mixedFile, width, height, MEASURE, 'seat strip');
          expect(mixed['viewport']).toEqual([width, height]);
          expect(mixed['combat'], `${where} seam`).toBe('true');
          expect(mixed['seats'], `${where} both halves in the seam`).toBe('both');

          const entries = readings(mixed);
          expect(entries.length, `${where} cards in the seam`).toBeGreaterThan(2);

          for (const entry of entries) {
            const at = `${where}: ${entry.tapped ? 'tapped' : 'upright'} ${entry.seat}`;
            seats.add(entry.seat);
            if (entry.tapped) rotated += 1;
            else upright += 1;

            expect(entry.drawn, `${at} strip drawn`).toBe(true);
            expect(entry.height, `${at} strip thickness`).toBe(STRIP_PX);
            // The card's painted edge and the strip's near edge are the same
            // line. This is the whole of the first defect: before the fix the
            // tapped rows read 20.1 here and the upright ones read 0.
            expect(Math.abs(entry.stripEdge - entry.cardEdge), `${at} strip off the card`).toBeLessThan(
              TOLERANCE_PX,
            );
            // Along the card rather than under part of it.
            expect(entry.width, `${at} strip width`).toBe(entry.slotWidth);
            // And still inside the entry, which is what stops the band's
            // scroller from clipping it away. A tapped entry has room to
            // spare; an upright one has exactly the strip's own thickness,
            // which is the padding the entry reserves for it.
            expect(entry.overhang, `${at} strip past the entry's edge`).toBeLessThan(TOLERANCE_PX);
          }

          // And the row that is one seat's own: same band, same cards, no strip,
          // and the same boxes holding them, because the room is reserved
          // whether or not the strip is painted into it.
          const alone = await measurePage(
            chrome.client,
            oneSeatFile,
            width,
            height,
            MEASURE,
            'seat strip, one seat',
          );
          expect(alone['combat'], `${where} seam without a block`).toBe('true');
          expect(alone['seats'], `${where} one half in the seam`).toBe('one');
          const only = readings(alone);
          expect(only.length, `${where} attackers in the seam`).toBe(2);
          for (const entry of only) {
            const at = `${where}: ${entry.tapped ? 'tapped' : 'upright'} ${entry.seat} alone`;
            expect(entry.seat, `${at} is the attacking seat`).toBe('opponent');
            expect(entry.drawn, `${at} strip not drawn`).toBe(false);
            expect(entry.entryHeight - entry.slotHeight, `${at} room still reserved`).toBeCloseTo(
              STRIP_PX,
              1,
            );
          }
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
          `seat strip Chrome run or cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`,
        );
      }

      // The two cases the distance claim is about were both on screen. A board
      // that drew only upright cards would pass every line above and measure
      // nothing about the turn that caused the defect.
      expect(rotated, 'rotated attackers measured').toBeGreaterThan(0);
      expect(upright, 'upright blockers measured').toBeGreaterThan(0);
      expect([...seats].sort(), 'both seats measured').toEqual(['opponent', 'you']);
    },
    90_000,
  );
});
