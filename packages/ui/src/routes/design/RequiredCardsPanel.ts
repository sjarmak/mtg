/**
 * The cards this set must contain, and where each one is pinned.
 *
 * `mtg-yddw.2`. A required card is a name and a set of narrowings: the pool it
 * sits in, its kind, its rarity, its cost. Every narrowing may be left blank,
 * and blank means "any" — `../design/draft.ts`'s `briefFrom` is the one place
 * that turns a blank box into an absent field, because the schema reads an
 * absent pool as "wherever it fits" and an empty string as a pool that does not
 * exist.
 *
 * The allocator seats these before it seats anything else, and it refuses a
 * brief it cannot seat rather than dropping a name. So the skeleton panel below
 * the editor is where a designer finds out that four legendary red rares do not
 * fit in a set with three red rare slots — for nothing, before a run pays for
 * the same answer.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { BriefIssue, Vocabulary } from './client';
import { EMPTY_REQUIRED_CARD } from './draft';
import type { BriefDraft, RequiredCardDraft } from './draft';
import { checkField, panel, removedAt, replacedAt, selectField, textField } from './fields';

export const REQUIRED_TITLE = 'Cards the set must contain';

const REQUIRED_EXPLAIN =
  'Named cards the generator has to print. Every narrowing below may be left unset, and unset means the allocator puts the card wherever it fits. A brief that asks for cards it cannot seat is refused rather than quietly thinned.';

export const ADD_REQUIRED_LABEL = 'Add a card';

export const REMOVE_REQUIRED_LABEL = 'Remove';

export const NO_REQUIRED_NOTE =
  'No named cards. The whole set is generated from the theme and the mechanics.';

export interface RequiredCardsPanelProps {
  readonly draft: BriefDraft;
  readonly onChange: (draft: BriefDraft) => void;
  readonly issues: readonly BriefIssue[];
  readonly vocabulary: Vocabulary | null;
}

function options(
  vocabulary: Vocabulary | null,
  list: 'requiredPools' | 'cardKinds' | 'rarities' | 'counterKinds',
) {
  return vocabulary === null ? [] : vocabulary[list];
}

/** The rarities below a stated one, in the vocabulary's own order. */
function ceilingsUnder(rarities: readonly string[], rarity: string): readonly string[] {
  const stated = rarities.indexOf(rarity);
  return rarity === '' || stated < 0 ? [] : rarities.slice(0, stated);
}

export function RequiredCardsPanel(props: RequiredCardsPanelProps): ReactElement {
  const { draft, onChange, issues, vocabulary } = props;

  const replace = (index: number, card: RequiredCardDraft): void => {
    onChange({ ...draft, requiredCards: replacedAt(draft.requiredCards, index, card) });
  };

  const cards = draft.requiredCards.map((card, index) => {
    const at = `requiredCards.${String(index)}`;
    const set = <K extends keyof RequiredCardDraft>(key: K) => {
      return (value: RequiredCardDraft[K]): void => {
        replace(index, { ...card, [key]: value });
      };
    };
    // Every rarity below the stated one, in the server's own order, which is the
    // order the schema compares in. Nothing at all when no rarity is stated: a
    // ceiling with no design statement above it is refused, and offering the
    // list anyway would be offering a choice that cannot be kept.
    const rarities = options(vocabulary, 'rarities');
    const ceilings = ceilingsUnder(rarities, card.rarity);
    // A rarity that moves down under a ceiling leaves that ceiling equal or
    // above, which the schema refuses. Dropped here rather than left for the
    // server to refuse: the designer lowered the rarity, and a ceiling they can
    // no longer see is not a statement they are still making.
    const setRarity = (rarity: string): void => {
      const keep = ceilingsUnder(rarities, rarity).includes(card.seatCeiling);
      replace(index, { ...card, rarity, seatCeiling: keep ? card.seatCeiling : '' });
    };
    return createElement(
      'article',
      { key: at, className: 'mtg-design__item' },
      createElement(
        'div',
        { className: 'mtg-design__row' },
        textField({
          id: `${at}-name`,
          label: 'Name',
          value: card.name,
          onChange: set('name'),
          issues,
          pointer: `${at}.name`,
        }),
        createElement(
          'button',
          {
            type: 'button',
            className: 'mtg-btn',
            onClick: (): void => {
              onChange({ ...draft, requiredCards: removedAt(draft.requiredCards, index) });
            },
          },
          REMOVE_REQUIRED_LABEL,
        ),
      ),
      createElement(
        'div',
        { className: 'mtg-design__row' },
        selectField({
          id: `${at}-color`,
          label: 'Pool',
          value: card.color,
          options: options(vocabulary, 'requiredPools'),
          onChange: set('color'),
          issues,
          pointer: `${at}.color`,
          anyLabel: 'Any pool',
        }),
        selectField({
          id: `${at}-kind`,
          label: 'Card kind',
          value: card.cardKind,
          options: options(vocabulary, 'cardKinds'),
          onChange: set('cardKind'),
          issues,
          pointer: `${at}.cardKind`,
          anyLabel: 'Any kind',
        }),
        selectField({
          id: `${at}-rarity`,
          label: 'Rarity',
          value: card.rarity,
          options: options(vocabulary, 'rarities'),
          onChange: setRarity,
          issues,
          pointer: `${at}.rarity`,
          anyLabel: 'Any rarity',
        }),
        selectField({
          id: `${at}-seat-ceiling`,
          label: 'Seat it as low as',
          value: card.seatCeiling,
          options: ceilings,
          onChange: set('seatCeiling'),
          issues,
          pointer: `${at}.seatCeiling`,
          anyLabel: card.rarity === '' ? 'State a rarity first' : `Seat it at ${card.rarity}`,
          disabled: ceilings.length === 0,
          hint: 'The rarity the allocator may relax to when the tier above has no slot left. The card is still designed at the rarity beside it.',
        }),
        textField({
          id: `${at}-mv`,
          label: 'Mana value',
          value: card.manaValue,
          onChange: set('manaValue'),
          issues,
          pointer: `${at}.manaValue`,
        }),
      ),
      textField({
        id: `${at}-flavor`,
        label: 'Flavor direction',
        value: card.flavorDirection,
        onChange: set('flavorDirection'),
        issues,
        pointer: `${at}.flavorDirection`,
        rows: 2,
        hint: 'One line about what this card is, read by the model beside the theme.',
      }),
      createElement(
        'div',
        { className: 'mtg-design__row' },
        checkField(`${at}-equipment`, 'Equipment', card.equipment, set('equipment')),
        checkField(`${at}-legendary`, 'Legendary', card.legendary, set('legendary')),
        selectField({
          id: `${at}-counter`,
          label: 'Counter it uses',
          value: card.partCounter,
          options: options(vocabulary, 'counterKinds'),
          onChange: set('partCounter'),
          issues,
          pointer: `${at}.partCounter`,
          anyLabel: 'No counter',
        }),
        textField({
          id: `${at}-sacrifice`,
          label: 'Subtype it sacrifices',
          value: card.sacrificeSubtype,
          onChange: set('sacrificeSubtype'),
          issues,
          pointer: `${at}.sacrificeSubtype`,
        }),
        textField({
          id: `${at}-supplies`,
          label: 'Subtype it supplies',
          value: card.suppliesSubtype,
          onChange: set('suppliesSubtype'),
          issues,
          pointer: `${at}.suppliesSubtype`,
          hint: 'A card that eats a subtype and a card that makes one are a pair the allocator checks for.',
        }),
      ),
    );
  });

  return panel(
    REQUIRED_TITLE,
    REQUIRED_EXPLAIN,
    ...(cards.length === 0
      ? [createElement('p', { className: 'mtg-design__hint' }, NO_REQUIRED_NOTE)]
      : cards),
    createElement(
      'div',
      { className: 'mtg-toolbar' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'mtg-btn',
          onClick: (): void => {
            onChange({ ...draft, requiredCards: [...draft.requiredCards, EMPTY_REQUIRED_CARD] });
          },
        },
        ADD_REQUIRED_LABEL,
      ),
    ),
  );
}
