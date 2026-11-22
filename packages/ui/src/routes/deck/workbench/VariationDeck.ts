import { createElement } from 'react';
import type { ReactElement } from 'react';
import { symbolizeLine } from '../../../card/SymbolText';
import { curveFrom } from '../build';
import type { CurveStep } from '../build';
import { CurveColumns } from '../CurveColumns';
import { curveStrip } from '../CurveStrip';
import { GroupingControl, useDeckGrouping } from '../GroupingControl';
import { groupMembers, offeredGroupings } from '../grouping';
import type { GroupingFacts } from '../grouping';
import type { Variation, VariationEntry } from './client';

export const DECK_PANE = 'Deck';
export const DECK_GROUPS_LABEL = 'Cards in this deck';
const STORE_PANE = 'workbench-deck';
const COLOR_ORDER = 'WUBRG';

function costColors(manaCost: string | null): string {
  if (manaCost === null) return '';
  const letters = new Set<string>();
  for (const pip of manaCost.matchAll(/\{([^}]*)\}/g)) {
    for (const letter of (pip[1] ?? '').toUpperCase()) {
      if (COLOR_ORDER.includes(letter)) letters.add(letter);
    }
  }
  return [...letters].sort((left, right) => COLOR_ORDER.indexOf(left) - COLOR_ORDER.indexOf(right)).join('');
}

export function entryGroupingFacts(entry: VariationEntry): GroupingFacts {
  return {
    name: entry.name,
    manaValue: entry.manaValue,
    colorIdentity: costColors(entry.manaCost),
    typeLine: entry.typeLine,
    rarity: null,
  };
}

function deckEntries(variation: Variation): readonly VariationEntry[] {
  return [...variation.spells, ...variation.lands];
}

export function variationCurve(variation: Variation): readonly CurveStep[] {
  return curveFrom(
    deckEntries(variation).map((entry) => ({ manaValue: entry.manaValue, cards: entry.count })),
  );
}

function entryBox(entry: VariationEntry, statements: ReadonlyMap<string, string>): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-workbench__entry', key: entry.id },
    createElement(
      'div',
      { className: 'mtg-workbench__entry-head' },
      createElement('span', { className: 'mtg-workbench__entry-count' }, `${String(entry.count)}x`),
      createElement('span', { className: 'mtg-workbench__entry-name' }, entry.name),
      entry.manaCost === null
        ? null
        : createElement('span', { className: 'mtg-workbench__entry-cost' }, ...symbolizeLine(entry.manaCost)),
      createElement('span', { className: 'mtg-workbench__entry-type' }, entry.typeLine),
    ),
    createElement('p', { className: 'mtg-workbench__entry-reason' }, entry.reason),
    entry.criteria.length === 0
      ? null
      : createElement(
          'ul',
          { className: 'mtg-workbench__cites' },
          entry.criteria.map((id) =>
            createElement(
              'li',
              {
                key: id,
                className: 'mtg-workbench__cite',
                'data-resolved': statements.has(id) ? 'true' : 'false',
                title: statements.get(id) ?? `no criterion ${id} was stated`,
              },
              id,
            ),
          ),
        ),
  );
}

export interface VariationDeckProps {
  readonly variation: Variation;
  readonly statements: ReadonlyMap<string, string>;
}

export function VariationDeck(props: VariationDeckProps): ReactElement {
  const { variation, statements } = props;
  const entries = deckEntries(variation);
  const offered = offeredGroupings(entries.map(entryGroupingFacts));
  const state = useDeckGrouping(STORE_PANE, offered);
  const groups = groupMembers(entries, entryGroupingFacts, (entry) => entry.count, state.grouping);
  return createElement(
    'div',
    { className: 'mtg-workbench__deck' },
    curveStrip(variationCurve(variation)),
    createElement(
      'div',
      { className: 'mtg-workbench__deck-head' },
      createElement(GroupingControl, { pane: DECK_PANE, offered, state }),
    ),
    CurveColumns({
      groups,
      view: 'compact',
      label: DECK_GROUPS_LABEL,
      flow: 'rows',
      faces: (group) => group.members.map((entry) => entryBox(entry, statements)),
    }),
  );
}
