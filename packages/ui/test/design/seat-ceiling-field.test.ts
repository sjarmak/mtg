// @vitest-environment jsdom
/**
 * A brief can state a seat ceiling in the lab, not only in a JSON file.
 *
 * `mtg-4xvs` split a required card's rarity into the design statement and the
 * ceiling the pin derivation is allowed to relax to. The panel that edits a
 * required card knew nothing about the second half, so a brief authored here
 * could name a rarity it could not afford to seat and had no way to say what to
 * do about it (`mtg-9ri3`).
 *
 * The two rules the schema states are enforced by what the field offers rather
 * than only by what the server refuses: a ceiling with no rarity above it has no
 * list, and a ceiling equal to or above the stated rarity is not in the list.
 * The other half of the claim is in `./brief-draft.test.ts`, against
 * `@mtg/setgen`'s real schema: a page that narrows a control and a schema that
 * refuses the value are two different claims and only the second one is
 * binding. It lives there rather than here because this file runs in jsdom and
 * `@mtg/setgen` reads its canon data off the file system.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { blankDraft, EMPTY_REQUIRED_CARD } from '../../src/routes/design/draft';
import type { BriefDraft, RequiredCardDraft } from '../../src/routes/design/draft';
import { RequiredCardsPanel } from '../../src/routes/design/RequiredCardsPanel';

afterEach(cleanup);

const VOCABULARY = {
  keywords: [],
  effectKinds: [],
  abilityKinds: [],
  triggerConditions: [],
  colors: ['W', 'U', 'B', 'R', 'G'],
  requiredPools: ['W', 'U', 'B', 'R', 'G', 'colorless'],
  rarities: ['common', 'uncommon', 'rare', 'mythic'],
  sliceRarities: ['common', 'uncommon', 'rare'],
  cardKinds: ['creature'],
  counterKinds: ['charge'],
  spellRoles: [],
  colorPieSubjects: [],
  targetSize: { min: 60, max: 400, default: 250 },
  mechanics: { min: 1, max: 6 },
  setCodePattern: '^[A-Z0-9]{3,5}$',
  subtypePattern: '^[A-Za-z]+$',
};

/** The panel over one card, and the last draft it handed up. */
function panelOver(card: RequiredCardDraft): { readonly latest: () => BriefDraft } {
  let latest: BriefDraft = { ...blankDraft(), requiredCards: [card] };
  const onChange = (draft: BriefDraft): void => {
    latest = draft;
  };
  render(h(RequiredCardsPanel, { draft: latest, onChange, issues: [], vocabulary: VOCABULARY }));
  return { latest: () => latest };
}

/**
 * A select, read through its shape rather than through `HTMLSelectElement`.
 *
 * The workspace tsconfig sets no `dom` lib (this is a Node build that renders
 * React to markup elsewhere), so `./design-route.test.ts` reads elements the
 * same way: the property this test needs, and no global type at all.
 */
interface SelectLike {
  readonly disabled: boolean;
  readonly options: ArrayLike<{ readonly value: string }>;
}

const selectAt = (label: string): SelectLike => screen.getByLabelText(label) as unknown as SelectLike;

const optionsOf = (select: SelectLike): readonly string[] =>
  Array.from(select.options).map((option) => option.value);

const CEILING_LABEL = 'Seat it as low as';

describe('the seat ceiling field', () => {
  it('offers no ceiling until a rarity is stated, and says why rather than hiding', () => {
    panelOver({ ...EMPTY_REQUIRED_CARD, name: 'Marquee Gear' });

    expect(selectAt(CEILING_LABEL).disabled).toBe(true);
    expect(optionsOf(selectAt(CEILING_LABEL))).toEqual(['']);
    expect(screen.getByText('State a rarity first')).toBeDefined();
  });

  it('offers every rarity below the stated one and none at or above it', () => {
    panelOver({ ...EMPTY_REQUIRED_CARD, name: 'Marquee Gear', rarity: 'rare' });

    expect(selectAt(CEILING_LABEL).disabled).toBe(false);
    expect(optionsOf(selectAt(CEILING_LABEL))).toEqual(['', 'common', 'uncommon']);
  });

  // The lowest rarity is a rarity with nothing under it, which is a field that
  // stays shut rather than one that offers the unset entry alone.
  it('offers nothing under the lowest rarity there is', () => {
    panelOver({ ...EMPTY_REQUIRED_CARD, name: 'Marquee Gear', rarity: 'common' });

    expect(selectAt(CEILING_LABEL).disabled).toBe(true);
    expect(optionsOf(selectAt(CEILING_LABEL))).toEqual(['']);
  });

  it('drops a ceiling the rarity has fallen to, rather than sending one the schema refuses', () => {
    const panel = panelOver({
      ...EMPTY_REQUIRED_CARD,
      name: 'Marquee Gear',
      rarity: 'mythic',
      seatCeiling: 'rare',
    });

    fireEvent.change(screen.getByLabelText('Rarity'), { target: { value: 'uncommon' } });

    expect(panel.latest().requiredCards[0]?.seatCeiling).toBe('');
  });

  it('keeps a ceiling the new rarity is still above', () => {
    const panel = panelOver({
      ...EMPTY_REQUIRED_CARD,
      name: 'Marquee Gear',
      rarity: 'mythic',
      seatCeiling: 'common',
    });

    fireEvent.change(screen.getByLabelText('Rarity'), { target: { value: 'rare' } });

    expect(panel.latest().requiredCards[0]?.seatCeiling).toBe('common');
  });
});
