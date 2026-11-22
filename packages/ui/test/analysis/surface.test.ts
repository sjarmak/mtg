// @vitest-environment jsdom
/**
 * The surface itself: sections, run selection, and the empty states.
 *
 * All four pieces of view state live in the route, so every assertion here is
 * really the same assertion — a red gate can be sent to somebody as a link and
 * they land on the same screen.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/app/App';
import type { UiViews } from '../../src/app/App';
import {
  ANALYSIS_SECTIONS,
  AnalysisSurface,
  DEFAULT_SECTION,
  SECTION_LABELS,
  analysisView,
  sectionFromRoute,
} from '../../src/routes/analysis/AnalysisView';
import type { AnalysisRunView } from '../../src/routes/analysis/AnalysisView';
import { NOT_ENOUGH_EVIDENCE } from '../../src/routes/analysis/evidence';
import { hashSource } from '../../src/app/router';
import type { UiRoute, UiRouter } from '../../src/app/router';
import { evidenceSnapshot } from './support/evidence-fixtures';
import { loadRun, loadSet } from './support/fixtures';

afterEach(cleanup);

const SET = loadSet();
const VIEWS: readonly AnalysisRunView[] = [
  { run: loadRun('run-a'), set: SET },
  { run: loadRun('run-b'), set: SET },
];

function route(params: Readonly<Record<string, string>> = {}): UiRoute {
  return { mode: 'analysis', sub: 'explorer', params };
}

interface Recorded {
  readonly params: Record<string, string>[];
}

function renderSurface(
  params: Readonly<Record<string, string>> = {},
  runs: readonly AnalysisRunView[] = VIEWS,
): Recorded {
  const recorded: Record<string, string>[] = [];
  render(
    h(AnalysisSurface, {
      runs: { status: 'ready', runs },
      games: { status: 'absent' },
      route: route(params),
      onSetParams: (next) => {
        recorded.push({ ...next });
      },
    }),
  );
  return { params: recorded };
}

describe('sectionFromRoute', () => {
  it('defaults rather than throwing on an unknown section', () => {
    expect(sectionFromRoute(route())).toBe(DEFAULT_SECTION);
    expect(sectionFromRoute(route({ section: 'nonsense' }))).toBe(DEFAULT_SECTION);
    for (const section of ANALYSIS_SECTIONS) {
      expect(sectionFromRoute(route({ section }))).toBe(section);
    }
  });
});

describe('AnalysisSurface', () => {
  it('leads with the gate counts, keeping under-sampled separate from pass', () => {
    renderSurface();
    expect(screen.getByText('Gates')).toBeTruthy();
    // The frozen set carries no activated or triggered ability, so both usage
    // gates come back `notApplicable` — the fourth status, and not a pass
    // either. The tile says so rather than folding them into the passes. One
    // clause, because the note names the abstentions this run has and this run
    // has one kind: `mtg-dcxg.8`, where "0 under-sampled, which is not a pass"
    // sat under "25 pass · 0 fail" and read as a qualification of a number it
    // did not qualify.
    expect(screen.getByText(/2 with nothing to measure, which is not a pass/)).toBeTruthy();
    expect(screen.queryByText(/0 under-sampled/)).toBeNull();
  });

  it('says every gate was judged rather than counting abstentions it does not have', () => {
    const run = loadRun('run-a');
    const judged = {
      ...run,
      health: {
        ...run.health,
        gates: run.health.gates.filter((gate) => gate.status === 'pass'),
      },
    };
    renderSurface({}, [{ run: judged, set: SET }]);
    expect(screen.getByText(/every one of the 22 gates was judged/)).toBeTruthy();
  });

  /**
   * The producing tool's own sentence about its machinery used to read in the
   * page head: `npm run analyze` wrote "greedy v0 bots on the flagship set,
   * decks built by @mtg/deckbuild" and the staged run still carries it, so this
   * asks the rendered surface rather than the current writer. A player surface
   * names no package, no internal tool and no version marker.
   */
  it("keeps the producing tool's own vocabulary off the page", () => {
    const run = loadRun('run-a');
    const labeled = {
      ...run,
      health: {
        ...run.health,
        label: '10 color pairs, 45 matchups x 60 games, greedy v0 bots on TGR, decks built by @mtg/deckbuild',
      },
    };
    const { container } = render(
      h(AnalysisSurface, {
        runs: { status: 'ready', runs: [{ run: labeled, set: SET }] },
        games: { status: 'absent' },
        route: route(),
        onSetParams: () => undefined,
      }),
    );
    // `textContent` through a cast for the reason `../board-marks.test.ts`
    // casts for it: this suite typechecks under the workspace's single Node
    // tsconfig, which carries no `dom` lib.
    const text = (container as unknown as { readonly textContent?: string | null }).textContent ?? '';
    for (const developerWord of ['@mtg/', 'v0', 'greedy']) {
      expect(text.includes(developerWord), `the surface prints ${developerWord}`).toBe(false);
    }
  });

  it('reports repeated trajectories on the run header', () => {
    renderSurface();
    expect(screen.getByText('Repeated trajectories')).toBeTruthy();
    expect(screen.getByText(/replayed another game move for move/)).toBeTruthy();
  });

  it('writes the section to the route rather than holding state', () => {
    const recorded = renderSurface();
    fireEvent.click(screen.getByRole('button', { name: SECTION_LABELS.archetypes }));
    expect(recorded.params).toEqual([{ section: 'archetypes' }]);
  });

  it('renders each section from the route', () => {
    for (const section of ANALYSIS_SECTIONS) {
      cleanup();
      renderSurface({ section });
      expect(screen.getByLabelText(SECTION_LABELS[section])).toBeTruthy();
    }
  });

  it('selects the run named in the route, and falls back to the first', () => {
    renderSurface({ run: 'tgr-r2' });
    expect(screen.getByDisplayValue('TGR rev 2')).toBeTruthy();
    cleanup();
    renderSurface({ run: 'no-such-run' });
    expect(screen.getByDisplayValue('TGR rev 1')).toBeTruthy();
  });

  it('writes the rarity filter to the route, and clears it with an empty value', () => {
    const recorded = renderSurface({ section: 'cards' });
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'uncommon' } });
    expect(recorded.params).toEqual([{ rarity: 'uncommon' }]);
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'all' } });
    expect(recorded.params[1]).toEqual({ rarity: '' });
  });

  it('says what is missing instead of charting nothing', () => {
    renderSurface({ section: 'diff' }, VIEWS.slice(0, 1));
    expect(screen.getByText('Nothing to compare against')).toBeTruthy();
    cleanup();
    renderSurface({ section: 'composition' }, [{ run: loadRun('run-a'), set: null }]);
    expect(screen.getByText('No set file loaded')).toBeTruthy();
    cleanup();
    renderSurface({}, []);
    expect(screen.getByText('Nothing measured yet')).toBeTruthy();
  });

  it('shows the withheld statistics of a thin run rather than hiding the run', () => {
    renderSurface({ section: 'archetypes', run: 'tgr-probe' }, [{ run: loadRun('run-sparse'), set: SET }]);
    expect(screen.getAllByText(new RegExp(NOT_ENOUGH_EVIDENCE)).length).toBeGreaterThan(0);
  });
});

describe('analysisView', () => {
  it('plugs into the shell and reads its section back out of the hash', async () => {
    const source = hashSource();
    if (source === null) throw new Error('this test needs a browser location');
    source.location.hash = '#/analysis';
    const views: UiViews = {
      play: () => h('p', null, 'play'),
      customize: () => h('p', null, 'customize'),
      analysis: analysisView({ status: 'ready', runs: VIEWS }, { status: 'absent' }),
      cards: () => h('p', null, 'cards'),
    };
    render(h(App, { views, withStyles: false }));
    expect(screen.getByText('Set analysis')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: SECTION_LABELS.shape }));
    await waitFor(() => {
      expect(source.location.hash).toContain('section=shape');
    });
    expect(screen.getByLabelText(SECTION_LABELS.shape)).toBeTruthy();
  });
});

describe('failing gates', () => {
  it('names them rather than only counting them', () => {
    renderSurface({ run: 'tgr-r1-strict' }, [{ run: loadRun('run-strict'), set: SET }]);
    expect(screen.getByLabelText('Failing gates')).toBeTruthy();
    expect(screen.getAllByText(/win-rate spread across pairs/).length).toBeGreaterThan(0);
  });

  it('says nothing at all when nothing fails', () => {
    renderSurface({ run: 'tgr-r2' }, [{ run: loadRun('run-b'), set: SET }]);
    expect(screen.queryByLabelText('Failing gates')).toBeNull();
  });
});

describe('the evidence section', () => {
  it('renders before any run is staged, saying nothing is staged', () => {
    render(
      h(AnalysisSurface, {
        runs: { status: 'absent' },
        games: { status: 'absent' },
        route: route({ section: 'evidence' }),
        onSetParams: () => undefined,
      }),
    );
    expect(screen.getByLabelText(SECTION_LABELS.evidence)).toBeTruthy();
    expect(screen.getByText('Nothing staged')).toBeTruthy();
    expect(screen.queryByText('Nothing measured yet')).toBeNull();
  });

  it('scopes the staged records to the selected subject', () => {
    render(
      h(AnalysisSurface, {
        runs: { status: 'absent' },
        games: { status: 'absent' },
        evidence: { status: 'ready', snapshot: evidenceSnapshot() },
        subjectKey: 'XMP',
        route: route({ section: 'evidence' }),
        onSetParams: () => undefined,
      }),
    );
    expect(screen.getByText(/1 of 4 staged records are about XMP\./)).toBeTruthy();
    expect(screen.getByText('Gloom (kernel-bot) vs The Sky Islands (human)')).toBeTruthy();
    expect(screen.queryByText('learned/v3 vs greedy/v0')).toBeNull();
  });

  it('reaches the surface through analysisView with the snapshot and the key', () => {
    const view = analysisView(
      { status: 'absent' },
      { status: 'absent' },
      { status: 'absent' },
      { status: 'absent' },
      { status: 'ready', snapshot: evidenceSnapshot() },
      'isd',
    );
    const router: UiRouter = {
      route: route({ section: 'evidence' }),
      navigate: () => undefined,
      goTo: () => undefined,
      goToSub: () => undefined,
      setParams: () => undefined,
      landing: 0,
    };
    render(h('div', null, view(router)));
    expect(screen.getByText(/1 of 4 staged records are about isd\./)).toBeTruthy();
  });
});
