// @vitest-environment jsdom
/**
 * That the sealed builder's hosts hand it a shell to fill.
 *
 * `mtg-sk1c`. The frame itself is `../../src/routes/deck/BuilderScreen.ts`'s and
 * `./sealed-frame.browser.test.ts` measures it; what this file guards is the
 * thing that was actually broken, which is not a rule but a place. Every rule in
 * `../../src/styles/deck.ts` that makes a builder a frame hangs off
 * `.mtg-shell:has(.mtg-screen)`, and the height it divides comes down a flex
 * chain from `.mtg-shell__main`. A host that renders the builder inside a plain
 * box of its own breaks that chain silently: the class is on the page, every
 * selector still matches, and the screen is handed no height, so it lays out as
 * the document it was before. `DraftGame` did exactly that, with a page head of
 * its own above the builder.
 *
 * jsdom lays nothing out, so the chain cannot be measured here; what can be
 * checked is that it exists, and it is two facts rather than one. Each host's
 * wrappers are named, so a new box between the shell and the screen fails this
 * file rather than passing quietly, and every name is then looked up in the
 * sheet: a wrapper that is not declared `flex: 1` with a zero minimum is a
 * wrapper that stops the height, whatever it is called. An unclassed box has no
 * name to look up and fails on the first fact.
 *
 * `RemoteSealed` is the third host and its case is in `./remote-sealed.test.ts`,
 * beside the room fixtures it needs.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { DraftPick, HumanDraftProgress } from '@mtg/draft-export';
import { Shell } from '../../src/app/Shell';
import { uiStyleSheet } from '../../src/styles/index';
import { PlayRoute } from '../../src/routes/PlayRoute';
import { DraftGame } from '../../src/routes/draft/DraftGame';
import { generateSealed } from '../support/play-chooser';

const SET_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'setgen',
  'fixtures',
  'sets',
  'tideglass-reach.set.json',
);

const RAW = JSON.parse(readFileSync(SET_FIXTURE, 'utf8')) as { readonly cards: readonly unknown[] };
const SET: readonly Card[] = RAW.cards.map((card) => parseCard(card));

/**
 * The DOM, reached structurally: this workspace carries no `lib: dom`, the same
 * reason `../deck/stack-box-mount.test.ts` declares its own shapes.
 */
interface ElementLike {
  readonly className: string;
  readonly parentElement: ElementLike | null;
  readonly querySelector: (selector: string) => ElementLike | null;
}

/**
 * Every class the sheet hands the height it was given, as a set.
 *
 * `flex: 1` with a zero minimum is the whole of what a pass-through box is on
 * this page: it takes the column it is in and refuses to be sized by its own
 * content. Read off the sheet rather than listed here, because the list is
 * `../../src/styles/views.ts`'s and a copy of it would go stale on the day
 * somebody adds one.
 */
function passesHeightDown(): ReadonlySet<string> {
  const found = new Set<string>();
  for (const [, selector, body] of uiStyleSheet().matchAll(/([^{}]*)\{([^{}]*)\}/gu)) {
    if (selector === undefined || body === undefined) continue;
    if (!/flex:\s*1\b/u.test(body)) continue;
    if (!/min-(?:block-size|height):\s*0/u.test(body)) continue;
    for (const [, name] of selector.matchAll(/\.([a-z0-9_-]+)/giu)) {
      if (name !== undefined) found.add(name);
    }
  }
  return found;
}

const SIZED = passesHeightDown();

function like(value: unknown): ElementLike {
  return value as ElementLike;
}

/**
 * A drafted seat, built rather than run.
 *
 * `DraftGame` reads two seats' picks and the seed off the progress, so the
 * ratings and directions a real run carries are empty here; running a pod to
 * reach 45 picks takes a minute of wall clock to produce the same two pools.
 */
function seat(index: number, cards: readonly Card[]): { readonly seat: number; readonly picks: DraftPick[] } {
  return {
    seat: index,
    picks: cards.map((card, at) => ({
      round: 1 + Math.floor(at / 15),
      pickNumber: 1 + (at % 15),
      seat: index,
      card,
      packSize: 15 - (at % 15),
      openedBy: index,
    })),
  };
}

function draft(): HumanDraftProgress {
  const spells = SET.filter((card) => card.kind !== 'land');
  return {
    seed: 'ui/sealed-screen',
    humanSeat: 0,
    picks: spells.slice(0, 45).map((card) => card.id),
    seats: [seat(0, spells.slice(0, 45)), seat(1, spells.slice(45, 90))],
    rounds: 3,
    directions: [],
    ratings: [],
    botPolicy: 'native-deck-conditioned/v1',
    nextPick: null,
    result: null,
  };
}

function builderScreenIn(container: unknown): ElementLike {
  const found = like(container).querySelector('.mtg-builder-screen');
  if (found === null) throw new Error('the host drew no builder screen');
  return found;
}

/**
 * The boxes a host put between the shell's main region and the screen, outermost
 * first, each by the classes it carries.
 *
 * An unclassed box comes back as the empty string, which is the shape of the bug
 * this file is about and cannot be looked up in the sheet.
 */
function wrappers(screenElement: ElementLike): readonly string[] {
  const chain: string[] = [];
  let box = screenElement.parentElement;
  while (box !== null && !box.className.split(/\s+/u).includes('mtg-shell__main')) {
    chain.unshift(box.className);
    box = box.parentElement;
  }
  if (box === null) throw new Error('the builder screen is not inside the shell at all');
  return chain;
}

/** Every wrapper a host names has to be one the sheet keeps sizing. */
function expectSized(chain: readonly string[]): void {
  for (const box of chain) {
    const classes = box.split(/\s+/u).filter((name) => name.length > 0);
    expect(classes, 'a box between the shell and the screen carries no class').not.toHaveLength(0);
    expect(
      classes.some((name) => SIZED.has(name)),
      `${box} is between the shell and the screen and the sheet gives it no height to pass on`,
    ).toBe(true);
  }
}

afterEach(cleanup);

describe('the hosts that draw a sealed builder', () => {
  it('lets the play route put the screen straight into the shell', () => {
    const { container } = render(
      h(Shell, {
        mode: 'play',
        onSelectMode: (): void => undefined,
        children: h(PlayRoute, {
          sub: 'sealed',
          set: { status: 'ready', cards: SET },
          seed: 'ui/sealed-screen',
        }),
      }),
    );
    generateSealed();
    const found = builderScreenIn(container);
    expect(found.className).toContain('mtg-screen');
    // The route's own column, which is a flex column that takes what the shell
    // gives it. Named rather than allowed by rule, so a second box added here
    // is a decision somebody makes on purpose.
    const chain = wrappers(found);
    expect(chain).toEqual(['mtg-play-route']);
    expectSized(chain);
  });

  // The one that was wrong. It wrapped the builder in a plain div so it could
  // put a page head above it; the head is now the frame's, which is the slot
  // `BuilderScreen` takes for exactly this.
  it('lets a finished draft do the same, and keeps the word Draft above it', () => {
    const { container } = render(
      h(Shell, {
        mode: 'play',
        sub: 'draft',
        onSelectMode: (): void => undefined,
        children: h(DraftGame, { draft: draft(), set: SET }),
      }),
    );
    const found = builderScreenIn(container);
    expect(wrappers(found)).toEqual([]);
    const head = found.querySelector('.mtg-page-head .mtg-page-title');
    if (head === null) throw new Error('the draft screen drew no title');
    expect((head as unknown as { readonly textContent: string }).textContent).toBe('Draft');
  });
});
