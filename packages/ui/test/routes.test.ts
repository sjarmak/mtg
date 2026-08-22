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
import { ReplayRoute } from '../src/routes/ReplayRoute';
import { readReplayLog } from '../src/replay/timeline';
import { ART_PENDING_LABEL } from '../src/card/ArtSlot';
import { artResolver, readArtManifest } from '../src/lab/art-manifest';
import { cardColorIdentity } from '../src/card/identity';
import type { UiRoute } from '../src/app/router';
import { fixtureText } from './support/replay-fixture';

afterEach(cleanup);

const LOG = readReplayLog(fixtureText());

function route(params: Readonly<Record<string, string>> = {}): UiRoute {
  return { mode: 'cards', params };
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

describe('ReplayRoute', () => {
  const replayRoute = (params: Readonly<Record<string, string>> = {}): UiRoute => ({
    mode: 'replay',
    params,
  });

  it('says where a replay would come from when there is none', () => {
    render(h(ReplayRoute, { log: null, route: replayRoute(), onSetParams: () => undefined }));
    expect(screen.getByText('No replay loaded')).toBeTruthy();
  });

  it('renders one row per recorded turn', () => {
    const game = LOG.games[0];
    if (game === undefined) throw new Error('fixture has no games');
    render(h(ReplayRoute, { log: LOG, route: replayRoute(), onSetParams: () => undefined }));
    expect(screen.getAllByLabelText(/^Turn \d+$/)).toHaveLength(game.turns.length);
    expect(screen.getByText(`${game.turns.length} recorded`)).toBeTruthy();
  });

  it('shows the selected turn and reports library counts it cannot know', () => {
    render(
      h(ReplayRoute, {
        log: LOG,
        route: replayRoute({ game: '0', turn: '5' }),
        onSetParams: () => undefined,
      }),
    );
    expect(screen.getByText('End of turn 5')).toBeTruthy();
    expect(screen.getAllByText('—')).not.toHaveLength(0);
  });

  it('writes the clicked turn back to the URL', () => {
    const written: Record<string, string>[] = [];
    render(
      h(ReplayRoute, {
        log: LOG,
        route: replayRoute({ game: '0' }),
        onSetParams: (params) => {
          written.push({ ...params });
        },
      }),
    );
    fireEvent.click(screen.getByLabelText('Turn 3'));
    expect(written).toEqual([{ turn: '3' }]);
  });

  it('clamps an out-of-range game index instead of failing', () => {
    render(
      h(ReplayRoute, {
        log: LOG,
        route: replayRoute({ game: '99' }),
        onSetParams: () => undefined,
      }),
    );
    const last = LOG.games[LOG.games.length - 1];
    if (last === undefined) throw new Error('fixture has no games');
    expect(screen.getByText(last.extras.sim_game_seed)).toBeTruthy();
  });
});
