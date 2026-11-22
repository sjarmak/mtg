/**
 * What the chosen mode costs the stack strip, measured rather than reasoned.
 *
 * `mtg-dwlr` put a modal spell's chosen mode on the live stack row, and that row
 * is the one place on this table whose width arithmetic is a finding rather than
 * a layout: `../../src/styles/board/stack.ts` records 345px of parts asked into a
 * 214px row at 844x390, with `.mtg-stack__target` chosen to take the whole shrink
 * so the row ends in an ellipsis instead of mid-letter. A second card-authored
 * sentence in that row is a change to exactly that arithmetic, so the check is
 * the one that file's own numbers were taken with, at the viewports
 * `./stack-seam.browser.test.ts` drives, plus the 844x390 the arithmetic came
 * from.
 *
 * The subject is the worst row the strip can be handed: one entry carrying both
 * a mode and a target, which is a modal spell whose chosen mode points at
 * something. Both are card-authored, both are shrinkable, and a row holding the
 * two of them is the case where `.mtg-stack__meta`'s "one part gives" rule has
 * two candidates rather than one.
 *
 * Four claims, and the first two are the bead's:
 *
 * 1. The mode is drawn, at every viewport. A part that shrank to nothing would
 *    pass a "nothing overflowed" check by not being there.
 * 2. Nothing in the row is painted outside the strip. `overflow: hidden` on the
 *    row means an overflowing part is invisible rather than loud, so the check
 *    is against the strip's own box.
 * 3. The Resolve control still answers its own center. It is the one move on
 *    this strip, it is `flex: none`, and a row that pushed it out from under
 *    the pointer would be the failure worth catching.
 * 4. What gives is the mode and target prose and nothing else. The card name is
 *    the inspection control, so it stays complete; `.mtg-stack__meta > *` pins
 *    the controller, the cost and the closing word at their natural width. The
 *    metadata row is itself the clipping viewport around its yielding children,
 *    so its own scroll width may be larger than its box while every fixed child
 *    must still sit wholly inside that box.
 *
 * What the sentence costs is read off a twin: the same position with `mode`
 * taken back off the kernel's stack entry, which is the state a non-modal spell
 * is in and is the one field the row's new part is drawn from. That is
 * `./stack-seam.browser.test.ts`'s `unstacked` trick pointed one field deeper,
 * and it is what makes the delta below an attribution rather than two numbers.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Card, Mode } from '@mtg/dsl';
import { basicLand, exampleCard, parseCard } from '@mtg/dsl';
import { DEFAULT_AUTO_PASS, humanSeat, legalActions, pendingDecision, reduce, scenario } from '@mtg/kernel';
import type { GameSession, GameState, PlayerId } from '@mtg/kernel';
import { describe, expect } from 'vitest';
import { Shell } from '../../src/app/Shell';
import { PlayView } from '../../src/routes/play/PlayView';
import { uiStyleSheet } from '../../src/styles/index';
import { browserIt, launchChrome, measurePage, reason, shutdownChrome } from '../support/chrome';

const ISLAND = basicLand('Island', 'XMP', 251);
const CREATURES = [
  exampleCard('slc-emberflow-raider'),
  exampleCard('slc-skywatch-sentinel'),
  exampleCard('slc-windrider-drake'),
  exampleCard('slc-lifebound-cleric'),
] as const;

/**
 * A modal spell whose second mode points at a creature.
 *
 * Written here rather than taken from the example set because the set prints no
 * modal card with a targeted mode, and that combination is the whole subject:
 * the mode and the target are the two shrinkable parts, and a row that carries
 * only one of them is the row this file already had before the bead.
 *
 * The modes are deliberately long. A card whose modes read "Draw a card." would
 * measure the strip against text no generator writes; `renderEffectList` is the
 * same producer the replay row uses and these are the sentences it emits.
 */
const MODES: readonly Mode[] = [
  { effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }] },
  { effects: [{ kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature' } }] },
];

const FORK: Card = parseCard({
  kind: 'instant',
  id: 'xmp-fork-in-the-path',
  name: 'Fork in the Path',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 42 },
  manaCost: { generic: 1 },
  colors: [],
  subtypes: [],
  supertypes: [],
  keywords: [],
  abilities: [],
  effects: [],
  modes: MODES,
});

function creatureAt(index: number): Card {
  return CREATURES[index % CREATURES.length] ?? CREATURES[0];
}

function sessionOn(state: GameState, events: GameSession['events']): GameSession {
  return {
    seats: [humanSeat('You'), humanSeat('Bot')],
    state,
    events,
    result: null,
    pending: pendingDecision(state),
    choices: [],
    decisions: 0,
    beat: null,
    committed: null,
  };
}

/**
 * `perSide` creatures and four Islands a side, the modal spell cast at mode 1.
 *
 * Walked through `legalActions` and `reduce` rather than stated, the way
 * `./stack-mode.test.ts` and `./stack-seam.browser.test.ts` both do it: what is
 * under measurement is the row the projection draws from a stack the kernel
 * actually holds, and a fabricated entry would measure a string this file wrote.
 */
function modalOnTheStack(perSide: number): GameSession {
  const battlefield = ([0, 1] as const).flatMap((controller) => [
    ...Array.from({ length: perSide }, (_unused, index) => ({
      card: creatureAt(index),
      controller: controller as PlayerId,
      summoningSick: false,
    })),
    ...Array.from({ length: 4 }, () => ({
      card: ISLAND,
      controller: controller as PlayerId,
      summoningSick: false,
    })),
  ]);
  const built = scenario({
    seed: `ui/stack-mode-${String(perSide)}`,
    battlefield,
    hands: [[FORK, FORK, creatureAt(0)], [creatureAt(1)]],
    active: 0,
    turn: 6,
  });
  const cast = legalActions(built.state).find((action) => action.type === 'castSpell' && action.mode === 1);
  if (cast === undefined) throw new Error('the fixture offers no cast at the targeted mode');
  return sessionOn(reduce(built.state, cast).state, built.events);
}

/**
 * The same position with the chosen mode taken back off the entry.
 *
 * Not a second cast: a cast at the other mode would change the target too, and a
 * non-modal spell would change the name, and either way the delta would be a
 * difference between two rows rather than the cost of one sentence. `mode: null`
 * is what the kernel holds for every spell that prints no modes, so the twin is
 * a position a game reaches, and it is exactly the field `mtg-dwlr` taught the
 * live row to read.
 */
function withoutTheMode(game: GameSession): GameSession {
  return sessionOn(
    {
      ...game.state,
      stack: game.state.stack.map((entry) => ({ ...entry, mode: null })),
    },
    game.events,
  );
}

function page(game: GameSession, title: string): string {
  const markup = renderToStaticMarkup(
    h(Shell, {
      mode: 'play',
      onSelectMode: () => undefined,
      children: h(PlayView, {
        session: game,
        viewer: 0,
        names: ['You', 'Bot'],
        onChoose: () => undefined,
        autoPass: DEFAULT_AUTO_PASS,
        onAutoPass: () => undefined,
        onYield: () => undefined,
      }),
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${uiStyleSheet()}html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
}

/**
 * The row's parts, each with what it asked for and what it was given.
 *
 * `scrollWidth` against `clientWidth` rather than a rectangle comparison,
 * because the question claim 4 asks is which part was cut, and a part clipped by
 * its own `overflow: hidden` still reports the full rectangle it laid out in.
 */
const MEASURE = `(() => {
  const round = (value) => Math.round(value * 10) / 10;
  const named = (element) => {
    const cls = element.getAttribute('class');
    return (cls === null || cls === '' ? element.tagName : cls).slice(0, 40);
  };
  const drawn = (element) => {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const b = element.getBoundingClientRect();
    return b.width > 0.5 && b.height > 0.5;
  };
  const boxOf = (element) => {
    if (element === null) return null;
    const b = element.getBoundingClientRect();
    return [round(b.left), round(b.top), round(b.width), round(b.height)];
  };
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  const reachable = (element, x, y) => {
    if (x < 0 || y < 0 || x > width || y > height) return false;
    for (let node = element.parentElement; node !== null; node = node.parentElement) {
      const style = getComputedStyle(node);
      const b = node.getBoundingClientRect();
      if (style.overflowX !== 'visible' && (x < b.left - 0.5 || x > b.right + 0.5)) return false;
      if (style.overflowY !== 'visible' && (y < b.top - 0.5 || y > b.bottom + 0.5)) return false;
    }
    return true;
  };
  const answersItself = (element) => {
    if (element === null || !drawn(element)) return null;
    const b = element.getBoundingClientRect();
    const x = b.left + b.width / 2;
    const y = b.top + b.height / 2;
    if (!reachable(element, x, y)) return 'out of reach';
    const hit = document.elementFromPoint(x, y);
    if (hit === null) return 'nothing is drawn there';
    return hit === element || element.contains(hit) ? null : named(hit);
  };

  const seam = document.querySelector('.mtg-stack-seam');
  const entry = document.querySelector('.mtg-stack__entry');
  const meta = entry === null ? null : entry.querySelector('.mtg-stack__meta');
  const metaBox = meta === null ? null : meta.getBoundingClientRect();
  const seamBox = seam === null ? null : seam.getBoundingClientRect();
  const parts = entry === null ? [] : [...entry.querySelectorAll('*')].filter(drawn).map((element) => {
    const b = element.getBoundingClientRect();
    return {
      what: named(element),
      text: (element.textContent || '').trim().slice(0, 48),
      box: [round(b.left), round(b.top), round(b.width), round(b.height)],
      wanted: round(element.scrollWidth),
      got: round(element.clientWidth),
      clipped: element.scrollWidth - element.clientWidth > 1,
      outside: seamBox === null ? true : round(Math.max(seamBox.left - b.left, b.right - seamBox.right)),
      directMetaChild: element.parentElement === meta,
      insideMeta: metaBox === null || (b.left >= metaBox.left - 0.5 && b.right <= metaBox.right + 0.5),
    };
  });

  // The page-wide claim ./stack-seam.browser.test.ts makes, re-asked here over
  // a row that is one part longer than any it measures.
  const TARGETS = "button, a[href], [role='button'], [tabindex]:not([tabindex='-1']), .mtg-slot[data-slot='play'] > .mtg-card";
  const coveredBySeam = [];
  let targets = 0;
  for (const element of document.querySelectorAll(TARGETS)) {
    if (seam !== null && seam.contains(element)) continue;
    if (!drawn(element)) continue;
    const b = element.getBoundingClientRect();
    const x = b.left + b.width / 2;
    const y = b.top + b.height / 2;
    if (!reachable(element, x, y)) continue;
    targets += 1;
    const hit = document.elementFromPoint(x, y);
    if (hit !== null && (hit === element || element.contains(hit))) continue;
    if (seam !== null && seam.contains(hit)) {
      coveredBySeam.push({ what: named(element), by: hit === null ? 'nothing' : named(hit) });
    }
  }

  // Parts of the row that are in the tree and not on the screen. The list above
  // filters them out, which would let a part that vanished pass every check by
  // not being there -- and one of them does vanish on purpose: the mobile sheet
  // takes the closing word off the strip below its table breakpoint.
  const undrawn = entry === null ? [] : [...entry.querySelectorAll('*')].filter((element) => !drawn(element)).map(named);

  const resolve = entry === null ? null : entry.querySelector('.mtg-stack__resolve');
  return {
    undrawn: undrawn,
    viewport: [window.innerWidth, window.innerHeight],
    seam: boxOf(seam),
    entryBox: boxOf(entry),
    entries: document.querySelectorAll('.mtg-stack__entry').length,
    mode: entry === null ? null : (entry.querySelector('.mtg-stack__mode') || {}).textContent || null,
    target: entry === null ? null : (entry.querySelector('.mtg-stack__target') || {}).textContent || null,
    parts: parts,
    resolveBox: boxOf(resolve),
    resolveCoveredBy: answersItself(resolve),
    targets: targets,
    coveredBySeam: coveredBySeam,
  };
})()`;

interface Part {
  readonly what: string;
  readonly text: string;
  readonly box: readonly number[];
  readonly wanted: number;
  readonly got: number;
  readonly clipped: boolean;
  readonly outside: number;
  readonly directMetaChild: boolean;
  readonly insideMeta: boolean;
}

interface Reading {
  readonly undrawn: readonly string[];
  readonly viewport: readonly number[];
  readonly seam: readonly number[] | null;
  readonly entryBox: readonly number[] | null;
  readonly entries: number;
  readonly mode: string | null;
  readonly target: string | null;
  readonly parts: readonly Part[];
  readonly resolveBox: readonly number[] | null;
  readonly resolveCoveredBy: string | null;
  readonly targets: number;
  readonly coveredBySeam: readonly { readonly what: string; readonly by: string }[];
}

/** The three `./stack-seam.browser.test.ts` drives, plus the width the row's own arithmetic was taken at. */
const VIEWPORTS = [
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [844, 390],
] as const;

/** The prose fields allowed to yield, plus the clipping viewport that contains them. */
const CLIPPABLE = new Set(['mtg-stack__meta', 'mtg-stack__mode', 'mtg-stack__target']);

/** The floor under the population, so a zero cannot be a zero for lack of a page. */
const MIN_TARGETS = 20;

describe('a modal spell’s chosen mode on the live stack strip', () => {
  browserIt(
    'draws the mode inside the strip and leaves the Resolve control pressable at four viewports',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'mtg-stack-mode-'));
      const game = modalOnTheStack(4);
      const file = join(directory, 'stack-mode.html');
      await writeFile(file, page(game, 'A modal spell on the stack'), 'utf8');
      const twinFile = join(directory, 'stack-no-mode.html');
      await writeFile(twinFile, page(withoutTheMode(game), 'The same spell, no chosen mode'), 'utf8');

      let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
      let bodyError: unknown;
      try {
        chrome = await launchChrome(join(directory, 'chrome'));
        // Every cell measured before anything is asserted, so a failure at one
        // viewport still prints the whole matrix and the twin beside it. A rig
        // that asserted as it went reported the first failing width and nothing
        // about the three the reader needs to place it against.
        const readings: { readonly where: string; readonly with: Reading; readonly without: Reading }[] = [];
        for (const [width, height] of VIEWPORTS) {
          const where = `${String(width)}x${String(height)}`;
          const withMode = (await measurePage(
            chrome.client,
            file,
            width,
            height,
            MEASURE,
            `stack-mode ${where}`,
          )) as unknown as Reading;
          const withoutMode = (await measurePage(
            chrome.client,
            twinFile,
            width,
            height,
            MEASURE,
            `stack-mode twin ${where}`,
          )) as unknown as Reading;
          readings.push({ where, with: withMode, without: withoutMode });
          const cut = (reading: Reading): string =>
            JSON.stringify(
              reading.parts
                .filter((part) => part.clipped)
                .map((part) => `${part.what} ${String(part.got)}/${String(part.wanted)}`),
            );
          console.log(
            `${where}: entry ${String(withMode.entryBox?.[2])}px with the mode, ${String(withMode.parts.reduce((total, part) => total + part.wanted, 0))}px of parts asked; cut ${cut(withMode)}; undrawn ${JSON.stringify(withMode.undrawn)}`,
          );
          console.log(
            `${where}: entry ${String(withoutMode.entryBox?.[2])}px without it, ${String(withoutMode.parts.reduce((total, part) => total + part.wanted, 0))}px asked; cut ${cut(withoutMode)}; undrawn ${JSON.stringify(withoutMode.undrawn)}`,
          );
        }

        for (const { where, with: result, without: twin } of readings) {
          const [width, height] = [result.viewport[0], result.viewport[1]];
          expect([width, height], `${where}: viewport`).toEqual(
            VIEWPORTS.map((pair) => [pair[0], pair[1]]).find(
              (pair) => `${String(pair[0])}x${String(pair[1])}` === where,
            ),
          );
          expect(result.entries, `${where}: the strip drew no objects`).toBe(1);
          expect(result.targets, `${where}: too few click targets to be measuring a table`).toBeGreaterThan(
            MIN_TARGETS,
          );

          // Claim 1.
          expect(result.mode, `${where}: the row drew no chosen mode`).toBe(
            'Fork in the Path deals 3 damage to target creature.',
          );
          expect(result.target, `${where}: the row drew no target`).not.toBeNull();
          expect(twin.mode, `${where}: the twin drew a mode it was not given`).toBeNull();

          // Claim 2. `outside` is how far past the strip's own edge a part is
          // painted, so the worst part is the one that has to be reported.
          const escaped = result.parts.filter((part) => part.outside > 0.5);
          expect(
            escaped,
            `${where}: ${String(escaped.length)} parts of the row are painted outside the strip: ${JSON.stringify(escaped)}`,
          ).toEqual([]);
          const twinEscaped = twin.parts.filter((part) => part.outside > 0.5);
          expect(
            twinEscaped,
            `${where}: ${String(twinEscaped.length)} parts of the twin row are painted outside the strip: ${JSON.stringify(twinEscaped)}`,
          ).toEqual([]);

          // Claim 3.
          expect(result.resolveBox, `${where}: the top entry drew no Resolve control`).not.toBeNull();
          expect(
            result.resolveCoveredBy,
            `${where}: the Resolve control does not answer its own center (${String(result.resolveCoveredBy)})`,
          ).toBeNull();
          expect(
            result.coveredBySeam,
            `${where}: the strip covered ${String(result.coveredBySeam.length)} click targets`,
          ).toEqual([]);

          // Claim 4.
          const cut = result.parts.filter((part) => part.clipped && !CLIPPABLE.has(part.what));
          expect(
            cut,
            `${where}: a part the sheet holds at its natural width was cut: ${JSON.stringify(cut)}`,
          ).toEqual([]);
          const clippedMeta = result.parts.filter((part) => part.what === 'mtg-stack__meta' && part.clipped);
          expect(
            clippedMeta,
            `${where}: the metadata viewport was clipped: ${JSON.stringify(clippedMeta)}`,
          ).toEqual([]);
          const twinClippedMeta = twin.parts.filter(
            (part) => part.what === 'mtg-stack__meta' && part.clipped,
          );
          expect(
            twinClippedMeta,
            `${where}: the twin metadata viewport was clipped: ${JSON.stringify(twinClippedMeta)}`,
          ).toEqual([]);
          const hiddenFixedMeta = result.parts.filter(
            (part) => part.directMetaChild && !CLIPPABLE.has(part.what) && !part.insideMeta,
          );
          expect(
            hiddenFixedMeta,
            `${where}: a fixed metadata label fell outside its clipping viewport: ${JSON.stringify(hiddenFixedMeta)}`,
          ).toEqual([]);

          // Claim 5: the strip is where it was. The row inside it is wider by a
          // sentence, and the strip's own box is placed by `styles/board/stack.ts`
          // against a free band that was measured without one -- so the sentence
          // may fill the row and may not move the box.
          expect(twin.seam, `${where}: the twin drew no strip`).not.toBeNull();
          expect(result.seam, `${where}: the mode moved or resized the strip itself`).toEqual(twin.seam);
        }
      } catch (error) {
        bodyError = error;
      } finally {
        if (chrome !== null) await shutdownChrome(chrome);
      }
      if (bodyError !== undefined) throw reason(bodyError);
    },
    120_000,
  );
});
