// @vitest-environment jsdom
/**
 * The Games section, and the game it lets you walk.
 *
 * `mtg-2ayr`'s detail half, tested through `AnalysisSurface` rather than
 * through the panel: what the bead is about is the drill-down being REACHABLE
 * from the aggregate, and being addressed by the same route params every other
 * piece of this surface uses. The panel's own behavior is in
 * `../routes.test.ts`.
 *
 * The distinction the section has to keep is the one that made two surfaces:
 * this reads `@mtg/sim`'s statistics log, the Replay tab reads the kernel
 * decision log, and the copy here must not call itself a replay.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AnalysisSurface } from '../../src/routes/analysis/AnalysisView';
import type { AnalysisRunView } from '../../src/routes/analysis/AnalysisView';
import type { AnalysisLogState } from '../../src/routes/AnalysisRoute';
import { readReplayLog } from '../../src/replay/timeline';
import type { ReplayLog } from '../../src/replay/types';
import type { UiRoute } from '../../src/app/router';
import { fixtureText } from '../support/replay-fixture';
import { loadRun, loadSet } from './support/fixtures';

afterEach(cleanup);

const LOG: ReplayLog = readReplayLog(fixtureText());
const VIEWS: readonly AnalysisRunView[] = [{ run: loadRun('run-a'), set: loadSet() }];

function firstGame(): ReplayLog['games'][number] {
  const game = LOG.games[0];
  if (game === undefined) throw new Error('fixture has no games');
  return game;
}

/** The whole empty state as one string: `renderCopy` splits it into spans. */
function emptyBlock(title: unknown): string {
  const parent = (title as { parentElement: { textContent: string | null } | null }).parentElement;
  if (parent === null) throw new Error('the empty state drew no block');
  return parent.textContent ?? '';
}

function draw(
  params: Readonly<Record<string, string>> = {},
  games: AnalysisLogState = { status: 'ready', log: LOG },
): Record<string, string>[] {
  const recorded: Record<string, string>[] = [];
  const route: UiRoute = { mode: 'analysis', sub: 'explorer', params: { section: 'games', ...params } };
  render(
    h(AnalysisSurface, {
      runs: { status: 'ready', runs: VIEWS },
      games,
      route,
      onSetParams: (next) => {
        recorded.push({ ...next });
      },
    }),
  );
  return recorded;
}

describe('the Games section', () => {
  it('draws the run summary and the drill-down together', () => {
    draw();
    expect(screen.getByText('Matchups')).toBeTruthy();
    expect(screen.getByText('Turns')).toBeTruthy();
    expect(screen.getAllByLabelText(/^Turn \d+$/).length).toBe(firstGame().turns.length);
  });

  it('opens the game the address names', () => {
    const last = LOG.games[LOG.games.length - 1];
    if (last === undefined) throw new Error('fixture has no games');
    draw({ game: String(last.index) });
    expect(screen.getByText(last.extras.sim_game_seed)).toBeTruthy();
  });

  it('writes the clicked turn to the address', () => {
    const written = draw();
    fireEvent.click(screen.getByLabelText('Turn 3'));
    expect(written).toEqual([{ turn: '3' }]);
  });

  it('clears the turn when the game changes, so the new game opens at its end', () => {
    const written = draw();
    fireEvent.change(screen.getByLabelText('Game'), { target: { value: '1' } });
    expect(written).toEqual([{ game: '1', turn: '' }]);
  });

  it('opens the default turn rather than failing on a junk address', () => {
    draw({ turn: 'nonsense' });
    const last = firstGame().turns[firstGame().turns.length - 1];
    if (last === undefined) throw new Error('fixture game has no turns');
    expect(screen.getByText(`End of turn ${last.turn}`)).toBeTruthy();
  });

  it('says the log is absent once, and draws no drill-down over nothing', () => {
    draw({}, { status: 'absent' });
    expect(screen.getByText('Nothing measured yet')).toBeTruthy();
    expect(screen.queryByLabelText('Game')).toBeNull();
    expect(screen.queryAllByLabelText(/^Turn \d+$/)).toHaveLength(0);
  });

  it('names both sets when the staged log measured another one, and draws no drill-down', () => {
    // `mtg-ahr5`. Summarizing the staged log here would put another set's win
    // rates under this set's name, so it stays withheld — but "Nothing measured
    // yet" says a sweep was never run, which is the wrong thing to act on.
    draw({}, { status: 'elsewhere', belongsTo: 'the flagship set', showing: 'Magic 2011' });
    const said = emptyBlock(screen.getByText('The measured games are of another set'));
    expect(said).toContain('the flagship set');
    expect(said).toContain('Magic 2011');
    expect(said).toContain('set picker');
    expect(screen.queryByText('Nothing measured yet')).toBeNull();
    expect(screen.queryByLabelText('Game')).toBeNull();
  });

  it('carries the reader’s message when the log was refused, and still no drill-down', () => {
    draw({}, { status: 'failed', message: 'line 2 has no sim_run_seed' });
    expect(screen.getByText('line 2 has no sim_run_seed')).toBeTruthy();
    expect(screen.queryByLabelText('Game')).toBeNull();
  });

  it('does not call itself a replay, which is the other tab and the other log', () => {
    // Scoped to the section, not the page: the surface's own run-health copy
    // says "seeded games that replayed another game move for move", which is
    // about determinism and is the right word there.
    draw();
    // `textContent` through a cast, the way `./surface.test.ts` reads it: this
    // project's test lib does not carry `dom`.
    const section = screen.getByLabelText('Games played') as unknown as {
      readonly textContent?: string | null;
    };
    expect((section.textContent ?? '').toLowerCase()).not.toContain('replay');
  });
});
