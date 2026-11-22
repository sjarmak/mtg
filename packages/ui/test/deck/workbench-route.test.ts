// @vitest-environment jsdom
/**
 * The deck workbench, driven the way a person drives it, against a stubbed
 * server.
 *
 * The server itself is tested over a real socket in
 * `packages/decklab/test/workbench-server.test.ts`; what is unanswerable there
 * and answerable here is the half this page owns. Four things, and the first is
 * the one that costs money to get wrong:
 *
 *  - a server started without a spend ceiling leaves the build button disabled
 *    beside the command that arms it, and everything else on the page still
 *    reads;
 *  - a build is a job the page polls, so "building" is a drawn state rather than
 *    an open fetch;
 *  - a refusal lands next to the field that earned it;
 *  - a citation naming an id nobody stated is drawn as unresolved rather than
 *    hidden, because it is a defect and hiding it is how it survives.
 *
 * `fetch` is stubbed rather than mocked through a library, following the design
 * route's test: a handful of routes each answering a literal is less machinery
 * than a mock server, and it makes "no server" a one-line change, which is the
 * case most worth having.
 *
 * Nothing here proves a pixel; jsdom performs no layout. The two-column
 * arrangement argues itself in `../../src/styles/workbench.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement as h } from 'react';
import { NO_SERVER_NOTE } from '../../src/routes/deck/workbench/client';
import { BUILD_BUTTON_LABEL, UNARMED_NOTE } from '../../src/routes/deck/workbench/CriteriaForm';
import { SHELF_EMPTY_NOTE } from '../../src/routes/deck/workbench/VariationShelf';
import { WorkbenchScreen } from '../../src/routes/deck/workbench/WorkbenchScreen';

const SETS = [{ code: 'XMP', name: 'the flagship set', cardCount: 371 }];

const VARIATION = {
  version: 1,
  id: 'v1',
  name: 'white weenie',
  builtAt: '2026-08-31T20:00:00.000Z',
  parentId: null,
  criteria: { prompt: 'a fast white deck', sets: ['XMP'], colors: ['W'], size: 60, maxCopies: 4, themes: [] },
  statedCriteria: [{ id: 'sets', kind: 'structural', statement: 'printed in XMP' }],
  plan: 'curve out and attack',
  spells: [
    {
      id: 'xmp-skyborn-fledgling',
      name: 'Skyborn Fledgling',
      count: 4,
      manaCost: '{W}',
      manaValue: 1,
      typeLine: 'Creature — Bird Soldier',
      // `archetype` was never stated on these criteria, so this citation must
      // draw as unresolved.
      criteria: ['sets', 'archetype'],
      reason: 'a one-mana flyer',
    },
  ],
  lands: [],
  basics: [{ color: 'W', count: 21, id: 'xmp-plains' }],
  manaBase: {
    totalLands: 21,
    nonBasicLands: 0,
    castabilityTarget: 0.9,
    heavyCastabilityTarget: 0.8,
    colors: [
      { color: 'W', pipCount: 39, sources: 21, sourceFloor: 16, castability: 0.96, meetsTarget: true },
    ],
    landReason: 'a mono-white aggro deck needs its first three land drops',
    landSource: 'model',
  },
  universeSize: 95,
  shortfalls: [],
  build: { rounds: 2, spentUsd: 0.9421, maxSpendUsd: 7 },
};

interface StubOptions {
  /** Missing entirely: every call throws, the way a refused connection does. */
  readonly noServer?: boolean;
  /**
   * The lab is up and the deck server is not, which is the ordinary case: Vite's
   * proxy answers `500 text/plain` with an empty body. Measured against a
   * running lab rather than assumed, and it is a different code path from
   * `noServer` — the fetch succeeds and the parse is what fails.
   */
  readonly deadProxy?: boolean;
  /** Started without a spend ceiling: the build route answers 404 and says so. */
  readonly unarmed?: boolean;
  readonly variations?: readonly unknown[];
  /** Job states handed out in order, so a test can watch running become done. */
  readonly jobStates?: readonly string[];
  /**
   * The build route declining the request itself, which is what it answers when
   * the criteria name a pool it cannot assemble (`mtg-1urk`).
   */
  readonly buildRefusal?: string;
}

function stubFetch(options: StubOptions = {}): void {
  let poll = 0;
  vi.stubGlobal('fetch', (input: string, init?: { method?: string }) => {
    if (options.noServer === true) return Promise.reject(new Error('connection refused'));
    if (options.deadProxy === true) {
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
      } as unknown as Response);
    }
    const url = String(input);
    const answer = (status: number, body: unknown): Promise<Response> =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
      } as Response);

    if (url.endsWith('/deck-api/sets')) {
      return answer(200, { sets: SETS, builds: options.unarmed !== true });
    }
    if (url.endsWith('/deck-api/variations')) {
      return answer(200, { variations: options.variations ?? [], unreadable: [] });
    }
    if (url.includes('/deck-api/variations/')) return answer(200, VARIATION);
    if (url.endsWith('/deck-api/criteria/validate')) {
      return answer(200, {
        ok: false,
        issues: [{ path: ['size'], pointer: '/size', message: 'Too small: expected number to be >=40' }],
      });
    }
    if (url.endsWith('/deck-api/build') && init?.method === 'POST') {
      if (options.buildRefusal !== undefined) return answer(400, { refused: options.buildRefusal });
      if (options.unarmed === true) {
        return answer(404, {
          refused:
            'this server was started without a spend ceiling. Restart with `npm run deckbench -- --max-usd <dollars>`',
        });
      }
      return answer(202, {
        id: 'job1',
        state: 'running',
        name: 'white weenie',
        startedAt: '2026-08-31T20:00:00.000Z',
      });
    }
    if (url.includes('/deck-api/build/')) {
      const state = options.jobStates?.[Math.min(poll, options.jobStates.length - 1)] ?? 'running';
      poll += 1;
      return answer(200, {
        id: 'job1',
        state,
        name: 'white weenie',
        startedAt: '2026-08-31T20:00:00.000Z',
        ...(state === 'done' ? { variation: VARIATION } : {}),
        ...(state === 'failed' ? { error: 'the model refused' } : {}),
      });
    }
    return answer(404, { refused: `no route ${url}` });
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * The rendered tree, reached structurally.
 *
 * The workspace tsconfig carries no `lib: dom` (`src/app/mount.ts` records why),
 * so `document` is not a name that typechecks even though jsdom provides one.
 * `../board-face-cost.test.ts` reaches it the same way and for the same reason.
 */
interface ElementLike {
  readonly textContent: string | null;
  readonly getAttribute: (name: string) => string | null;
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly querySelectorAll: (selector: string) => Iterable<ElementLike>;
}

async function openWorkbench(props: Record<string, unknown> = {}): Promise<ElementLike> {
  const { container } = render(h(WorkbenchScreen, props));
  await waitFor(() => {
    expect(screen.queryByText('Reading the deck server…')).toBeNull();
  });
  return container as unknown as ElementLike;
}

describe('with no server at all', () => {
  it('opens anyway and names the command that starts one', async () => {
    stubFetch({ noServer: true });
    render(h(WorkbenchScreen, {}));

    await waitFor(() => {
      expect(screen.getByText(new RegExp('npm run deckbench'))).toBeTruthy();
    });
    expect(NO_SERVER_NOTE).toContain('npm run deckbench');
  });

  it('says the same thing when the lab is up and only the deck server is missing', async () => {
    // The ordinary case, and a different path: the fetch succeeds through Vite's
    // proxy and the parse is what fails. A page that reported "the deck server
    // answered 500" here would send somebody looking for a bug in a server that
    // is not running.
    stubFetch({ deadProxy: true });
    render(h(WorkbenchScreen, {}));

    await waitFor(() => {
      expect(screen.getByText(NO_SERVER_NOTE)).toBeTruthy();
    });
  });
});

describe('the number the unarmed note tells somebody to type', () => {
  it('is the one the launcher suggests, so the page and the command agree', async () => {
    // `mtg-yp33.6`. `@mtg/ui`'s `src/` may not import `@mtg/decklab` — it reaches
    // `better-sqlite3` — so this figure is necessarily a copy, and a copy that
    // nothing compares is how the page went on recommending $0.50 after it was
    // measured at one selection round. A test tree may draw the arrow that
    // `src/` cannot; `CLAUDE.md` says so.
    const { SUGGESTED_MAX_USD } = await import('../../../decklab/tools/deckbench');

    expect(UNARMED_NOTE).toContain(`--max-usd ${String(SUGGESTED_MAX_USD)}`);
    expect(NO_SERVER_NOTE).toContain(`--max-usd ${String(SUGGESTED_MAX_USD)}`);
  });
});

describe('with a server started without a spend ceiling', () => {
  beforeEach(() => {
    stubFetch({ unarmed: true });
  });

  it('still reads the sets, the form and the shelf', async () => {
    await openWorkbench();

    expect(screen.getByText('the flagship set')).toBeTruthy();
    expect(screen.getByLabelText('Opponent population')).toBeTruthy();
    expect(screen.getByText(SHELF_EMPTY_NOTE)).toBeTruthy();
  });

  it('draws the build button disabled at load, before anybody presses it', async () => {
    // The server says so in its answer to `/sets`, so this is the state a
    // first-run person opens the tab into rather than the state they discover by
    // pressing a button that looked like it worked.
    await openWorkbench();

    expect(screen.getByRole('button', { name: BUILD_BUTTON_LABEL })).toHaveProperty('disabled', true);
    expect(screen.getByText(UNARMED_NOTE)).toBeTruthy();
  });

  it('keeps it disabled when a build is attempted anyway', async () => {
    // A page loaded against an armed server that was restarted unarmed under it
    // still has the refusal to fall back on, so the 404 arm stays wired.
    await openWorkbench();
    fireEvent.change(screen.getByLabelText('What do you want'), { target: { value: 'a fast white deck' } });
    fireEvent.click(screen.getByText('the flagship set'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: BUILD_BUTTON_LABEL })).toHaveProperty('disabled', true);
    });
    expect(screen.getByText(UNARMED_NOTE)).toBeTruthy();
  });
});

describe('the form', () => {
  it('draws a refusal next to the field that earned it', async () => {
    // The server keys issues by pointer precisely so this is possible: a list of
    // refusals under a button is a list somebody has to map back onto ten fields
    // by hand.
    stubFetch();
    const container = await openWorkbench();
    fireEvent.change(screen.getByLabelText('What do you want'), { target: { value: 'a deck' } });

    await waitFor(() => {
      expect(container.querySelector('[data-pointer="/size"].mtg-workbench__issues')).not.toBeNull();
    });
  });

  it('rewrites a machine-worded refusal into one a person can act on', async () => {
    stubFetch();
    await openWorkbench();
    fireEvent.change(screen.getByLabelText('What do you want'), { target: { value: 'a deck' } });

    await waitFor(() => {
      expect(screen.getByText(/this is not a value this field takes/)).toBeTruthy();
    });
  });
});

describe('a build', () => {
  it('is drawn as a running job rather than as an open request', async () => {
    stubFetch({ jobStates: ['running'] });
    await openWorkbench();
    fireEvent.change(screen.getByLabelText('What do you want'), { target: { value: 'a fast white deck' } });
    fireEvent.click(screen.getByText('the flagship set'));
    fireEvent.click(screen.getByRole('button', { name: BUILD_BUTTON_LABEL }));

    await waitFor(() => {
      expect(screen.getByText(/This takes minutes/)).toBeTruthy();
    });
  });

  it('draws what the build refused inside the block the button is pinned in', async () => {
    // `mtg-1urk`. The button is a sticky footer of a pane that scrolls, so a
    // sentence written as a sibling of the form lands at the end of that scroll:
    // measured at 1600x1000, y=1426 in an 836px box, which is a press whose only
    // visible effect is that nothing happened.
    stubFetch({ buildRefusal: 'these criteria cannot be built. sets: no cards satisfy the stated criteria' });
    const container = await openWorkbench();
    fireEvent.change(screen.getByLabelText('What do you want'), { target: { value: 'a fast white deck' } });
    fireEvent.click(screen.getByText('the flagship set'));
    fireEvent.click(screen.getByRole('button', { name: BUILD_BUTTON_LABEL }));

    await waitFor(() => {
      const said = container.querySelector('.mtg-workbench__build .mtg-workbench__refusal');
      expect(said?.textContent).toContain('no cards satisfy the stated criteria');
    });
  });

  it('draws a failed job in the same place, for the same reason', async () => {
    stubFetch({ jobStates: ['failed'] });
    const container = await openWorkbench();
    fireEvent.change(screen.getByLabelText('What do you want'), { target: { value: 'a fast white deck' } });
    fireEvent.click(screen.getByText('the flagship set'));
    fireEvent.click(screen.getByRole('button', { name: BUILD_BUTTON_LABEL }));

    await waitFor(
      () => {
        const said = container.querySelector('.mtg-workbench__build .mtg-workbench__refusal');
        expect(said?.textContent).toContain('the model refused');
      },
      { timeout: 5000 },
    );
  });

  it('shows the deck once the job settles, with the plan the model wrote', async () => {
    stubFetch({ jobStates: ['done'] });
    await openWorkbench();
    fireEvent.change(screen.getByLabelText('What do you want'), { target: { value: 'a fast white deck' } });
    fireEvent.click(screen.getByText('the flagship set'));
    fireEvent.click(screen.getByRole('button', { name: BUILD_BUTTON_LABEL }));

    await waitFor(
      () => {
        expect(screen.getByText('curve out and attack')).toBeTruthy();
      },
      { timeout: 5000 },
    );
    expect(screen.getByText('Skyborn Fledgling')).toBeTruthy();
  });
});

describe('the deck it shows', () => {
  it('marks a citation of an id nobody stated, instead of hiding it', async () => {
    // `mtg-bc2.24`'s second acceptance clause is that every card traces to a
    // stated criterion. A page that quietly dropped an unresolvable citation
    // would make the clause unfalsifiable exactly where somebody looks.
    stubFetch({
      variations: [
        {
          id: 'v1',
          name: 'white weenie',
          builtAt: '2026-08-31T20:00:00.000Z',
          parentId: null,
          prompt: 'a fast white deck',
          sets: ['XMP'],
          totalCards: 60,
          shortfallCount: 0,
        },
      ],
    });
    // No click: the newest variation on the shelf is opened at load, because a
    // right pane holding one sentence while the shelf sits below the fold of the
    // other column is 99.5% of the screen carrying nothing.
    const container = await openWorkbench();

    await waitFor(() => {
      expect(screen.getByText('Skyborn Fledgling')).toBeTruthy();
    });
    const cites = [...container.querySelectorAll('.mtg-workbench__cite')];
    expect(cites.map((node) => [node.textContent, node.getAttribute('data-resolved')])).toStrictEqual([
      ['sets', 'true'],
      ['archetype', 'false'],
    ]);
  });
});

describe('a shelf row says what the build cost', () => {
  // `mtg-yp33.7`. `--max-usd` went from 0.50 to 7 and the surface whose entire
  // safety story is that ceiling could not say what any build had spent against
  // it. The number was measured on every round and thrown away with the run.
  it('draws the dollars and the rounds beside the card count', async () => {
    stubFetch({
      variations: [
        {
          id: 'v1',
          name: 'white weenie',
          builtAt: '2026-08-31T20:00:00.000Z',
          parentId: null,
          prompt: 'a fast white deck',
          sets: ['XMP'],
          totalCards: 60,
          shortfallCount: 0,
          spentUsd: 0.9421,
          rounds: 2,
        },
      ],
    });
    const container = await openWorkbench();

    await waitFor(() => {
      expect(container.querySelector('.mtg-workbench__row-cost')).toBeTruthy();
    });
    // Rounded to the cent, because a bill is read in cents and 0.9421 is not a
    // price anybody has ever been charged.
    expect(container.querySelector('.mtg-workbench__row-cost')?.textContent).toBe('$0.94 over 2 rounds');
  });

  it('says nothing at all about a build made before the cost was recorded', async () => {
    // Silence rather than "$0.00". A build that cost nothing and a build whose
    // cost was never written are different facts, and only one of them is worth
    // drawing a dollar figure for. Every variation on the playtester's shelf today is
    // the second kind.
    stubFetch({
      variations: [
        {
          id: 'v1',
          name: 'white weenie',
          builtAt: '2026-08-31T20:00:00.000Z',
          parentId: null,
          prompt: 'a fast white deck',
          sets: ['XMP'],
          totalCards: 60,
          shortfallCount: 0,
        },
      ],
    });
    const container = await openWorkbench();

    await waitFor(() => {
      expect(container.querySelector('.mtg-workbench__row-name')?.textContent).toBe('white weenie');
    });
    expect(container.querySelector('.mtg-workbench__row-cost')).toBeNull();
  });

  it('says one round in the singular', async () => {
    stubFetch({
      variations: [
        {
          id: 'v1',
          name: 'white weenie',
          builtAt: '2026-08-31T20:00:00.000Z',
          parentId: null,
          prompt: 'a fast white deck',
          sets: ['XMP'],
          totalCards: 60,
          shortfallCount: 0,
          spentUsd: 0.5,
          rounds: 1,
        },
      ],
    });
    const container = await openWorkbench();

    await waitFor(() => {
      expect(container.querySelector('.mtg-workbench__row-cost')).toBeTruthy();
    });
    expect(container.querySelector('.mtg-workbench__row-cost')?.textContent).toBe('$0.50 over 1 round');
  });
});

describe('the open variation says what it spent against its ceiling', () => {
  // The shelf row carries the bill; this is where the ceiling belongs, because
  // "$0.94 over 2 rounds" answers what it cost and only "of a $7.00 ceiling"
  // answers whether there was room to keep going. `mtg-yp33.7`.
  it('names the ceiling the build ran under', async () => {
    stubFetch({
      variations: [
        {
          id: 'v1',
          name: 'white weenie',
          builtAt: '2026-08-31T20:00:00.000Z',
          parentId: null,
          prompt: 'a fast white deck',
          sets: ['XMP'],
          totalCards: 60,
          shortfallCount: 0,
          spentUsd: 0.9421,
          rounds: 2,
        },
      ],
    });
    const container = await openWorkbench();

    await waitFor(() => {
      expect(container.querySelector('.mtg-workbench__variation-cost')).toBeTruthy();
    });
    expect(container.querySelector('.mtg-workbench__variation-cost')?.textContent).toBe(
      '$0.94 over 2 rounds, of a $7.00 ceiling',
    );
  });
});

describe('the left column leads with what has already been built', () => {
  // `mtg-yp33.9`, the playtester's call. Measured at 1600x1000, the shelf started at
  // y=1384 in an 836px column: 548px below the fold, behind the entire form, in
  // a pane whose scrollbar you had to discover. The form is used once per deck
  // and the shelf is what you come back to, so the column now leads with the
  // shelf and the form is what you scroll to when you want a new one.
  it('draws the shelf above the form', async () => {
    stubFetch({
      variations: [
        {
          id: 'v1',
          name: 'white weenie',
          builtAt: '2026-08-31T20:00:00.000Z',
          parentId: null,
          prompt: 'a fast white deck',
          sets: ['XMP'],
          totalCards: 60,
          shortfallCount: 0,
        },
      ],
    });
    const container = await openWorkbench();

    await waitFor(() => {
      expect(container.querySelector('.mtg-workbench__shelf')).toBeTruthy();
    });
    const left = container.querySelector('.mtg-workbench__left');
    const shelf = left?.querySelector('.mtg-workbench__shelf');
    const form = left?.querySelector('.mtg-workbench__form');
    expect(shelf).toBeTruthy();
    expect(form).toBeTruthy();
    // DOCUMENT_POSITION_FOLLOWING: the form comes after the shelf.
    const position = (
      shelf as unknown as { compareDocumentPosition(other: unknown): number }
    ).compareDocumentPosition(form);
    expect(position & 4).toBe(4);
  });
});

describe('playing one built deck against another', () => {
  // The playtester asked to play the Alaric deck against the Vessari deck, and the answer
  // was no: `dealConstructedGame` seats a built list opposite itself. The shelf
  // is the pool of second decks its docblock said did not exist.
  const OTHERS = [
    {
      id: 'v1',
      name: 'Alaric-v1',
      builtAt: '2026-09-01T10:00:00.000Z',
      parentId: null,
      prompt: 'a mono-white weenie deck around Alaric',
      sets: ['XMP'],
      totalCards: 60,
      shortfallCount: 0,
    },
    {
      id: 'v2',
      name: 'Vessari-v3',
      builtAt: '2026-08-31T20:00:00.000Z',
      parentId: null,
      prompt: 'a green-white deck around Vessari',
      sets: ['XMP'],
      totalCards: 60,
      shortfallCount: 0,
    },
  ];

  it('offers every other deck on the shelf as the opponent', async () => {
    stubFetch({ variations: OTHERS });
    const container = await openWorkbench({ onPlay: (): void => {} });

    await waitFor(() => {
      expect(container.querySelector('.mtg-workbench__opponent')).toBeTruthy();
    });
    const options = [
      ...(container.querySelector('.mtg-workbench__opponent')?.querySelectorAll('option') ?? []),
    ];
    // The newest is opened at load, so the deck on screen is Alaric-v1 and it is
    // not among its own opponents. A mirror is still reachable and is the
    // default, because it is the game a lone deck can always be given.
    expect(options.map((option) => option.textContent)).toStrictEqual(['A copy of this deck', 'Vessari-v3']);
  });

  it('draws no opponent picker when the shelf holds only this deck', async () => {
    // One deck has nothing to play against but itself, and a select with one
    // option is a control that cannot be used.
    stubFetch({ variations: [OTHERS[0]] });
    const container = await openWorkbench({ onPlay: (): void => {} });

    await waitFor(() => {
      expect(screen.getByText('Play this deck')).toBeTruthy();
    });
    expect(container.querySelector('.mtg-workbench__opponent')).toBeNull();
  });
});
