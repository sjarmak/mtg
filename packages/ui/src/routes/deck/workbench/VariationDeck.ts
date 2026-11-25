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
import { sharedCriteria } from '../OpenDeckScreen';
import type { Variation, VariationEntry } from './client';

export const DECK_PANE = 'Deck';
export const DECK_GROUPS_LABEL = 'Cards in this deck';
export const SHARED_CRITERIA_LABEL = 'Criteria every card here meets';
export const SHARED_CRITERIA_LEAD =
  'Every card below meets these; a card lists only what else it was chosen for.';
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

/**
 * One citation. A resolved one reads as its id with the statement on hover; an
 * id nobody stated is marked rather than dropped, wherever it is drawn, because
 * that marking is what makes "every card traces to a stated criterion"
 * falsifiable on this page.
 */
function cite(id: string, statements: ReadonlyMap<string, string>, text: string = id): ReactElement {
  const statement = statements.get(id);
  return createElement(
    'li',
    {
      key: id,
      className: 'mtg-workbench__cite',
      'data-criterion': id,
      'data-resolved': statement === undefined ? 'false' : 'true',
      title: statement === undefined ? `no criterion ${id} was stated` : id,
    },
    text,
  );
}

/**
 * The criteria every row cites, said once and in the person's own words.
 *
 * Measured on a twelve-row build before this: 62 citation chips, and every row
 * opened with the same four ids, so a row's chips told it from its neighbors in
 * one or two ids out of five or six. `../OpenDeckScreen.ts` already answers this
 * for the other deck surface; this is the same answer, with one thing that
 * screen cannot do: a variation carries `statedCriteria`, so the shared line
 * prints each statement rather than its id. An unstated id has no statement and
 * prints as itself, marked.
 */
function sharedLine(shared: readonly string[], statements: ReadonlyMap<string, string>): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-workbench__shared' },
    createElement('span', { className: 'mtg-workbench__shared-lead' }, SHARED_CRITERIA_LEAD),
    createElement(
      'ul',
      { className: 'mtg-workbench__cites', 'aria-label': SHARED_CRITERIA_LABEL },
      shared.map((id) => cite(id, statements, statements.get(id) ?? id)),
    ),
  );
}

function entryBox(
  entry: VariationEntry,
  statements: ReadonlyMap<string, string>,
  shared: readonly string[],
): ReactElement {
  const own = entry.criteria.filter((id) => !shared.includes(id));
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
    own.length === 0
      ? null
      : createElement(
          'ul',
          { className: 'mtg-workbench__cites' },
          own.map((id) => cite(id, statements)),
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
  const shared = sharedCriteria(entries);
  return createElement(
    'div',
    { className: 'mtg-workbench__deck' },
    shared.length === 0 ? null : sharedLine(shared, statements),
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
      faces: (group) => group.members.map((entry) => entryBox(entry, statements, shared)),
    }),
  );
}
