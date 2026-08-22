// @vitest-environment jsdom
/**
 * What the run summary says it is about.
 *
 * `mtg-ihtz` from the reading end. The launcher now refuses to stage a
 * statistics log that is not the played set's, which fixes the lab; it does not
 * fix this panel, because the panel is also what a person sees when a log was
 * put in `public/` by hand, and it named no set at all. It printed "3 games
 * read" and "135 games declared in header" as two rows of a definition list and
 * left the reader to notice.
 *
 * Two facts, then: the set the rows are about, and the fact that this file is a
 * slice of its run rather than the run.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AnalysisRoute } from '../../src/routes/AnalysisRoute';
import { readReplayLog } from '../../src/replay/timeline';
import type { ReplayLog } from '../../src/replay/types';
import { fixtureText } from '../support/replay-fixture';

afterEach(cleanup);

/** The committed slice: three games of TGR under a header claiming 135. */
const SLICE: ReplayLog = readReplayLog(fixtureText());

describe('the run summary names its subject', () => {
  it('names the set the games were played in', () => {
    render(h(AnalysisRoute, { state: { status: 'ready', log: SLICE } }));
    expect(screen.getByText('set')).toBeTruthy();
    expect(screen.getByText('TGR')).toBeTruthy();
  });

  it('says the file is a slice rather than printing two counts and leaving it', () => {
    render(h(AnalysisRoute, { state: { status: 'ready', log: SLICE } }));
    expect(screen.getByText(`3 of ${String(SLICE.declaredGames)} games in the run`)).toBeTruthy();
  });

  it('says only the count when the file holds the whole run', () => {
    const whole: ReplayLog = { ...SLICE, declaredGames: SLICE.games.length };
    render(h(AnalysisRoute, { state: { status: 'ready', log: whole } }));
    expect(screen.getAllByText('3 games').length).toBeGreaterThan(0);
    expect(screen.queryByText(/games in the run/)).toBeNull();
  });
});
