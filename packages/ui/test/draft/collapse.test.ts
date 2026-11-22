// @vitest-environment jsdom
/**
 * The drafted pool and the card viewer each fold to their head and open again.
 *
 * The playtester: "when drafting the pool of drafted cards should be collapsible and
 * expandable, and same with the righthand card viewer". Both disclosures live in
 * `DraftPackSurface`, so the generated-set draft and the printed draft get them
 * from one place, and both are exercised here.
 *
 * The one thing a shut rail may not take with it is the commit button: the
 * rail's foot held the only irreversible action on the surface, which is why
 * the surface refused a disclosure for as long as it did. So the shut state is
 * asserted against the button as well as against the rail.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { HumanDraftChoice, HumanDraftProgress } from '@mtg/draft-export';
import { preparePrintedLimitedFormat } from '@mtg/draft-export';
import type { PreparedPrintedLimitedFormat } from '@mtg/draft-export';
import { DraftPack, PICKS_COLLAPSE_KEY, VIEWER_COLLAPSE_KEY } from '../../src/routes/draft/DraftPack';
import { PrintedDraftRoute } from '../../src/routes/printed/PrintedDraftRoute';
import { readStored } from '../../src/routes/deck/local-store';
import { clearPreferences } from '../support/preferences';

afterEach(() => {
  cleanup();
  clearPreferences();
});

/** No `lib: dom` in this workspace, so the shapes this file reaches for are spelled out. */
interface ElementLike {
  readonly getAttribute: (name: string) => string | null;
  readonly querySelector: (selector: string) => ElementLike | null;
}

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
const PACK: readonly Card[] = SET.slice(0, 6);
const POOL: readonly Card[] = SET.slice(6, 9);

const NEXT: HumanDraftChoice = {
  round: 1,
  pickNumber: POOL.length + 1,
  packSize: PACK.length,
  openedBy: 0,
  cards: PACK,
};

const DRAFT: HumanDraftProgress = {
  seed: 'draft-collapse',
  humanSeat: 0,
  picks: POOL.map((card) => card.id),
  seats: [],
  rounds: 3,
  directions: [],
  ratings: [],
  botPolicy: 'native-deck-conditioned/v1',
  nextPick: NEXT,
  result: null,
};

function mount(onPick: (card: Card) => void = (): void => undefined): ElementLike {
  const { container } = render(
    h(DraftPack, { draft: DRAFT, next: NEXT, pool: POOL, onPick, onNewDraft: (): void => undefined }),
  );
  const root = (container as unknown as ElementLike).querySelector('.mtg-draft');
  if (root === null) throw new Error('the draft screen did not render');
  return root;
}

/** An attribute off whatever `screen` handed back; the workspace has no `HTMLElement` lib. */
function attr(element: unknown, name: string): string | null {
  return (element as ElementLike).getAttribute(name);
}

function poolBox(root: ElementLike): ElementLike | null {
  return root.querySelector('.mtg-draft__poolbox');
}

function viewerBody(root: ElementLike): ElementLike | null {
  return root.querySelector('.mtg-rail__body');
}

describe('the drafted pool', () => {
  it('folds to its head and opens again', () => {
    const root = mount();
    expect(poolBox(root)).not.toBeNull();

    const shut = screen.getByRole('button', { name: 'Collapse picks' });
    expect(attr(shut, 'aria-expanded')).toBe('true');
    fireEvent.click(shut);

    expect(poolBox(root)).toBeNull();
    // The head stays: the heading, the count, and the way back.
    expect(screen.getByRole('heading', { name: 'Pool' })).toBeTruthy();
    expect(root.querySelector('.mtg-draft__pool')?.getAttribute('data-collapsed')).toBe('true');
    // And the pack is told it has the column.
    expect(root.querySelector('.mtg-work__main')?.getAttribute('data-pool')).toBe('shut');
    expect(screen.queryByRole('button', { name: 'Collapse picks' })).toBeNull();

    const open = screen.getByRole('button', { name: 'Expand picks' });
    expect(attr(open, 'aria-expanded')).toBe('false');
    fireEvent.click(open);

    expect(poolBox(root)).not.toBeNull();
    expect(root.querySelector('.mtg-work__main')?.getAttribute('data-pool')).toBeNull();
    expect(screen.getByRole('button', { name: 'Collapse picks' })).toBeTruthy();
  });

  it('remembers the answer across a remount', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse picks' }));
    expect(readStored(PICKS_COLLAPSE_KEY)).toBe('shut');
    cleanup();

    const root = mount();
    expect(poolBox(root)).toBeNull();
    expect(screen.getByRole('button', { name: 'Expand picks' })).toBeTruthy();
  });
});

describe('the card viewer', () => {
  it('folds to its disclosure and opens again', () => {
    const root = mount();
    expect(viewerBody(root)).not.toBeNull();
    expect(root.querySelector('.mtg-work')?.getAttribute('data-rail')).toBe('split');

    const shut = screen.getByRole('button', { name: 'Collapse card viewer' });
    expect(attr(shut, 'aria-expanded')).toBe('true');
    fireEvent.click(shut);

    expect(viewerBody(root)).toBeNull();
    expect(root.querySelector('.mtg-rail__tabs')).toBeNull();
    expect(root.querySelector('.mtg-rail')?.getAttribute('data-collapsed')).toBe('true');
    expect(root.querySelector('.mtg-work')?.getAttribute('data-rail')).toBe('shut');
    expect(screen.queryByRole('button', { name: 'Collapse card viewer' })).toBeNull();

    const open = screen.getByRole('button', { name: 'Expand card viewer' });
    expect(attr(open, 'aria-expanded')).toBe('false');
    fireEvent.click(open);

    expect(viewerBody(root)).not.toBeNull();
    expect(root.querySelector('.mtg-rail__tabs')).not.toBeNull();
    expect(root.querySelector('.mtg-work')?.getAttribute('data-rail')).toBe('split');
    expect(readStored(VIEWER_COLLAPSE_KEY)).toBe('open');
  });

  it('keeps the commit button on the surface while shut, and the commit still commits', () => {
    const onPick = vi.fn();
    const root = mount(onPick);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse card viewer' }));

    // One commit, drawn under the pack rather than in the rail that is shut.
    const commits = screen.getAllByRole('button', { name: /^Pick / });
    expect(commits).toHaveLength(1);
    expect(root.querySelector('.mtg-work__main > .mtg-rail__foot > button')).not.toBeNull();
    expect(root.querySelector('.mtg-rail > .mtg-rail__foot')).toBeNull();

    const pack = screen.getByRole('group', { name: /^Draft pack / });
    fireEvent.click(within(pack).getAllByRole('button')[0]!);
    fireEvent.click(screen.getByRole('button', { name: /^Pick / }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});

describe('the printed draft', () => {
  let prepared: PreparedPrintedLimitedFormat;
  const playProps = {
    printedCards: [],
    playAvailability: { status: 'unavailable' as const, reason: 'Full Forge admission is incomplete.' },
  };

  beforeAll(async () => {
    const read = (name: string): unknown =>
      JSON.parse(readFileSync(`packages/data/data/akh-hou/${name}`, 'utf8'));
    prepared = await preparePrintedLimitedFormat(
      read('akh-hou-limited-format-v1.json'),
      ['akh', 'hou', 'mp2'].map((code) => read(`${code}-printed-catalog-v1.json`)),
      async (text) => createHash('sha256').update(text).digest('hex'),
    );
  });

  it('carries both disclosures through the shared surface', () => {
    const { container } = render(
      h(PrintedDraftRoute, { prepared, seed: 'draft-collapse-printed', onNewDraft: vi.fn(), ...playProps }),
    );
    const root = container as unknown as ElementLike;
    // A pool exists after the first pick, and the pool's disclosure with it.
    expect(screen.queryByRole('button', { name: 'Collapse picks' })).toBeNull();
    const pack = screen.getByRole('group', { name: /^Draft pack / });
    fireEvent.click(within(pack).getAllByRole('button')[0]!);
    fireEvent.click(screen.getByRole('button', { name: /^Pick / }));
    expect(screen.getByText('Pack 1 · Pick 2')).toBeTruthy();

    expect(poolBox(root)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse picks' }));
    expect(poolBox(root)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand picks' }));
    expect(poolBox(root)).not.toBeNull();

    expect(viewerBody(root)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse card viewer' }));
    expect(viewerBody(root)).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Pick / })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Expand card viewer' }));
    expect(viewerBody(root)).not.toBeNull();
  });
});
