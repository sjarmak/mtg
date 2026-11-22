// @vitest-environment jsdom
/**
 * That the limited builders say what the cards left in the pool are.
 *
 * `mtg-scps` asked where a limited sideboard is read, and listed three ways to
 * build one: mint a `DeckArtifact` for a sealed or drafted deck and open it in
 * the Deck view, grow a second pane on the pool builder out of
 * `@mtg/deckbuild`'s `DeckBuildResult.sideboard`, or teach `@mtg/decklab` to
 * reason about a constructed sideboard. None was taken. MTGO's limited
 * deckbuilder has no sideboard pane either -- "your card pool appears in the top
 * of the window and represents your full sideboard. The main deck will be in the
 * lower pane"
 * (https://www.mtgo.com/getting-started/getting-started-play-limited) -- because
 * in Limited the sideboard is definitionally everything in the pool you did not
 * play, so a pane holding the leftovers is a restatement of the pane already on
 * screen.
 *
 * What that leaves is naming, and naming is what this file holds to. The pool
 * pane's own line says the cards not in the deck are the sideboard, on both
 * hosts that draw the builder, and neither host grows a third pane for them.
 * Both are asserted because they are one sentence from one function
 * (`../../src/routes/deck/deck-counts.ts`) reaching two screens, and a second
 * copy of it appearing on one of them is the failure this file exists to catch.
 *
 * The Deck view's `Sideboard` pane is untouched and is not the subject here: it
 * draws a built artifact's optional sideboard field, which is what a constructed
 * sideboard feature would fill, and `../deck/` holds its cases.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { DraftPick, HumanDraftProgress } from '@mtg/draft-export';
import { POOL_SIDEBOARD_CLAUSE, poolPaneNote } from '../../src/routes/deck/deck-counts';
import { SIDEBOARD_LABEL } from '../../src/routes/deck/pane-names';
import { DraftGame } from '../../src/routes/draft/DraftGame';
import { SealedBuilder } from '../../src/routes/play/SealedBuilder';
import { chosenCards, deckFor, openSealed } from '../../src/routes/play/sealed';

afterEach(cleanup);

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

const SEED = 'lab/test/pool-is-sideboard';

/** The DOM structurally: this workspace carries no `lib: dom`. */
interface ElementLike {
  readonly textContent: string | null;
  readonly getAttribute: (name: string) => string | null;
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly querySelectorAll: (selector: string) => {
    readonly length: number;
    readonly [index: number]: ElementLike;
  };
}

function like(value: unknown): ElementLike {
  return value as ElementLike;
}

function panes(container: unknown): readonly ElementLike[] {
  const found = like(container).querySelectorAll('.mtg-deck__pane');
  return Array.from({ length: found.length }, (_unused, index) => {
    const pane = found[index];
    if (pane === undefined) throw new Error('a pane vanished between the count and the read');
    return pane;
  });
}

function paneNote(container: unknown, kind: string): string {
  const pane = panes(container).find((found) => found.getAttribute('data-pane') === kind);
  if (pane === undefined) throw new Error(`the builder drew no ${kind} pane`);
  const note = pane.querySelector('.mtg-deck__pane-note');
  if (note === null) throw new Error(`the ${kind} pane drew no note`);
  return note.textContent ?? '';
}

/** The sealed screen on a dealt pool, which is the shape three hosts render. */
function sealed(): { readonly container: unknown; readonly pool: number; readonly outside: number } {
  const build = openSealed(SET, SEED);
  const { container } = render(
    h(SealedBuilder, {
      build,
      deck: deckFor(build),
      onToggle: () => undefined,
      onSuggest: () => undefined,
      onClear: () => undefined,
      onAdjustBasics: () => undefined,
      onSuggestBasics: () => undefined,
      onPlay: () => undefined,
      contextNote: 'Six packs, one deck to build.',
      seed: SEED,
      source: 'sealed' as const,
    }),
  );
  return { container, pool: build.pool.length, outside: build.pool.length - chosenCards(build).length };
}

/**
 * A drafted seat, built rather than run, the way `./sealed-screen.test.ts`
 * builds one: `DraftGame` reads two seats' picks and a seed off the progress,
 * and running a pod to reach 45 picks spends a minute of wall clock to produce
 * the same two pools.
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
    seed: SEED,
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

describe('the pool pane is the limited sideboard', () => {
  it('says so on the sealed builder, on the line that counts the pool', () => {
    const { container, pool, outside } = sealed();
    expect(outside, 'a suggested sealed deck that took the whole pool is not the subject').toBeGreaterThan(0);
    expect(paneNote(container, 'pool'), 'the sealed pool pane does not name the sideboard').toBe(
      poolPaneNote(pool, outside),
    );
    expect(paneNote(container, 'pool')).toContain(POOL_SIDEBOARD_CLAUSE);
  });

  it('says so on the drafted pool as well, from the same sentence', () => {
    const { container } = render(h(DraftGame, { draft: draft(), set: SET }));
    expect(paneNote(container, 'pool'), 'the drafted pool pane does not name the sideboard').toContain(
      POOL_SIDEBOARD_CLAUSE,
    );
  });

  it('says it about the pool and not about the deck', () => {
    const { container } = sealed();
    expect(paneNote(container, 'deck'), 'the deck pane calls itself the sideboard').not.toContain(
      POOL_SIDEBOARD_CLAUSE,
    );
  });

  // The three rejected builds all ended in a third pane or a fourth producer.
  // Two panes is the whole of the decision, and it is the cheap thing to check.
  it('grows no pane for the leftovers on either host', () => {
    const { container } = sealed();
    expect(panes(container), 'the sealed builder drew a pane it was not given').toHaveLength(2);
    expect(screen.queryByRole('region', { name: SIDEBOARD_LABEL })).toBeNull();
    expect(screen.queryByRole('group', { name: SIDEBOARD_LABEL })).toBeNull();
    cleanup();

    const drafted = render(h(DraftGame, { draft: draft(), set: SET }));
    expect(panes(drafted.container), 'the draft builder drew a pane it was not given').toHaveLength(2);
    expect(screen.queryByRole('region', { name: SIDEBOARD_LABEL })).toBeNull();
    expect(screen.queryByRole('group', { name: SIDEBOARD_LABEL })).toBeNull();
  });
});
