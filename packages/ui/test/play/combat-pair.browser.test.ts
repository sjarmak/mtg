// @vitest-environment node
/**
 * An attacker and the blockers staged against it are one bounded group, not two
 * cards that happen to be next to each other.
 *
 * `mtg-7all`. `../../src/board/CombatZone.ts`'s `orderEntries` put each staged
 * blocker immediately after the attacker it answers, and adjacency was the whole
 * of the relation. With one attacker that is unambiguous. With three attackers
 * and one blocker each the row reads attacker, blocker, attacker, blocker, and
 * the only things saying which pairs with which are the height difference, the
 * seat strip and the amber ring — three channels that all say "this is a staged
 * blocker" and none that says "of that one".
 *
 * The drawing that does say it is the one `../../src/styles/board/attach.ts`
 * already uses for an Equipment and its creature: a keylined tray around the
 * pair with a short connector between them. Same vocabulary, same reason — a
 * relation a player has to infer from position is a relation they can infer
 * wrongly under a clock.
 *
 * Measured rather than asserted, because a tray is a claim about boxes: the
 * tray's rectangle contains both cards, no tray overlaps another, and each tray
 * holds exactly the attacker it names and the blockers staged against that
 * attacker. Two viewports, because the band scrolls sideways and 1024x768 is
 * where it starts to.
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
import { browserIt, launchChrome, measurePage, shutdownChrome } from '../support/chrome';

/** The neutral example set: nothing here is a claim about a card. */
const SPELLS = [
  exampleCard('slc-skywatch-sentinel'),
  exampleCard('slc-windrider-drake'),
  exampleCard('slc-lifebound-cleric'),
  exampleCard('slc-emberflow-raider'),
] as const;
const LANDS = [exampleCard('slc-plains'), exampleCard('slc-island')] as const;

const VIEWER = 0 as PlayerId;
const ATTACKER = 1 as PlayerId;

/** The bead's own arrangement: three attackers, one blocker each. */
const ATTACKERS = 3;

/**
 * Three of the far seat's creatures attacking, drawn from the viewer's chair.
 * The attack goes through `reduce`, so the attackers are tapped because the
 * rules tapped them rather than because the fixture said so.
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
    ...Array.from({ length: ATTACKERS }, (_unused, index) => ({
      card: SPELLS[(index + 2) % SPELLS.length] ?? SPELLS[0],
      controller: VIEWER,
      tapped: false,
      summoningSick: false,
    })),
  ];
  const built = scenario({
    seed: 'ui/combat-pair',
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
    .slice(0, ATTACKERS);
  expect(attackers, 'the stated attack has creatures to declare').toHaveLength(ATTACKERS);
  const declared = reduce(built.state, {
    type: 'declareAttackers',
    player: ATTACKER,
    attackers: attackers.map((oid) => ({ oid, defender: VIEWER })),
  });
  return boardPosition(declared.state, VIEWER, ['You', 'Bot']);
}

/**
 * One blocker staged against each attacker, one for one — the arrangement the
 * bead names, where adjacency alone reads as an alternating row.
 *
 * Staging is the view's own state and never reaches the kernel, so it is written
 * onto the projection here exactly as `../../src/routes/play/table.ts` writes it.
 */
function blocking(props: BoardProps): BoardProps {
  const attackers = props.opponent.battlefield.permanents.filter((permanent) => permanent.attacking === true);
  expect(attackers.length, 'attackers to stage a block against').toBe(ATTACKERS);
  const blockers = props.you.battlefield.permanents.filter((permanent) => permanent.card.kind === 'creature');
  expect(blockers.length, 'creatures of the viewer to stage').toBe(ATTACKERS);
  const pairing = new Map(blockers.map((permanent, index) => [permanent.key, attackers[index]] as const));
  const permanents = props.you.battlefield.permanents.map((permanent) => {
    const attacker = pairing.get(permanent.key);
    if (attacker === undefined) return permanent;
    return { ...permanent, stagedBlock: attacker.card.name, stagedBlockKeys: [attacker.key] };
  });
  return { ...props, you: { ...props.you, battlefield: { ...props.you.battlefield, permanents } } };
}

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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Combat pair</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * Every tray in the band: what it holds, where its edges are, and whether it has
 * any edges at all.
 *
 * The cards are read as their painted rectangles rather than their layout boxes,
 * because an attacker is tapped and a quarter turn is paint-only: the tray has
 * to bound what the eye sees.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const strip = document.querySelector('.mtg-combat__strip');
  const pairs = [...document.querySelectorAll('.mtg-combat__pair')].map((pair) => {
    const box = pair.getBoundingClientRect();
    const style = getComputedStyle(pair);
    const entries = [...pair.querySelectorAll('.mtg-combat__entry')].map((entry) => {
      const card = entry.querySelector('.mtg-slot > .mtg-card, .mtg-attach > .mtg-slot > .mtg-card');
      const cardBox = card === null ? null : card.getBoundingClientRect();
      return {
        seat: entry.getAttribute('data-seat'),
        blocks: entry.getAttribute('data-blocks'),
        card: cardBox === null ? null : {
          left: round(cardBox.left), right: round(cardBox.right),
          top: round(cardBox.top), bottom: round(cardBox.bottom),
        },
      };
    });
    return {
      attacker: pair.getAttribute('data-attacker'),
      role: pair.getAttribute('role'),
      label: pair.getAttribute('aria-label'),
      borderWidth: round(parseFloat(style.borderTopWidth)),
      borderColor: style.borderTopColor,
      left: round(box.left), right: round(box.right),
      top: round(box.top), bottom: round(box.bottom),
      entries,
    };
  });
  return {
    viewport: [window.innerWidth, window.innerHeight],
    seats: strip === null ? null : strip.getAttribute('data-seats'),
    entries: document.querySelectorAll('.mtg-combat__entry').length,
    loose: [...document.querySelectorAll('.mtg-combat__strip > .mtg-combat__entry')].length,
    pairs,
  };
})()`;

interface CardBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface EntryReading {
  readonly seat: string;
  readonly blocks: string | null;
  readonly card: CardBox | null;
}

interface PairReading extends CardBox {
  readonly attacker: string | null;
  readonly role: string | null;
  readonly label: string | null;
  readonly borderWidth: number;
  readonly borderColor: string;
  readonly entries: readonly EntryReading[];
}

/** The tray's own keyline may sit on the card's edge, and no further in. */
const TOLERANCE_PX = 1.5;

const VIEWPORTS = [
  [1440, 900],
  [1024, 768],
] as const;

describe('the staged block is drawn as one group', () => {
  browserIt('puts each attacker and its blockers in a bounded tray of their own', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mtg-combat-pair-'));
    const file = join(directory, 'pairs.html');
    await writeFile(file, page(blocking(position())), 'utf8');
    let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
    let bodyError: unknown;
    try {
      chrome = await launchChrome(join(directory, 'chrome'));
      for (const [width, height] of VIEWPORTS) {
        const where = `${String(width)}x${String(height)}`;
        const result = await measurePage(chrome.client, file, width, height, MEASURE, 'combat pair');
        expect(result['viewport']).toEqual([width, height]);
        expect(result['seats'], `${where} both halves in the seam`).toBe('both');
        expect(result['entries'], `${where} cards in the seam`).toBe(ATTACKERS * 2);

        const pairs = result['pairs'] as readonly PairReading[];
        expect(pairs.length, `${where} trays`).toBe(ATTACKERS);
        // Nothing is left loose in the strip: every card in this position is in
        // a pair, so a bare entry here would be a card the tray forgot.
        expect(result['loose'], `${where} entries outside a tray`).toBe(0);

        for (const pair of pairs) {
          const at = `${where}: tray ${pair.attacker ?? '?'}`;
          // Bounded, and bounded visibly. A group with no edge is adjacency
          // again with an extra element in it.
          expect(pair.borderWidth, `${at} keyline`).toBeGreaterThan(0);
          expect(pair.borderColor, `${at} keyline paints`).not.toBe('rgba(0, 0, 0, 0)');
          // Named, because a drawn relation is invisible to a screen reader.
          expect(pair.role, `${at} is a group`).toBe('group');
          expect(pair.label ?? '', `${at} names the block`).toMatch(/blocked by /);

          expect(pair.entries.length, `${at} holds an attacker and its blocker`).toBe(2);
          const [attacker, blocker] = pair.entries;
          expect(attacker?.seat, `${at} opens with the attacker`).toBe('opponent');
          expect(blocker?.seat, `${at} answers with the blocker`).toBe('you');
          // The one thing a picture cannot be read for: the blocker in this
          // tray is staged against the attacker the tray names.
          expect((blocker?.blocks ?? '').split(','), `${at} pairs what it holds`).toContain(pair.attacker);

          for (const entry of pair.entries) {
            const card = entry.card;
            expect(card, `${at} draws ${entry.seat ?? '?'}`).not.toBeNull();
            if (card === null) continue;
            expect(card.left, `${at} ${entry.seat ?? '?'} inside on the left`).toBeGreaterThanOrEqual(
              pair.left - TOLERANCE_PX,
            );
            expect(card.right, `${at} ${entry.seat ?? '?'} inside on the right`).toBeLessThanOrEqual(
              pair.right + TOLERANCE_PX,
            );
            expect(card.top, `${at} ${entry.seat ?? '?'} inside on the top`).toBeGreaterThanOrEqual(
              pair.top - TOLERANCE_PX,
            );
            expect(card.bottom, `${at} ${entry.seat ?? '?'} inside on the bottom`).toBeLessThanOrEqual(
              pair.bottom + TOLERANCE_PX,
            );
          }
        }

        // And the trays are told apart: no two of them share a pixel, at either
        // viewport, which is what "one group" has to mean on a row that scrolls.
        for (let index = 1; index < pairs.length; index += 1) {
          const before = pairs[index - 1];
          const after = pairs[index];
          if (before === undefined || after === undefined) continue;
          expect(after.left, `${where}: tray ${String(index)} clear of the one before`).toBeGreaterThan(
            before.right,
          );
        }
      }
    } catch (error) {
      bodyError = error;
    }
    if (chrome !== null) await shutdownChrome(chrome);
    await rm(directory, { recursive: true, force: true });
    if (bodyError !== undefined) throw bodyError;
  });
});
