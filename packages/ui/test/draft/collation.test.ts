// @vitest-environment jsdom
/**
 * The Draft tab deals the printing's pack, or says it could not.
 *
 * `mtg-nmqp`: a staged reduced printing carries the sheets it was really
 * collated on, the Play tab has always dealt from them, and this tab derived
 * sheets from DSL rarities instead — one lab, one set, two different packs, and
 * nothing on screen saying so. What is worth holding here is the wiring rather
 * than the sampler (`@mtg/draft-export`'s `collated-draft.test.ts` owns that):
 * that the route passes the block down, that a block it cannot deal is said out
 * loud above the pack, and that a stored draft dealt off other sheets is
 * refused rather than replayed against a pack that is not the one it named.
 */
import { createElement as h, useState } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { withoutBasicLands } from '@mtg/deckbuild';
import type { PackCollation } from '@mtg/deckbuild';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { DraftRoute } from '../../src/routes/DraftRoute';
import type { DraftRouteParams, DraftSetState } from '../../src/routes/DraftRoute';
import { COLLATION_UNUSABLE_TITLE } from '../../src/routes/PlayRoute';
import type { StagedCollation } from '../../src/lab/staged-collation';
import {
  clearDraftSession,
  DRAFT_SESSION_VERSION,
  resumeDraft,
  writeDraftSession,
} from '../../src/routes/draft/draft-session';
import { DRAFT_RESUME_LABEL, DRAFT_RESUME_STALE } from '../../src/routes/draft/DraftChooser';

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
const SEED = 'draft-collation-test';

const COMMONS = SET.filter((card) => card.rarity === 'common')
  .slice(0, 10)
  .map((card) => card.id);

/** A four-card pack off one sheet: nothing a rarity recipe would ever open. */
const SHEETS: PackCollation = {
  sheets: [{ name: 'common', weights: Object.fromEntries(COMMONS.map((id) => [id, 1])) }],
  boosters: [{ contents: { common: 4 }, weight: 1 }],
};

/**
 * The ready arm as `readStagedCollation` builds it, through the real transform.
 *
 * These sheets carry no basic land, so nothing comes out and the pack stays
 * four; running it anyway is what keeps the arm's shape honest here rather than
 * hand-written beside it.
 */
function ready(collation: PackCollation): StagedCollation {
  const [dealt, basicLands] = withoutBasicLands(SET, collation);
  return { kind: 'ready', collation: dealt, basicLands };
}

function Tab(props: { readonly collation?: StagedCollation }): ReturnType<typeof h> {
  const [params, setParams] = useState<DraftRouteParams>({ seed: SEED, picks: '' });
  return h(DraftRoute, {
    set: READY,
    params,
    onSetParams: (next: Readonly<Record<string, string>>) => {
      setParams(next);
    },
    ...(props.collation === undefined ? {} : { collation: props.collation }),
  });
}

/** No `lib: dom` in this workspace, so the two shapes this file reaches for are spelled out. */
interface ElementLike {
  readonly children: { readonly length: number };
  readonly textContent: string | null;
}

/** How many card faces the pack drew, which is the pack the pod opened. */
function packSize(): number {
  const pack = screen.getByRole('group', { name: /^Draft pack / }) as unknown as ElementLike;
  return pack.children.length;
}

describe('the Draft tab and the staged collation', () => {
  it('deals the printing pack when the document carries usable sheets', () => {
    render(h(Tab, { collation: ready(SHEETS) }));

    expect(packSize()).toBe(4);
  });

  it('deals the rarity recipe when the document carries no collation at all', () => {
    render(h(Tab, {}));

    // Whatever the recipe opens, it is not this collation's four.
    expect(packSize()).toBeGreaterThan(4);
  });

  it('says a collation it cannot deal rather than quietly dealing the recipe', () => {
    render(h(Tab, { collation: { kind: 'unusable', message: 'sheet common names nothing.' } }));

    const note = screen.getByRole('status') as unknown as ElementLike;
    expect(note.textContent).toContain(COLLATION_UNUSABLE_TITLE);
    expect(packSize()).toBeGreaterThan(4);
  });

  it('offers no resume for a draft stored against other sheets', () => {
    const dealt = resumeDraft(
      {
        version: DRAFT_SESSION_VERSION,
        seed: SEED,
        picks: [],
        packIds: [],
        botPolicy: 'native-deck-conditioned/v1',
      },
      SET,
      SHEETS,
    );
    expect(dealt.ok).toBe(false);

    writeDraftSession(SEED, [], ['not', 'this', 'pack']);
    render(
      h(function Chooser(): ReturnType<typeof h> {
        const [params, setParams] = useState<DraftRouteParams>({});
        return h(DraftRoute, {
          set: READY,
          params,
          collation: ready(SHEETS),
          onSetParams: (next: Readonly<Record<string, string>>) => {
            setParams(next);
          },
        });
      }),
    );

    expect(screen.getByText(DRAFT_RESUME_STALE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: DRAFT_RESUME_LABEL })).toBeNull();
  });
});
