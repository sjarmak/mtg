// @vitest-environment jsdom
/**
 * The plain DSL sealed pool at compact (`../../src/routes/play/SealedBuilder.ts`'s
 * own `cardPane`), which `mtg-eeqnj` moved from small card-shaped tiles onto
 * the same name strips the deck pane beside it already draws.
 *
 * The pane has exactly one gesture -- a click toggles a pool position into the
 * deck -- so the compact strip carries only `onSelect`; there is no second
 * click or right click to preserve here the way the Constructed pool and the
 * physical pool both have.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { PlayRoute } from '../../src/routes/PlayRoute';
import type { PlaySetState } from '../../src/routes/PlayRoute';
import { SEALED_POOL_LABEL } from '../../src/routes/play/SealedBuilder';
import { generateSealed } from '../support/play-chooser';

afterEach(cleanup);

function ready(cards: readonly Card[]): PlaySetState {
  return { status: 'ready', cards };
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
const SEED = 'sealed-pool-strips-test/v0';

interface ElementLike {
  readonly getAttribute: (name: string) => string | null;
  readonly querySelectorAll: (selector: string) => { readonly length: number };
}

function asElement(value: unknown): ElementLike {
  const candidate = value as Partial<ElementLike> | null | undefined;
  if (candidate === null || candidate === undefined || typeof candidate.getAttribute !== 'function') {
    throw new Error('expected a rendered element');
  }
  return candidate as ElementLike;
}

const COUNTS_LINE = /^\d+ of \d+ cards · /;

function deckTotal(): number {
  const found = screen.getAllByText(COUNTS_LINE)[0];
  if (found === undefined) throw new Error('the builder states no count of the deck');
  const line = (found as unknown as { readonly textContent: string | null }).textContent ?? '';
  const total = /^(\d+) of /.exec(line);
  if (total === null) throw new Error(`no deck total in ${line}`);
  return Number(total[1]);
}

function switchPoolToCompact(): void {
  fireEvent.click(
    within(screen.getByRole('group', { name: `${SEALED_POOL_LABEL}, View` })).getByRole('button', {
      name: 'Compact list',
    }),
  );
}

describe('the sealed pool pane at compact, drawn as strips', () => {
  it('draws one strip per pool position, with no picture', () => {
    render(h(PlayRoute, { sub: 'sealed', set: ready(SET), seed: SEED }));
    generateSealed();
    switchPoolToCompact();
    const pool = asElement(screen.getByRole('group', { name: SEALED_POOL_LABEL }));
    expect(pool.getAttribute('data-density')).toBe('compact');
    expect(pool.querySelectorAll('.mtg-art').length).toBe(0);
    expect(pool.querySelectorAll('img').length).toBe(0);
  });

  it('toggles a position into the deck on a click, the pane’s one move', () => {
    render(h(PlayRoute, { sub: 'sealed', set: ready(SET), seed: SEED }));
    generateSealed();
    switchPoolToCompact();
    const before = deckTotal();
    const pool = screen.getByRole('group', { name: SEALED_POOL_LABEL });
    const strip = within(pool).getAllByRole('button')[0];
    if (strip === undefined) throw new Error('the compact pool drew no strips');
    fireEvent.click(strip);
    expect(deckTotal()).toBe(before + 1);
  });
});
