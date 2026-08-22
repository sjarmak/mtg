// @vitest-environment jsdom
/**
 * The native draft's high-risk journey: a URL-backed pick transcript becomes
 * a 40-card deck and then a kernel game. The harmful branch is a transcript
 * that names a card outside its pack; it must stop with evidence rather than
 * quietly re-deal or substitute a bot choice.
 */
import { createElement as h, useState } from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { hashSource } from '../../src/app/router';
import { LabApp } from '../../src/dev/LabApp';
import { DraftRoute, encodePickLog } from '../../src/routes/DraftRoute';
import type { DraftRouteParams, DraftSetState } from '../../src/routes/DraftRoute';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

function loadSet(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.map((card) => parseCard(card));
}

const SET = loadSet();
const READY: DraftSetState = { status: 'ready', cards: SET };

interface ElementLike {
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly querySelectorAll: (selector: string) => {
    readonly length: number;
    readonly [index: number]: ElementLike;
  };
  readonly getAttribute: (name: string) => string | null;
  readonly closest: (selector: string) => ElementLike | null;
}

interface ActiveDocument {
  readonly activeElement: { readonly getAttribute: (name: string) => string | null } | null;
}

function Journey(props: { readonly initial?: DraftRouteParams }): ReturnType<typeof DraftRoute> {
  const [params, setParams] = useState<DraftRouteParams>(props.initial ?? { seed: 'journey/one' });
  return h(DraftRoute, {
    set: READY,
    params,
    onSetParams: (next) => setParams((current) => ({ ...current, ...next })),
  });
}

describe('one human drafts with seven bots', () => {
  it('shows pack and passing context, then records a keyboard-operable choice in the route', () => {
    render(h(Journey));

    expect(screen.getByRole('heading', { name: 'Draft' })).toBeTruthy();
    expect(screen.getByText(/Pack 1 · pick 1/i)).toBeTruthy();
    const pack = screen.getByRole('group', { name: /draft pack/i }) as unknown as ElementLike;
    const choices = pack.querySelectorAll('button');
    expect(choices.length).toBeGreaterThan(1);
    expect(choices[0]?.getAttribute('tabindex')).not.toBe('-1');
    expect(choices[0]?.getAttribute('data-size')).toBe('full');

    fireEvent.click(choices[0] as never);

    expect(screen.getByText(/Pack 1 · pick 2/i)).toBeTruthy();
    expect(screen.getByText(/1 pick recorded/i)).toBeTruthy();
    const document = (globalThis as { readonly document?: ActiveDocument }).document;
    expect(document?.activeElement?.getAttribute('aria-label')).toBeTruthy();
  });

  it('completes the critical journey, builds 40 cards, and starts the kernel game', () => {
    render(h(Journey, { initial: { seed: 'journey/complete' } }));

    for (let guard = 0; guard < 60; guard += 1) {
      const pack = screen.queryByRole('group', { name: /draft pack/i }) as unknown as ElementLike | null;
      if (pack === null) break;
      const choice = pack.querySelector('button');
      if (choice === null) throw new Error(`draft pack ${String(guard + 1)} has no choice`);
      fireEvent.click(choice);
    }

    expect(screen.getByText(/Draft finished/i)).toBeTruthy();
    let play = screen.getByRole('button', { name: 'Play drafted deck' });
    for (
      let guard = 0;
      guard < 36 && (play as unknown as ElementLike).getAttribute('disabled') !== null;
      guard += 1
    ) {
      const sideboard = screen.getByRole('group', { name: 'Drafted pool' }) as unknown as ElementLike;
      const choice = sideboard.querySelector('button');
      if (choice === null) throw new Error('the drafted pool ran out before the deck became legal');
      fireEvent.click(choice as never);
      play = screen.getByRole('button', { name: 'Play drafted deck' });
    }
    expect((play as unknown as ElementLike).getAttribute('disabled')).toBeNull();
    fireEvent.click(play);

    const table = screen.getByRole('button', { name: 'Side panel' }) as unknown as ElementLike;
    expect(table).toBeTruthy();
    expect(table.closest('.mtg-play-route')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Back to draft deckbuilding' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Draft' })).toBeNull();
    expect(screen.getAllByText('Bot').length).toBeGreaterThan(0);
  });
});

describe('the first-class lab tab', () => {
  it('loads the staged set through LabApp and opens its first pack', async () => {
    const source = hashSource();
    if (source === null) throw new Error('this test needs a browser location');
    source.location.hash = '#/draft?seed=lab%2Ftab';
    vi.stubGlobal('fetch', (url: string) =>
      url === 'set.json'
        ? Promise.resolve({ ok: true, json: () => Promise.resolve({ cards: SET }) })
        : Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') }),
    );

    render(h(LabApp, { setUrl: 'set.json', cards: [] }));

    await waitFor(() => {
      expect(screen.getByRole('link', { current: 'page', name: 'Draft' })).toBeTruthy();
      expect(screen.getByRole('group', { name: /draft pack 1, pick 1/i })).toBeTruthy();
    });
  });
});

describe('draft document states', () => {
  it.each([
    [{ status: 'loading' } as const, /Reading set.json/i],
    [{ status: 'absent' } as const, /No set staged/i],
    [{ status: 'failed', message: 'cards[7] is not executable' } as const, /cards\[7\]/i],
  ])('draws %s explicitly', (set, expected) => {
    render(h(DraftRoute, { set, params: {}, onSetParams: () => undefined }));
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it('reports an incompatible set separately from a broken staged document', () => {
    const thin = {
      status: 'ready' as const,
      cards: SET.filter((card) => card.rarity === 'common').slice(0, 4),
    };
    const { rerender } = render(
      h(DraftRoute, {
        set: thin,
        params: { seed: 'thin' },
        onSetParams: () => undefined,
      }),
    );
    expect(screen.getByText(/This set cannot fill draft packs/i)).toBeTruthy();
    expect(screen.getByText(/Common needs 9 cards per pack but its sheet holds 4/i)).toBeTruthy();

    rerender(
      h(DraftRoute, {
        set: thin,
        params: { seed: 'thin', picks: encodePickLog(['stale']) },
        onSetParams: () => undefined,
      }),
    );
    expect(screen.getByText(/This set cannot fill draft packs/i)).toBeTruthy();
  });

  it('rejects malformed and impossible pick logs with actionable evidence', () => {
    const { rerender } = render(
      h(DraftRoute, {
        set: READY,
        params: { seed: 'bad/log', picks: '{not json' },
        onSetParams: () => undefined,
      }),
    );
    expect(screen.getByText(/The draft link is invalid/i)).toBeTruthy();
    expect(screen.getByText(/pick log is not valid JSON/i)).toBeTruthy();

    rerender(
      h(DraftRoute, {
        set: READY,
        params: { seed: 'bad/choice', picks: encodePickLog(['outside-the-pack']) },
        onSetParams: () => undefined,
      }),
    );
    expect(screen.getByText(/The draft transcript does not match its seed/i)).toBeTruthy();
    expect(screen.getByText(/human pick 1/i)).toBeTruthy();
  });
});
