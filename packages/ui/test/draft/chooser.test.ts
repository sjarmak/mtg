// @vitest-environment jsdom
/**
 * What the Draft tab is before a draft.
 *
 * `mtg-tewc.7`. Opening the tab used to deal pack 1 pick 1 from a seed invented
 * on mount, so there was no state in which a person chose to draft and no way
 * back to the draft they left. These tests hold the three states apart: no
 * draft, a draft this set can reopen, and a stored draft it cannot.
 */
import { createElement as h, useState } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { runHumanDraft } from '@mtg/draft-export';
import { DraftRoute } from '../../src/routes/DraftRoute';
import type { DraftRouteParams, DraftSetState } from '../../src/routes/DraftRoute';
import {
  DRAFT_NEW_LABEL,
  DRAFT_RESUME_LABEL,
  DRAFT_RESUME_STALE,
  draftResumeNote,
} from '../../src/routes/draft/DraftChooser';
import { clearDraftSession, readDraftSession, writeDraftSession } from '../../src/routes/draft/draft-session';

afterEach(() => {
  cleanup();
  clearDraftSession();
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
const SEED = 'draft-chooser-test';

/** No `lib: dom` in this workspace, so the one shape this file reaches for is spelled out. */
interface ElementLike {
  readonly querySelector: (selector: string) => ElementLike | null;
}

function packIds(seed: string): readonly string[] {
  return runHumanDraft(SET, { seed }).nextPick?.cards.map((card) => card.id) ?? [];
}

/** The tab as the lab drives it: params live in state and the route writes them. */
function Tab(props: { readonly setName?: string }): ReturnType<typeof h> {
  const [params, setParams] = useState<DraftRouteParams>({});
  return h(DraftRoute, {
    set: READY,
    params,
    onSetParams: (next: Readonly<Record<string, string>>): void => {
      setParams(next as DraftRouteParams);
    },
    ...(props.setName === undefined ? {} : { setName: props.setName }),
  });
}

describe('the Draft tab before a draft', () => {
  it('offers a new draft rather than dealing one, and names the set it would deal', () => {
    render(h(Tab, { setName: 'Tideglass Reach' }));
    expect(screen.getByRole('button', { name: DRAFT_NEW_LABEL })).toBeTruthy();
    expect(screen.getByText('Tideglass Reach')).toBeTruthy();
    expect(screen.queryByRole('button', { name: DRAFT_RESUME_LABEL })).toBeNull();
  });

  it('deals pack 1 pick 1 when the new draft is asked for', () => {
    render(h(Tab, {}));
    fireEvent.click(screen.getByRole('button', { name: DRAFT_NEW_LABEL }));
    expect(screen.getByRole('group', { name: /Draft pack 1, pick 1/ })).toBeTruthy();
  });

  it('offers the draft the browser is holding, and says where it stopped', () => {
    const opened = packIds(SEED);
    const first = opened[0];
    if (first === undefined) throw new Error('the fixture set cannot fill a pack');
    writeDraftSession(SEED, [first], opened);
    render(h(Tab, {}));
    expect(screen.getByRole('button', { name: DRAFT_RESUME_LABEL })).toBeTruthy();
    expect(
      screen.getByText(draftResumeNote(1, opened.length * runHumanDraft(SET, { seed: SEED }).rounds)),
    ).toBeTruthy();
  });

  it('puts the stored draft back on the page, one pick in', () => {
    const opened = packIds(SEED);
    const first = opened[0];
    if (first === undefined) throw new Error('the fixture set cannot fill a pack');
    writeDraftSession(SEED, [first], opened);
    render(h(Tab, {}));
    fireEvent.click(screen.getByRole('button', { name: DRAFT_RESUME_LABEL }));
    expect(screen.queryByRole('button', { name: DRAFT_RESUME_LABEL })).toBeNull();
    expect(screen.getByRole('group', { name: /Draft pack 1, pick 2/ })).toBeTruthy();
  });

  /** A stale session is a status line, not a button that fails after it is pressed. */
  it('says a draft from another set cannot be continued here, and offers no control for it', () => {
    writeDraftSession(SEED, [], ['a card this set does not hold']);
    render(h(Tab, {}));
    expect(screen.getByText(DRAFT_RESUME_STALE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: DRAFT_RESUME_LABEL })).toBeNull();
    expect(screen.getByRole('button', { name: DRAFT_NEW_LABEL })).toBeTruthy();
  });

  it('forgets the stored draft when a new one is started over it', () => {
    writeDraftSession(SEED, [], packIds(SEED));
    render(h(Tab, {}));
    fireEvent.click(screen.getByRole('button', { name: DRAFT_NEW_LABEL }));
    expect(readDraftSession()).toBeNull();
  });

  it('keeps the draft as it is picked, so a reload has something to continue', () => {
    render(h(Tab, {}));
    fireEvent.click(screen.getByRole('button', { name: DRAFT_NEW_LABEL }));
    expect(readDraftSession()).toBeNull();
    const pack = screen.getByRole('group', { name: /Draft pack 1, pick 1/ });
    const first = (pack as unknown as ElementLike).querySelector('button, [role="button"]');
    if (first === null) throw new Error('the pack drew no pickable card');
    fireEvent.click(first as unknown as Element);
    fireEvent.click(screen.getByRole('button', { name: /^Pick / }));
    const stored = readDraftSession();
    if (stored === null) throw new Error('the pick was not kept');
    expect(stored.picks).toHaveLength(1);
    expect(stored.packIds.length).toBeGreaterThan(0);
  });
});
