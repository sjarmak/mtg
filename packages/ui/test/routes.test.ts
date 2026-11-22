// @vitest-environment jsdom
/**
 * The three default views. Each is the modest, working version of a surface
 * that gets replaced later, so the tests pin the contract the replacements
 * inherit: URL-driven state, honest empty states, no invented numbers.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { AnalysisRoute } from '../src/routes/AnalysisRoute';
import { CardsRoute } from '../src/routes/CardsRoute';
import { GameDetailPanels } from '../src/routes/analysis/game-detail';
import type { GameDetailProps } from '../src/routes/analysis/game-detail';
import { readReplayLog } from '../src/replay/timeline';
import type { ReplayGame, ReplayLog } from '../src/replay/types';
import { ART_PENDING_LABEL } from '../src/card/ArtSlot';
import { artResolver, readArtManifest } from '../src/lab/art-manifest';
import { cardColorIdentity } from '../src/card/identity';
import type { UiRoute } from '../src/app/router';
import { fixtureText } from './support/replay-fixture';

afterEach(cleanup);

const LOG = readReplayLog(fixtureText());

function route(params: Readonly<Record<string, string>> = {}): UiRoute {
  return { mode: 'cards', sub: 'gallery', params };
}

describe('CardsRoute', () => {
  it('shows every card when no identity is pinned', () => {
    render(h(CardsRoute, { cards: EXAMPLE_CARDS, route: route(), onSetParams: () => undefined }));
    expect(screen.getByText(`${EXAMPLE_CARDS.length} of ${EXAMPLE_CARDS.length} shown`)).toBeTruthy();
  });

  it('filters by the identity in the URL', () => {
    const reds = EXAMPLE_CARDS.filter((card) => cardColorIdentity(card) === 'r');
    expect(reds.length).toBeGreaterThan(0);
    render(
      h(CardsRoute, {
        cards: EXAMPLE_CARDS,
        route: route({ identity: 'r' }),
        onSetParams: () => undefined,
      }),
    );
    expect(screen.getByText(`${reds.length} of ${EXAMPLE_CARDS.length} shown`)).toBeTruthy();
  });

  it('writes the chosen identity back to the URL', () => {
    const written: Record<string, string>[] = [];
    render(
      h(CardsRoute, {
        cards: EXAMPLE_CARDS,
        route: route(),
        onSetParams: (params) => {
          written.push({ ...params });
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    expect(written).toEqual([{ identity: 'u' }]);
  });

  it('renders the art the manifest resolves, and the pending frame for the rest', () => {
    const withArt = EXAMPLE_CARDS[0];
    if (withArt === undefined) throw new Error('the DSL example set is empty');
    const parsed = readArtManifest(
      { formatVersion: 2, art: { [withArt.id]: [{ href: 'art/one.png', alt: 'a lantern on a pier' }] } },
      'art.json',
    );
    if (!parsed.ok) throw new Error(parsed.message);
    render(
      h(CardsRoute, {
        cards: EXAMPLE_CARDS,
        route: route(),
        onSetParams: () => undefined,
        artFor: artResolver(parsed.manifest),
      }),
    );
    expect(screen.getByAltText('a lantern on a pier')).toBeTruthy();
    // Every other card keeps the labeled frame: a set part-way through its art
    // run says so on the cards that are still waiting.
    expect(screen.getAllByText(ART_PENDING_LABEL)).toHaveLength(EXAMPLE_CARDS.length - 1);
  });

  it('shows the pending frame for every card when there is no manifest', () => {
    render(h(CardsRoute, { cards: EXAMPLE_CARDS, route: route(), onSetParams: () => undefined }));
    expect(screen.getAllByText(ART_PENDING_LABEL)).toHaveLength(EXAMPLE_CARDS.length);
  });

  it('filters by the rarity in the URL', () => {
    const commons = EXAMPLE_CARDS.filter((card) => card.rarity === 'common');
    expect(commons.length).toBeGreaterThan(0);
    render(
      h(CardsRoute, {
        cards: EXAMPLE_CARDS,
        route: route({ rarity: 'common' }),
        onSetParams: () => undefined,
      }),
    );
    expect(screen.getByText(`${commons.length} of ${EXAMPLE_CARDS.length} shown`)).toBeTruthy();
  });

  it('writes the chosen rarity back to the URL', () => {
    const written: Record<string, string>[] = [];
    render(
      h(CardsRoute, {
        cards: EXAMPLE_CARDS,
        route: route(),
        onSetParams: (params) => {
          written.push({ ...params });
        },
      }),
    );
    fireEvent.change(screen.getByLabelText('Rarity'), { target: { value: 'uncommon' } });
    expect(written).toEqual([{ rarity: 'uncommon' }]);
  });

  // An artifact creature prints both words, so it answers to both filters. The
  // discriminant alone would file it under Creature and hide it from a person
  // asking the set what artifacts it has.
  it('answers the artifact filter with the artifact creature as well as the artifact', () => {
    render(
      h(CardsRoute, {
        cards: EXAMPLE_CARDS,
        route: route({ type: 'artifact' }),
        onSetParams: () => undefined,
      }),
    );
    expect(screen.getByText('Ironclad Golem')).toBeTruthy();
    expect(screen.getByText('Bronze Monument')).toBeTruthy();
  });

  it('narrows on every filter at once', () => {
    const wanted = EXAMPLE_CARDS.filter(
      (card) => cardColorIdentity(card) === 'r' && card.rarity === 'common' && card.kind === 'instant',
    );
    expect(wanted.length).toBeGreaterThan(0);
    expect(wanted.length).toBeLessThan(EXAMPLE_CARDS.length);
    render(
      h(CardsRoute, {
        cards: EXAMPLE_CARDS,
        route: route({ identity: 'r', rarity: 'common', type: 'instant' }),
        onSetParams: () => undefined,
      }),
    );
    expect(screen.getByText(`${wanted.length} of ${EXAMPLE_CARDS.length} shown`)).toBeTruthy();
  });

  it('drops the art window at compact size, and keeps every card', () => {
    render(
      h(CardsRoute, {
        cards: EXAMPLE_CARDS,
        route: route({ size: 'compact' }),
        onSetParams: () => undefined,
      }),
    );
    expect(screen.getByText(`${EXAMPLE_CARDS.length} of ${EXAMPLE_CARDS.length} shown`)).toBeTruthy();
    expect(screen.queryAllByText(ART_PENDING_LABEL)).toHaveLength(0);
  });

  it('draws compact as name strips, one per card, with no card face', () => {
    const view = render(
      h(CardsRoute, {
        cards: EXAMPLE_CARDS,
        route: route({ size: 'compact' }),
        onSetParams: () => undefined,
      }),
    );
    const root = view.container as unknown as {
      querySelectorAll(selector: string): { length: number };
    };
    expect(root.querySelectorAll('.mtg-strips__card')).toHaveLength(EXAMPLE_CARDS.length);
    expect(root.querySelectorAll('.mtg-card')).toHaveLength(0);
  });

  it('marks the one strip whose card the route names as selected at compact', () => {
    const chosen = EXAMPLE_CARDS[0];
    if (chosen === undefined) throw new Error('EXAMPLE_CARDS is empty');
    const view = render(
      h(CardsRoute, {
        cards: EXAMPLE_CARDS,
        route: route({ size: 'compact', card: chosen.id }),
        onSetParams: () => undefined,
      }),
    );
    const root = view.container as unknown as {
      querySelectorAll(selector: string): { length: number };
    };
    expect(root.querySelectorAll('.mtg-strips__card[aria-pressed="true"]')).toHaveLength(1);
  });

  it('writes the size back to the URL, and writes the default one away', () => {
    const written: Record<string, string>[] = [];
    render(
      h(CardsRoute, {
        cards: EXAMPLE_CARDS,
        route: route({ size: 'compact' }),
        onSetParams: (params) => {
          written.push({ ...params });
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Full' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
    expect(written).toEqual([{ size: '' }, { size: 'compact' }]);
  });

  it('teaches the way out of an empty filter', () => {
    render(
      h(CardsRoute, {
        cards: EXAMPLE_CARDS.filter((card) => cardColorIdentity(card) === 'r'),
        route: route({ identity: 'u' }),
        onSetParams: () => undefined,
      }),
    );
    expect(screen.getByText('No cards match these filters')).toBeTruthy();
    expect(screen.getByText(/Widen a filter/)).toBeTruthy();
  });
});

describe('AnalysisRoute', () => {
  it('says what to run when there is nothing to analyze', () => {
    render(h(AnalysisRoute, { state: { status: 'absent' } }));
    expect(screen.getByText('Nothing measured yet')).toBeTruthy();
    expect(screen.getByText(/npm run slice/)).toBeTruthy();
  });

  it('prints every rate beside its denominator', () => {
    render(h(AnalysisRoute, { state: { status: 'ready', log: LOG } }));
    expect(screen.getByText('Run analysis')).toBeTruthy();
    expect(screen.getByText('games read')).toBeTruthy();
    expect(screen.getAllByText('3')).not.toHaveLength(0);
    expect(screen.getByText('3 of 135 games in the run')).toBeTruthy();
    expect(screen.getByText('WU vs WB')).toBeTruthy();
  });

  it('flags an under-sampled matchup instead of reporting it plainly', () => {
    render(h(AnalysisRoute, { state: { status: 'ready', log: LOG } }));
    expect(screen.getByText(/fewer than 30 games/)).toBeTruthy();
  });
});

describe('the per-game drill-down under Analysis', () => {
  // `mtg-2ayr`: this is the statistics log walked turn by turn, and it replaces
  // `ReplayRoute`, which read the same file from a route nothing mounted. The
  // component takes the addressing rather than the route, so these drive it the
  // way `AnalysisView` does.
  const first = (): ReplayGame => {
    const game = LOG.games[0];
    if (game === undefined) throw new Error('fixture has no games');
    return game;
  };

  const draw = (props: Partial<GameDetailProps> = {}): ReturnType<typeof render> =>
    render(
      h(GameDetailPanels, {
        log: LOG,
        gameIndex: 0,
        turn: null,
        onSelectGame: () => undefined,
        onSelectTurn: () => undefined,
        ...props,
      }),
    );

  it('renders one row per recorded turn', () => {
    draw();
    expect(screen.getAllByLabelText(/^Turn \d+$/)).toHaveLength(first().turns.length);
    expect(screen.getByText(`${first().turns.length} recorded`)).toBeTruthy();
  });

  it('opens the last turn when the address names none', () => {
    draw();
    const last = first().turns[first().turns.length - 1];
    if (last === undefined) throw new Error('fixture game has no turns');
    expect(screen.getByText(`End of turn ${last.turn}`)).toBeTruthy();
  });

  it('shows the selected turn and reports library counts it cannot know', () => {
    draw({ turn: 5 });
    expect(screen.getByText('End of turn 5')).toBeTruthy();
    expect(screen.getAllByText('—')).not.toHaveLength(0);
  });

  it('reports the clicked turn to its caller', () => {
    const picked: number[] = [];
    draw({ onSelectTurn: (turn) => picked.push(turn) });
    fireEvent.click(screen.getByLabelText('Turn 3'));
    expect(picked).toEqual([3]);
  });

  it('clamps an out-of-range game index instead of failing', () => {
    draw({ gameIndex: 99 });
    const last = LOG.games[LOG.games.length - 1];
    if (last === undefined) throw new Error('fixture has no games');
    expect(screen.getByText(last.extras.sim_game_seed)).toBeTruthy();
  });

  it('says so rather than drawing an empty rail when a game recorded no turns', () => {
    const game = first();
    const log: ReplayLog = { ...LOG, games: [{ ...game, turns: [] }] };
    render(
      h(GameDetailPanels, {
        log,
        gameIndex: 0,
        turn: null,
        onSelectGame: () => undefined,
        onSelectTurn: () => undefined,
      }),
    );
    expect(screen.getByText('This game recorded no turns')).toBeTruthy();
    expect(screen.queryAllByLabelText(/^Turn \d+$/)).toHaveLength(0);
  });

  it('says so rather than drawing a picker when the file holds no games', () => {
    render(
      h(GameDetailPanels, {
        log: { ...LOG, games: [] },
        gameIndex: 0,
        turn: null,
        onSelectGame: () => undefined,
        onSelectTurn: () => undefined,
      }),
    );
    expect(screen.getByText('No games in this statistics log')).toBeTruthy();
  });
});
