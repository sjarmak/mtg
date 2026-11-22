// @vitest-environment jsdom
/**
 * The pack reads most-rare first, and picking still takes the card you pressed.
 *
 * A booster is dealt in collation order — the commons the sheet produced, then
 * whatever the rare slot opened — so the one card in the pack that decides most
 * picks was drawn wherever the deal happened to put it, usually in the last row
 * of a grid the phone has to scroll. the playtester asked for it in the upper left.
 *
 * The claim with the teeth is the second one. A pack position is the identity
 * of a face on this screen (`../../src/routes/draft/DraftPack.ts`'s `Selection`
 * says why: a pack of commons holds two copies of one card, and an id would
 * light both of them). So drawing the pack in another order and keeping the
 * index the drawing loop hands out would point every selection at whatever the
 * sort moved into that slot — the screen would read the rare and pick a common.
 */
import { createElement as h } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Card, Rarity } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { HumanDraftChoice, HumanDraftProgress } from '@mtg/draft-export';
import { DraftPack } from '../../src/routes/draft/DraftPack';
import { packOrder, packOrderBy } from '../../src/routes/draft/pack-order';

afterEach(cleanup);

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

/** No `lib: dom` in this workspace, so the shapes this file reaches for are spelled out. */
interface ElementLike {
  readonly textContent: string | null;
  readonly getAttribute: (name: string) => string | null;
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly querySelectorAll: (selector: string) => {
    readonly length: number;
    readonly [index: number]: ElementLike;
  };
}

/**
 * A pack of one set's cards with the rarities this test is about written onto
 * them.
 *
 * The fixture set is commons and uncommons only, and a rarity is a field on the
 * card rather than something the pack decides, so the rarities are stated here.
 * The deal order is deliberately the order nobody wants to read: the mythic is
 * second and the rare is fourth.
 */
const RARITIES: readonly Rarity[] = ['common', 'mythic', 'uncommon', 'rare', 'common'];

function loadPack(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: Record<string, unknown>[] };
  return RARITIES.map((rarity, index) => {
    const card = cards[index];
    if (card === undefined) throw new Error('the fixture set is too small');
    return parseCard({ ...card, rarity });
  });
}

const PACK = loadPack();

function nameAt(index: number): string {
  const card = PACK[index];
  if (card === undefined) throw new Error(`the pack has no card ${String(index)}`);
  return card.name;
}

const NEXT: HumanDraftChoice = {
  round: 1,
  pickNumber: 1,
  packSize: PACK.length,
  openedBy: 0,
  cards: PACK,
};

const DRAFT: HumanDraftProgress = {
  seed: 'draft-pack-order',
  humanSeat: 0,
  picks: [],
  seats: [],
  rounds: 3,
  directions: [],
  ratings: [],
  botPolicy: 'native-deck-conditioned/v1',
  nextPick: NEXT,
  result: null,
};

function mount(): ElementLike {
  const { container } = render(
    h(DraftPack, {
      draft: DRAFT,
      next: NEXT,
      pool: [],
      onPick: (): void => undefined,
      onNewDraft: (): void => undefined,
    }),
  );
  const screen = (container as unknown as ElementLike).querySelector('.mtg-draft');
  if (screen === null) throw new Error('the draft screen did not render');
  return screen;
}

function faces(screen: ElementLike): readonly ElementLike[] {
  const found = screen.querySelectorAll('.mtg-thumbs > .mtg-card');
  return Array.from({ length: found.length }, (_, index) => {
    const face = found[index];
    if (face === undefined) throw new Error('a pack face went missing');
    return face;
  });
}

function commitLabel(screen: ElementLike): string {
  const foot = screen.querySelector('.mtg-rail__foot > button');
  if (foot === null) throw new Error('the rail has no commit button');
  return foot.textContent ?? '';
}

describe('the order a pack is read in', () => {
  it('puts the rarest card first and the commons last', () => {
    expect(packOrder(PACK).map((position) => position.card.rarity)).toEqual([
      'mythic',
      'rare',
      'uncommon',
      'common',
      'common',
    ]);
  });

  it('keeps the deal order inside one rarity, so a pack is not reshuffled', () => {
    const commons = packOrder(PACK).filter((position) => position.card.rarity === 'common');
    expect(commons.map((position) => position.index)).toEqual([0, 4]);
  });

  it('carries each card back to the position the pack dealt it in', () => {
    for (const position of packOrder(PACK)) {
      expect(PACK[position.index]).toBe(position.card);
    }
  });

  it('ranks a printed pack the same way through a rarity the card does not carry', () => {
    // A printed booster copy has no rarity on it; the format's display metadata
    // does, keyed by the printing. `null` is a printing that metadata has no
    // rarity for, and it reads last rather than first or nowhere.
    const dealt = ['c1', 'r1', 'u1', 'x1', 'c2'] as const;
    const rarities = new Map<string, string>([
      ['c1', 'common'],
      ['r1', 'rare'],
      ['u1', 'uncommon'],
      ['c2', 'common'],
    ]);
    const ordered = packOrderBy(dealt, (id) => rarities.get(id) ?? null);
    expect(ordered.map((position) => position.card)).toEqual(['r1', 'u1', 'c1', 'c2', 'x1']);
    expect(ordered.map((position) => position.index)).toEqual([1, 2, 0, 4, 3]);
  });

  it('is what the screen draws', () => {
    const screen = mount();
    // The face's accessible name is a whole sentence about the card; the name is
    // its first clause and is what says which card is in that slot.
    const named = faces(screen).map((face) => (face.getAttribute('aria-label') ?? '').split('. ')[0]);
    expect(named).toEqual([nameAt(1), nameAt(3), nameAt(2), nameAt(0), nameAt(4)]);
  });

  it('picks the card that was pressed rather than the one dealt into that slot', () => {
    const screen = mount();
    const first = faces(screen)[0];
    if (first === undefined) throw new Error('the pack drew no faces');
    fireEvent.click(first as unknown as Element);
    expect(commitLabel(screen)).toBe(`Pick ${nameAt(1)}`);
  });
});
