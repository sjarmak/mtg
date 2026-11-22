// @vitest-environment jsdom
/**
 * The third question, rendered.
 *
 * Every block here goes through `readAnalysisRun` before it reaches the panel,
 * so what is rendered is a document the real reader accepted rather than an
 * object shaped to suit the renderer. The numbers are `@mtg/cube`'s vocabulary
 * written out by hand, because that package reaches `better-sqlite3` and cannot
 * be imported from this one; `packages/cube/test/claims.test.ts` is where those
 * numbers are produced, and the reader is what holds the two ends together.
 *
 * The assertion that matters is the negative one: an unmeasured capability must
 * not render as a pass, must not render a number, and must not be counted into
 * a share of capabilities met.
 */
import { createElement as h } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaimsPanel, claimAmount, claimText, claimTone } from '../../src/routes/analysis/claims';
import { readAnalysisRun } from '../../src/routes/analysis/read';
import type { RunClaim, RunClaims } from '../../src/routes/analysis/model';
import { fixtureJson } from './support/fixtures';

afterEach(cleanup);

/**
 * DOM reads through a structural cast, the way `./surface.test.ts` does them:
 * the unit project compiles without the `dom` lib, so `textContent` and friends
 * are not on `HTMLElement` here even though jsdom supplies them at run time.
 */
function text(element: unknown): string {
  return (element as { readonly textContent?: string | null } | null)?.textContent ?? '';
}

function attr(element: unknown, name: string): string | null {
  return (element as { getAttribute: (name: string) => string | null }).getAttribute(name);
}

function row(element: HTMLElement): HTMLElement {
  const found = (element as unknown as { closest: (selector: string) => HTMLElement | null }).closest('li');
  if (found === null) throw new Error('the claim did not render inside a list row');
  return found;
}

const MET: RunClaim = {
  capability: 'size',
  subject: '',
  statement: 'the list holds 360 cards',
  status: 'met',
  measured: 360,
  required: 360,
  distance: 0,
  unit: 'cards',
  detail: 'the list holds 360 cards, and it does',
};

const MISSED: RunClaim = {
  capability: 'archetype-availability',
  subject: 'mono-green stompy',
  statement: 'mono-green stompy is assemblable by 50% of drafting seats',
  status: 'missed',
  measured: 0.25,
  required: 0.5,
  distance: -0.25,
  unit: 'share',
  detail: 'mono-green stompy was assembled by 2 of 8 seat-drafts (25.0%)',
};

const UNMEASURED: RunClaim = {
  capability: 'archetype-support',
  subject: 'boros aggro',
  statement: 'boros aggro has 24 playable cards in WR',
  status: 'unmeasured',
  measured: null,
  required: 24,
  distance: null,
  unit: 'cards',
  detail:
    'nothing tagged which cards serve which archetype: that judgment is a model call and no model was run',
};

function block(overrides: Partial<RunClaims> = {}): RunClaims {
  const draft = JSON.parse(JSON.stringify(fixtureJson('run-a'))) as Record<string, unknown>;
  draft['claims'] = {
    claims: [MET, MISSED, UNMEASURED],
    unclaimed: [],
    reported: [],
    limitsKind: 'shares-measured',
    limits: [{ id: 'independent-packs', what: 'each pack is drawn independently from the sheet' }],
    draftProvenance: { seed: 'cube/availability/v0', drafts: 25, seatDrafts: 200 },
    ok: false,
    ...overrides,
  };
  const claims = readAnalysisRun(draft).claims;
  if (claims === null) throw new Error('the reader dropped the block this test is about');
  return claims;
}

describe('the claims panel', () => {
  it('counts the three answers apart instead of summing them into a pass rate', () => {
    render(h(ClaimsPanel, { claims: block() }));

    const verdict = screen.getByLabelText('Verdict');
    expect(text(within(verdict).getByText(/3 stated capabilities/u))).toBe(
      '3 stated capabilities: 1 met, 1 missed, 1 not measured.',
    );
    expect(attr(verdict, 'data-tone')).toBe('negative');
  });

  it('renders an unmeasured capability with its reason and no number', () => {
    render(h(ClaimsPanel, { claims: block() }));

    const found = row(screen.getByText(UNMEASURED.statement));
    expect(attr(found, 'data-tone'), 'not measured was painted as a pass').toBe('pending');
    expect(within(found).getByText('not measured')).toBeTruthy();
    expect(text(found)).toContain('Nothing measured it.');
    expect(text(found)).toContain('no model was run');
    expect(text(found), 'an unmeasured claim rendered a comparison').not.toContain('Measured ');
  });

  it('states a miss in the unit the capability was stated in', () => {
    render(h(ClaimsPanel, { claims: block() }));

    const found = row(screen.getByText(MISSED.statement));
    expect(text(found)).toContain('Measured 25.0% against 50.0%, short by 25.0%');
    expect(attr(found, 'data-tone')).toBe('negative');
  });

  it('prints the seed and the sample every share is out of', () => {
    render(h(ClaimsPanel, { claims: block() }));

    const verdict = screen.getByLabelText('Verdict');
    expect(text(within(verdict).getByText(/seat-drafts/u))).toBe(
      'Shares are out of 200 seat-drafts over 25 drafts, seeded cube/availability/v0.',
    );
  });

  it('shows what the drafted half cannot say, rather than only the shares', () => {
    render(h(ClaimsPanel, { claims: block() }));

    const limits = screen.getByLabelText('What this cannot say');
    expect(text(limits)).toContain('Every share above was drafted');
    expect(text(limits)).toContain('drawn independently from the sheet');
  });

  it('says nothing was drafted rather than showing deal limits that did not apply', () => {
    render(
      h(ClaimsPanel, {
        claims: block({ limitsKind: 'not-attempted', limits: [], draftProvenance: null }),
      }),
    );

    const limits = screen.getByLabelText('What this cannot say');
    expect(text(limits)).toContain('without drafting it, so no share was produced');
    expect(
      within(screen.getByLabelText('Verdict')).queryByText(/seat-drafts/u),
      'a provenance line was printed for a draft that never happened',
    ).toBeNull();
  });

  it('separates a construction fault from a dial nobody chose', () => {
    render(
      h(ClaimsPanel, {
        claims: block({
          unclaimed: [
            {
              code: 'archetype-color',
              subject: 'Dawn Warden',
              measured: 1,
              required: 0,
              detail: 'Dawn Warden is tagged for mono-green stompy and cannot be cast in G',
            },
          ],
          reported: [
            {
              code: 'color-balance',
              subject: 'G',
              measured: 8,
              required: 22,
              detail: 'green holds 8 of 76 slots, outside 33.3% ± 5.0%',
            },
          ],
        }),
      }),
    );

    const faults = screen.getByLabelText('Faults no stated capability covers');
    expect(text(faults)).toContain('These fail the format');
    expect(text(faults)).toContain('cannot be cast in G');

    const unchosen = screen.getByLabelText('Measured against numbers nobody chose');
    expect(text(unchosen)).toContain('reported and never failed on');
    expect(text(unchosen)).toContain('green holds 8 of 76 slots');
  });

  it('says a format that claimed nothing claimed nothing', () => {
    render(h(ClaimsPanel, { claims: block({ claims: [], ok: true }) }));

    expect(attr(screen.getByLabelText('Verdict'), 'data-tone')).toBe('positive');
    expect(text(screen.getByLabelText('Stated capabilities'))).toContain('stated no capabilities');
  });
});

describe('the sentences the panel is assembled from', () => {
  it('reads a share as a percentage and a count as a count', () => {
    expect(claimAmount(0.255, 'share')).toBe('25.5%');
    expect(claimAmount(360, 'cards')).toBe('360');
    expect(claimAmount(4, 'copies')).toBe('4');
  });

  it('never paints an unanswered question as a pass', () => {
    expect(claimTone('met')).toBe('positive');
    expect(claimTone('missed')).toBe('negative');
    expect(claimTone('abstained')).toBe('pending');
    expect(claimTone('unmeasured')).toBe('pending');
  });

  it('says over by rather than short by when the list overshot', () => {
    expect(claimText({ ...MISSED, measured: 0.75, distance: 0.25 })).toContain('over by 25.0%');
  });
});
