// @vitest-environment jsdom
/**
 * The gesture the curation grid is: tap in order, tap again to unsay, one undo.
 *
 * Split the way the code is. `ranking.ts` is where the order lives and it is
 * tested as arithmetic, because the property that matters — a dropped pick
 * renumbers everything behind it — is invisible in markup unless you already
 * know what to look for. The grid is then tested for the two things a person on
 * a tablet actually depends on: that the number drawn on a picture is the number
 * the state holds, and that the same fact reaches somebody who is listening to
 * the page rather than looking at it.
 *
 * jsdom performs no layout, so nothing here says the thumbnails are legible at
 * arm's length; that is `styles.ts` and a real tablet.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CurateGrid } from '../src/curate/CurateGrid';
import type { CurationIndex } from '../src/lab/curation-index';
import { EMPTY_CURATION_STATE, rankOf, stateFromPreferences, tap, undo } from '../src/curate/ranking';
import type { CurationState } from '../src/curate/ranking';

afterEach(cleanup);

/**
 * What testing-library hands back, narrowed to the members used here and checked
 * at runtime. The workspace tsconfig has no `lib: dom`, so `HTMLElement` carries
 * none of them; `graveyard-browser.test.ts` declares its own shape for the same
 * reason.
 */
interface ElementLike {
  readonly textContent: string | null;
  readonly getAttribute: (name: string) => string | null;
  readonly querySelector: (selector: string) => ElementLike | null;
}

function asElement(value: unknown): ElementLike {
  const candidate = value as Partial<ElementLike> | null | undefined;
  if (
    candidate === null ||
    candidate === undefined ||
    typeof candidate.getAttribute !== 'function' ||
    typeof candidate.querySelector !== 'function'
  ) {
    throw new Error('expected a rendered element');
  }
  return candidate as ElementLike;
}

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

function candidate(digest: string, alt: string): CurationIndex['cards'][number]['candidates'][number] {
  return {
    digest,
    run: 'xmp-v3',
    alt,
    thumb: `curation/${digest}.png`,
    full: `/curation-api/full/${digest}`,
  };
}

const INDEX: CurationIndex = {
  formatVersion: 1,
  cards: [
    {
      id: 'xmp-elk',
      name: 'Hollow Elk',
      candidates: [candidate(A, 'in fog'), candidate(B, 'at dawn'), candidate(C, 'at dusk')],
    },
    { id: 'xmp-bog', name: 'Black Bog', candidates: [candidate(A, 'a bog')] },
  ],
};

function grid(
  state: CurationState,
  overrides: Partial<Parameters<typeof CurateGrid>[0]> = {},
): {
  readonly onTap: ReturnType<typeof vi.fn>;
  readonly onRegenerate: ReturnType<typeof vi.fn>;
} {
  const onTap = vi.fn();
  const onRegenerate = vi.fn();
  render(
    h(CurateGrid, {
      index: INDEX,
      state,
      requested: new Map(),
      onTap,
      onUndo: vi.fn(),
      onRegenerate,
      onCompare: vi.fn(),
      comparing: null,
      canUndo: false,
      problem: null,
      ...overrides,
    }),
  );
  return { onTap, onRegenerate };
}

describe('ranking by tapping', () => {
  it('numbers pictures in the order they were tapped', () => {
    const first = tap(EMPTY_CURATION_STATE, 'xmp-elk', B);
    const second = tap(first.state, 'xmp-elk', A);
    expect(rankOf(second.state, 'xmp-elk', B)).toBe(1);
    expect(rankOf(second.state, 'xmp-elk', A)).toBe(2);
    expect(second.hashes).toEqual([B, A]);
  });

  it('drops a numbered picture on a second tap and moves the rest up', () => {
    let state = EMPTY_CURATION_STATE;
    for (const digest of [A, B, C]) state = tap(state, 'xmp-elk', digest).state;
    const dropped = tap(state, 'xmp-elk', A);
    expect(dropped.hashes).toEqual([B, C]);
    expect(rankOf(dropped.state, 'xmp-elk', B)).toBe(1);
    expect(rankOf(dropped.state, 'xmp-elk', A)).toBeNull();
  });

  it('leaves a card with no preference at all when its last pick is taken back', () => {
    const one = tap(EMPTY_CURATION_STATE, 'xmp-elk', A);
    const none = tap(one.state, 'xmp-elk', A);
    expect(none.hashes).toEqual([]);
    expect(none.state.picks.has('xmp-elk')).toBe(false);
  });

  it('takes back the last tap and says which card to rewrite', () => {
    const first = tap(EMPTY_CURATION_STATE, 'xmp-elk', A);
    const second = tap(first.state, 'xmp-elk', B);
    const back = undo(second.state);
    expect(back?.cardId).toBe('xmp-elk');
    expect(back?.hashes).toEqual([A]);
    expect(rankOf(back?.state ?? EMPTY_CURATION_STATE, 'xmp-elk', B)).toBeNull();
  });

  it('takes back several taps in turn, and refuses when there is nothing left', () => {
    const first = tap(EMPTY_CURATION_STATE, 'xmp-elk', A);
    const second = tap(first.state, 'xmp-bog', B);
    const once = undo(second.state);
    const twice = undo(once?.state ?? EMPTY_CURATION_STATE);
    expect(twice?.cardId).toBe('xmp-elk');
    expect(twice?.hashes).toEqual([]);
    expect(undo(twice?.state ?? EMPTY_CURATION_STATE)).toBeNull();
  });

  it('starts from the picks already on disk, with nothing to undo', () => {
    const state = stateFromPreferences({ 'xmp-elk': [B, A], 'xmp-bog': [] });
    expect(rankOf(state, 'xmp-elk', A)).toBe(2);
    expect(state.picks.has('xmp-bog')).toBe(false);
    expect(undo(state)).toBeNull();
  });
});

describe('the grid a person taps at', () => {
  it('draws the rank the state holds, and says it in the accessible name', () => {
    grid(stateFromPreferences({ 'xmp-elk': [B] }));
    expect(
      asElement(screen.getByLabelText('Hollow Elk, at dawn (xmp-v3), preference 1')).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');
    expect(
      asElement(screen.getByLabelText('Hollow Elk, in fog (xmp-v3), unranked')).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(screen.getAllByText('1')).toHaveLength(1);
  });

  it('reports the card and the picture that was tapped, and ranks nothing itself', () => {
    const { onTap } = grid(EMPTY_CURATION_STATE);
    fireEvent.click(screen.getByLabelText('Hollow Elk, at dusk (xmp-v3), unranked'));
    expect(onTap).toHaveBeenCalledWith('xmp-elk', C);
    expect(screen.queryByText('1')).toBeNull();
  });

  it('offers the cause picker on every card, including a multi-candidate one', () => {
    grid(EMPTY_CURATION_STATE);
    const asks = screen.getAllByText('Ask for another');
    // One per card: Hollow Elk has three candidates, Black Bog has one, and
    // both get the control — the picker used to be withheld from a card with
    // more than one candidate, which is exactly the case the playtester hit first.
    expect(asks).toHaveLength(2);
  });

  it('opens the four causes and a note field on tap, and records a confirm with nothing toggled', () => {
    const { onRegenerate } = grid(EMPTY_CURATION_STATE);
    fireEvent.click(screen.getAllByText('Ask for another')[0] as HTMLElement);
    expect(screen.getByText('White border around the art')).toBeTruthy();
    expect(screen.getByText('Not the thing the card names')).toBeTruthy();
    fireEvent.click(screen.getByText('Save reasons'));
    expect(onRegenerate).toHaveBeenCalledWith({ cardId: 'xmp-elk', requested: true, causes: [] });
  });

  it('records the toggled causes and the trimmed note on confirm', () => {
    const { onRegenerate } = grid(EMPTY_CURATION_STATE);
    fireEvent.click(screen.getAllByText('Ask for another')[0] as HTMLElement);
    fireEvent.click(screen.getByText('Not the thing the card names'));
    fireEvent.click(screen.getByText('A seam drawn into the picture'));
    fireEvent.change(screen.getByLabelText('Note (optional)'), {
      target: { value: '  looks painted over  ' },
    });
    fireEvent.click(screen.getByText('Save reasons'));
    expect(onRegenerate).toHaveBeenCalledWith({
      cardId: 'xmp-elk',
      requested: true,
      causes: ['wrong-subject', 'seam-in-art'],
      note: 'looks painted over',
    });
  });

  it('shows a card whose regeneration was already asked for as asked, and re-opens with its causes', () => {
    grid(EMPTY_CURATION_STATE, {
      requested: new Map([
        ['xmp-bog', { cardId: 'xmp-bog', causes: ['outer-border' as const], note: 'edge' }],
      ]),
    });
    expect(screen.getByText('Flagged — edit')).toBeTruthy();
    fireEvent.click(screen.getByText('Flagged — edit'));
    expect(asElement(screen.getByText('White border around the art')).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByLabelText('Note (optional)')).toBeTruthy();
  });

  it('clears a flagged card entirely with "Not wrong after all"', () => {
    const { onRegenerate } = grid(EMPTY_CURATION_STATE, {
      requested: new Map([['xmp-bog', { cardId: 'xmp-bog', causes: ['outer-border' as const] }]]),
    });
    fireEvent.click(screen.getByText('Flagged — edit'));
    fireEvent.click(screen.getByText('Not wrong after all'));
    expect(onRegenerate).toHaveBeenCalledWith({ cardId: 'xmp-bog', requested: false });
  });

  it('opens the full raster only when a picture is being compared', () => {
    grid(EMPTY_CURATION_STATE);
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    grid(EMPTY_CURATION_STATE, { comparing: candidate(B, 'at dawn') });
    const dialog = asElement(screen.getByRole('dialog'));
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe(`/curation-api/full/${B}`);
  });

  it('keeps a refusal from the endpoint on the page as an alert', () => {
    grid(EMPTY_CURATION_STATE, { problem: 'that hash is not a candidate' });
    expect(asElement(screen.getByRole('alert')).textContent).toBe('that hash is not a candidate');
  });
});
