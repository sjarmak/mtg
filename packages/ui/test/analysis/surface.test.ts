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
import type { UiRoute } from '../../src/app/router';
import { loadRun, loadSet } from './support/fixtures';

afterEach(cleanup);

const SET = loadSet();
const VIEWS: readonly AnalysisRunView[] = [
  { run: loadRun('run-a'), set: SET },
  { run: loadRun('run-b'), set: SET },
];

function route(params: Readonly<Record<string, string>> = {}): UiRoute {
  return { mode: 'analysis', params };
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
    // either. The tile says so rather than folding them into the passes. The
    // clause is plural because there are now three ways to decline and the
    // note names each one it actually has.
    expect(screen.getByText(/none of which is a pass/)).toBeTruthy();
    expect(screen.getByText(/2 with nothing to measure/)).toBeTruthy();
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
      draft: () => h('p', null, 'draft'),
      deck: () => h('p', null, 'deck'),
      analysis: analysisView({ status: 'ready', runs: VIEWS }, { status: 'absent' }),
      replay: () => h('p', null, 'replay'),
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
