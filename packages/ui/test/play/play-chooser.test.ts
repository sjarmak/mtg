// @vitest-environment jsdom
/**
 * Play, before a game: what is there to play, and which of it do you want?
 *
 * `mtg-tewc.5`. the playtester's specification for this page is a question — "Play
 * answers 'what do I want to play?'" — and the two things this file pins are
 * the two halves of the answer that a person can see change: the set the page
 * is showing, and whether the pool they were in the middle of is still there.
 *
 * The Decks half is in `./precon.test.ts`, which is where the staged deck file
 * is; what is here needs no decks and would only be slower for having them.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { PlayRoute } from '../../src/routes/PlayRoute';
import type { PlaySetState } from '../../src/routes/PlayRoute';
import { PLAY_NO_DECKS_NOTE } from '../../src/routes/play/PlayChooser';
import { PLAY_UNNAMED_SET } from '../../src/routes/play/PlayLanding';
import {
  PLAY_GENERATE_LABEL,
  PLAY_RESUME_STALE,
  PLAY_SEALED_BLURB,
  PLAY_SEALED_LABEL,
  resumeNote,
} from '../../src/routes/play/SealedChooser';
import { COMMANDER_UNAVAILABLE_REASON, LAN_UNWIRED_REASON } from '../../src/routes/play/availability';
import { PLAY_LAN_ROOM_LABEL } from '../../src/routes/play/LanSection';
import { OPPONENT_BOT_LABEL, OPPONENT_LAN_LABEL } from '../../src/routes/play/OpponentChoice';
import { openSealed, toggle } from '../../src/routes/play/sealed';
import { uiStyleSheet } from '../../src/styles/index';
import {
  clearSealedSession,
  readSealedSession,
  writeSealedSession,
} from '../../src/routes/play/sealed-session';
import { generateSealed, offersResume, resumeSealed } from '../support/play-chooser';

afterEach(() => {
  cleanup();
  clearSealedSession();
  vi.unstubAllGlobals();
});

/**
 * `path.join` rather than `new URL(literal, import.meta.url)`: Vite rewrites
 * that pattern into an asset URL, which under jsdom resolves against the
 * document's `http://localhost` base instead of the file system.
 */
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
const SEED = 'chooser-test/v0';

function ready(cards: readonly Card[]): PlaySetState {
  return { status: 'ready', cards };
}

/** The deck pane's cards region, which draws one strip per copy. */
const DECK_LABEL = 'Cards in your deck';

/**
 * Copies, counted as strips. Since `mtg-pmpu.1` the deck pane draws one strip
 * per copy rather than one face per distinct card, so a playset is four objects
 * and the count is the deck's size without any arithmetic over a badge.
 */
function deckSize(): number {
  const pane = screen.getByRole('group', { name: DECK_LABEL }) as unknown as {
    readonly querySelectorAll: (selector: string) => { readonly length: number };
  };
  return pane.querySelectorAll('.mtg-strips__card').length;
}

/**
 * Cuts a copy the way the screen offers it: select the strip, then press the
 * button that names the move. Not the double-click accelerator, because this is
 * the path a keyboard and a touch screen also have.
 */
function cutFirstCard(): void {
  const strips = within(screen.getByRole('group', { name: DECK_LABEL })).getAllByRole('button');
  const first = strips[0];
  if (first === undefined) throw new Error('the suggested deck is empty, so there is nothing to cut');
  fireEvent.click(first);
  const bar = screen.getByRole('group', { name: /^Selected: /u });
  fireEvent.click(within(bar).getByRole('button', { name: /^Return /u }));
}

const SHEET = uiStyleSheet();

/** The body of the one rule matching `selector`, or `null` when there is none. */
function rule(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(SHEET);
  return found === null ? null : (found[1] ?? '');
}

describe('the sealed offer', () => {
  /**
   * Requirement 6 of the interface pass, and the set it is about is Magic 2011:
   * a set with no preconstructed decks draws this section and nothing else, so
   * a label, a line and a button loose on a 1440px background were the whole
   * page and read as one that had not finished loading. The marker is asserted
   * with the rule that reads it, because either alone is a half that passes
   * while the page stays wrong.
   */
  it('is a card at reading width rather than controls loose on the page', () => {
    const markup = renderToStaticMarkup(
      h(PlayRoute, { sub: 'sealed', set: ready(SET), setName: 'Tideglass Reach', setKind: 'Custom set' }),
    );
    expect(markup).toContain(`data-boxed="true" aria-label="${PLAY_SEALED_LABEL}"`);
    const boxed = rule(".mtg-playsection[data-boxed='true']");
    expect(boxed, 'the sheet carries no rule for the marker the section draws').not.toBeNull();
    expect(boxed ?? '').toContain('max-inline-size: 40rem');
    expect(boxed ?? '').toContain('border:');
    expect(rule('.mtg-playsection__title')).toContain('font-size: var(--mtg-text-base)');
    expect(rule('.mtg-playsection__blurb')).toContain('font-size: var(--mtg-text-base)');
    expect(rule('.mtg-playsection__blurb')).toContain('max-inline-size: var(--mtg-measure)');
  });
});

describe('the set the chooser says it is showing', () => {
  it('names the set and the category it belongs to', () => {
    render(
      h(PlayRoute, { sub: 'sealed', set: ready(SET), setName: 'Tideglass Reach', setKind: 'Custom set' }),
    );
    expect(screen.getByRole('heading', { name: 'Tideglass Reach' })).toBeTruthy();
    expect(screen.getByText('Custom set')).toBeTruthy();
  });

  /**
   * A page that knows the category and not the name still draws the header, and
   * says so in words rather than leaving an empty heading: the flat-props path
   * has an origin off the index and no row to read a name from.
   */
  it('says so when it does not know which set this is', () => {
    render(h(PlayRoute, { sub: 'sealed', set: ready(SET), setKind: 'Custom set' }));
    expect(screen.getByRole('heading', { name: PLAY_UNNAMED_SET })).toBeTruthy();
  });

  it('draws no header at all when it knows neither', () => {
    render(h(PlayRoute, { sub: 'sealed', set: ready(SET) }));
    expect(screen.queryByRole('heading', { name: PLAY_UNNAMED_SET })).toBeNull();
    expect(screen.getByRole('region', { name: PLAY_SEALED_LABEL })).toBeTruthy();
  });

  /**
   * The playtester, on the header text that used to stand over every view: "that
   * shouldn't be at the top in either the desktop or mobile views, it isn't a
   * useful place to have that always be around on the draft or game play
   * views". So it belongs to the chooser and goes with it.
   */
  it('takes the header away the moment a pool is opened', () => {
    render(
      h(PlayRoute, { sub: 'sealed', set: ready(SET), setName: 'Tideglass Reach', setKind: 'Custom set' }),
    );
    generateSealed();
    expect(screen.queryByRole('heading', { name: 'Tideglass Reach' })).toBeNull();
    expect(screen.queryByText(PLAY_SEALED_BLURB)).toBeNull();
  });
});

describe('the pool you were in the middle of', () => {
  it('offers nothing to resume on a page that has dealt nothing', () => {
    render(h(PlayRoute, { sub: 'sealed', set: ready(SET), seed: SEED }));
    expect(offersResume()).toBe(false);
    expect(screen.queryByText(PLAY_RESUME_STALE)).toBeNull();
  });

  it('offers the pool back, with the cuts that were made in it', () => {
    render(h(PlayRoute, { sub: 'sealed', set: ready(SET), seed: SEED }));
    generateSealed();
    const suggested = deckSize();
    cutFirstCard();
    cutFirstCard();
    expect(deckSize()).toBe(suggested - 2);

    // The reload: the whole page goes and comes back, which is the only thing
    // this feature exists to survive.
    cleanup();
    render(h(PlayRoute, { sub: 'sealed', set: ready(SET), seed: SEED }));
    expect(offersResume()).toBe(true);

    resumeSealed();
    expect(deckSize()).toBe(suggested - 2);
  });

  /** Counts rather than adjectives: the question is whether this is the pool you remember. */
  it('says how much of it was cut, before it is reopened', () => {
    render(h(PlayRoute, { sub: 'sealed', set: ready(SET), seed: SEED }));
    generateSealed();
    cutFirstCard();
    const session = readSealedSession();
    if (session === null) throw new Error('a dealt pool was not stored');

    cleanup();
    render(h(PlayRoute, { sub: 'sealed', set: ready(SET), seed: SEED }));
    expect(screen.getByText(resumeNote(session.poolIds.length, session.chosen.length))).toBeTruthy();
  });

  /**
   * A link that names a seed governs the fresh deal and not the resume.
   *
   * The two seeds are different facts: `#/play?seed=…` names a pool somebody
   * wants dealt, and a resumed build *is* the pool its own seed dealt. Handing
   * the resumed build the link's seed stores a session whose ids no re-deal can
   * match, so the pool survives one reload and is refused at the next one — a
   * lost pool with a wrong reason attached. Read here off the second reload,
   * because the first one would pass either way.
   */
  it('resumes at the seed that dealt the pool, not the one in the link', () => {
    render(h(PlayRoute, { sub: 'sealed', set: ready(SET), seed: SEED }));
    generateSealed();
    cutFirstCard();
    const suggested = deckSize();

    cleanup();
    render(h(PlayRoute, { sub: 'sealed', set: ready(SET), seed: 'a-link-to-another-pool' }));
    expect(offersResume()).toBe(true);
    resumeSealed();
    expect(deckSize()).toBe(suggested);

    cleanup();
    render(h(PlayRoute, { sub: 'sealed', set: ready(SET), seed: 'a-link-to-another-pool' }));
    expect(screen.queryByText(PLAY_RESUME_STALE)).toBeNull();
    expect(offersResume()).toBe(true);
    resumeSealed();
    expect(deckSize()).toBe(suggested);
  });

  /**
   * The refusal, on screen. A stored pool this set can no longer deal draws a
   * sentence and no button: a Resume control that fails when pressed is the
   * thing this repository refuses to draw, which is why `useResume` re-opens
   * the pool at mount rather than at the press.
   */
  it('says a pool it cannot reopen cannot be reopened, and offers no button', () => {
    const elsewhere = openSealed(SET.slice(0, SET.length - 1), SEED);
    writeSealedSession(toggle(elsewhere, 0), SEED, false);

    const { container } = render(h(PlayRoute, { sub: 'sealed', set: ready(SET), seed: SEED }));
    expect(screen.getByText(PLAY_RESUME_STALE)).toBeTruthy();
    expect(offersResume()).toBe(false);

    // And it says what to do about it, above the control that does it.
    // `mtg-dcxg.10`: the sweep photographed the sentence alone under a gap at
    // the foot of the panel, a statement with nothing offered against it. The
    // one thing a person can do here is open a new pool, so the sentence names
    // that and the button it names is the next thing down the panel.
    const root = container as unknown as {
      readonly querySelectorAll: (selector: string) => ArrayLike<{ readonly textContent: string | null }>;
    };
    const parts = [
      ...Array.from(
        root.querySelectorAll(
          '.mtg-playsection[aria-label="Sealed"] p, .mtg-playsection[aria-label="Sealed"] button',
        ),
      ),
    ].map((node) => (node.textContent ?? '').trim());
    expect(parts.indexOf(PLAY_RESUME_STALE)).toBeGreaterThanOrEqual(0);
    expect(parts.indexOf(PLAY_RESUME_STALE)).toBeLessThan(parts.indexOf(PLAY_GENERATE_LABEL));
  });
});

/** A lab that opens rooms, answered to every probe, so the sealed sub's network column has a seat. */
const ROOMING_LAB = { ok: true, protocol: 3, deals: true, rooms: true, drafts: true };

/** The two cells, read as buttons, without the DOM lib. */
function cell(name: string): {
  readonly disabled: boolean;
  readonly parentElement: { readonly textContent: string | null };
} {
  return screen.getByRole('button', { name }) as unknown as {
    readonly disabled: boolean;
    readonly parentElement: { readonly textContent: string | null };
  };
}

describe('one section per game, and the same two columns over each', () => {
  /**
   * `mtg-a982g.1`. The chooser draws the sub the hash names and nothing of the
   * others: Constructed is the decks, Sealed is the pool, Draft is the draft
   * chooser handed in, and every one of them sits under the same bot-or-network
   * choice. A page with no seat callback wired has a network cell it cannot
   * open, and says why beside it rather than dropping the column.
   */
  it('lands on Constructed with the bot open and says why the network is dark', () => {
    render(h(PlayRoute, { set: ready(SET) }));
    expect(screen.getByText(PLAY_NO_DECKS_NOTE)).toBeTruthy();
    expect(screen.queryByRole('region', { name: PLAY_SEALED_LABEL })).toBeNull();
    expect(cell(OPPONENT_BOT_LABEL).disabled).toBe(false);
    const lan = cell(OPPONENT_LAN_LABEL);
    expect(lan.disabled).toBe(true);
    expect(lan.parentElement.textContent).toContain(LAN_UNWIRED_REASON);
  });

  it('draws the sealed offer under Sealed and no decks note there', () => {
    render(h(PlayRoute, { sub: 'sealed', set: ready(SET) }));
    expect(screen.getByRole('region', { name: PLAY_SEALED_LABEL })).toBeTruthy();
    expect(screen.queryByText(PLAY_NO_DECKS_NOTE)).toBeNull();
  });

  it('opens the network column of the sub the hash asks for, in place of the bot body', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify(ROOMING_LAB), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    render(h(PlayRoute, { sub: 'sealed', set: ready(SET), opponent: 'lan', onRoom: () => undefined }));
    expect(await screen.findByRole('button', { name: PLAY_LAN_ROOM_LABEL })).toBeTruthy();
    expect(screen.queryByRole('region', { name: PLAY_SEALED_LABEL })).toBeNull();
  });

  it('hands a press of the network cell to the hash rather than keeping it', () => {
    const onOpponent = vi.fn();
    render(h(PlayRoute, { set: ready(SET), opponent: 'bot', onOpponent, onTable: () => undefined }));
    fireEvent.click(screen.getByRole('button', { name: OPPONENT_LAN_LABEL }));
    expect(onOpponent).toHaveBeenCalledWith('lan');
    // Controlled: the page still draws the bot column until the hash says otherwise.
    expect(screen.getByText(PLAY_NO_DECKS_NOTE)).toBeTruthy();
  });

  it('draws the draft chooser it is handed as the bot column of Draft', () => {
    render(h(PlayRoute, { sub: 'draft', set: ready(SET), draft: h('p', null, 'the draft chooser') }));
    expect(screen.getByText('the draft chooser')).toBeTruthy();
    expect(screen.queryByRole('region', { name: PLAY_SEALED_LABEL })).toBeNull();
    expect(screen.queryByText(PLAY_NO_DECKS_NOTE)).toBeNull();
  });

  it('says Commander is not dealt yet in both columns and offers nothing under them', () => {
    render(h(PlayRoute, { sub: 'commander', set: ready(SET), onTable: () => undefined }));
    expect(screen.getAllByText(COMMANDER_UNAVAILABLE_REASON)).toHaveLength(2);
    expect(cell(OPPONENT_BOT_LABEL).disabled).toBe(true);
    expect(cell(OPPONENT_LAN_LABEL).disabled).toBe(true);
    expect(screen.queryByRole('region', { name: PLAY_SEALED_LABEL })).toBeNull();
    expect(screen.queryByRole('button', { name: PLAY_GENERATE_LABEL })).toBeNull();
  });
});
