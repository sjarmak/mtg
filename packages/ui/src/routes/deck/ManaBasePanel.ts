/**
 * The mana base, with every number's inputs beside it.
 *
 * This is the on-screen form of what `formatConstructedDeckReport` prints for a
 * terminal, and it keeps that report's rule: a color's castability never
 * appears without the sources it was computed from and the card that demanded
 * them. "Black is 78% castable" is unactionable on its own; "78%, wants 16
 * sources, has 14, and the card asking is Bitterblossom's second pip on turn
 * two" tells you what to change.
 *
 * The percentage on a row is the *binding* check's — the one that set the floor
 * — not the color's cheapest card's. Quoting the cheapest would print a row
 * reading "needs 16, castable 94%" for a color the shortfalls below call
 * short. Rounded down for the same reason: 89.6% is not 90%.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { colorToIdentity } from '../../card/identity';
import type { DeckArtifact, DeckArtifactColor } from '../../lab/deck-artifact';

export interface ManaBasePanelProps {
  readonly deck: DeckArtifact;
}

const COLUMNS: readonly string[] = [
  'color',
  'pips',
  'weighted demand',
  'basics',
  'nonbasic',
  'sources',
  'needs',
  'castable on curve',
  'floor set by',
];

/** Rounded down: a color that clears 89.6% has not cleared 90%. */
export function percent(value: number): string {
  return `${String(Math.floor(value * 100))}%`;
}

/**
 * A pip count is a whole number in every deck this has assembled — hybrid
 * pips are the one way it could come out fractional, and even those split
 * evenly. Printed as what it is: a whole count reads as a whole count, never
 * a manufactured ".0". `weightedDemand` is the genuinely fractional figure
 * and keeps its own decimal.
 */
function pipsText(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function bindingCell(report: DeckArtifactColor): ReactNode {
  const { binding } = report;
  if (binding === null) return '—';
  const pips = binding.pips === 1 ? '1 source' : `${String(binding.pips)} sources`;
  return createElement(
    'span',
    { className: 'mtg-mana__binding' },
    createElement('span', { className: 'mtg-mana__binding-card' }, binding.cardName),
    ` · ${pips} by turn ${String(binding.manaValue)}, to ${percent(binding.target)}`,
  );
}

function row(report: DeckArtifactColor): ReactElement {
  return createElement(
    'tr',
    { key: report.color, className: 'mtg-mana__row', 'data-meets': String(report.meetsTarget) },
    createElement(
      'td',
      null,
      createElement(
        'span',
        { className: 'mtg-mana__color' },
        createElement('span', {
          className: 'mtg-swatch',
          'data-identity': colorToIdentity(report.color),
          'aria-hidden': true,
        }),
        report.color,
      ),
    ),
    createElement('td', null, pipsText(report.pipCount)),
    createElement('td', null, report.weightedDemand.toFixed(1)),
    createElement('td', null, String(report.basicSources)),
    createElement('td', null, String(report.nonBasicSources)),
    createElement('td', null, String(report.sources)),
    createElement('td', null, String(report.sourceFloor)),
    createElement('td', { className: 'mtg-mana__cast' }, percent(report.castability)),
    createElement('td', null, bindingCell(report)),
  );
}

/**
 * The table, or the sentence that replaces it.
 *
 * A deck whose criteria name no colors has no rows. The rows are `assembleDeck`'s
 * (`@mtg/decklab`): it reports one color per entry of `resolveDeckColors`, which
 * returns the stated colors or, failing that, the colors the spells' fixed pips
 * demand, so a deck with neither reports none. `buildManaBase` in `@mtg/deckbuild`
 * is a different builder with a different caller and never reaches this page: it
 * takes a two-color pair and always reports both of them. Drawing the nine
 * headers over an empty body left the page with a table of nothing, and the
 * bands paragraph below it explaining how those absent rows had been scored.
 * What is true of such a deck is one sentence, so that is what it gets.
 */
function colorTable(colors: readonly DeckArtifactColor[]): ReactElement {
  if (colors.length === 0) {
    return createElement(
      'p',
      { className: 'mtg-mana__caption' },
      'No card here asks for colored mana, so no color has a source floor to meet.',
    );
  }
  return createElement(
    'div',
    { className: 'mtg-mana__scroll' },
    createElement(
      'table',
      { className: 'mtg-mana__table' },
      createElement(
        'thead',
        null,
        createElement(
          'tr',
          null,
          ...COLUMNS.map((label) => createElement('th', { key: label, scope: 'col' }, label)),
        ),
      ),
      createElement('tbody', null, ...colors.map(row)),
    ),
  );
}

export function ManaBasePanel(props: ManaBasePanelProps): ReactElement {
  const { manaBase, landPlan, shortfalls } = props.deck;
  const basics = manaBase.totalLands - manaBase.nonBasicLands;

  const table = colorTable(manaBase.colors);

  // The count's provenance is part of the deck's argument, not a footnote: a
  // land count nobody can trace is how twenty-four lands end up in a burn deck.
  // Said once, not twice: the basic/nonbasic split folds into the same clause
  // as the count instead of a second sentence restating it.
  //
  // `landPlan.count` and `manaBase.totalLands` are independent fields —
  // one is the judgment made before assembly, the other is what assembly
  // actually built — and nothing constrains them to agree. They do in every
  // deck built so far, which is exactly why folding them together used to
  // read as duplication. When the nonbasic lands alone already exceed the
  // plan, `assembleDeck`'s clamp lets the built total run past it, and that
  // gap belongs on the page rather than under a reason it did not produce.
  const reasonClause =
    landPlan.source === 'stated' ? `${landPlan.reason}.` : `chosen for this deck: ${landPlan.reason}`;
  const provenance = createElement(
    'p',
    { className: 'mtg-mana__caption' },
    manaBase.totalLands === landPlan.count
      ? `${String(manaBase.totalLands)} lands (${String(basics)} basic, ${String(manaBase.nonBasicLands)} nonbasic), ${reasonClause}`
      : `${String(manaBase.totalLands)} lands (${String(basics)} basic, ${String(manaBase.nonBasicLands)} nonbasic); ` +
          `the plan called for ${String(landPlan.count)}, ${reasonClause}`,
  );

  // Said only where there are rows to say it about: the two bands are a rule
  // for reading the table, not a fact about the deck.
  const bands =
    manaBase.colors.length === 0
      ? null
      : createElement(
          'p',
          { className: 'mtg-mana__caption' },
          `A color's cheapest requirement is held to ${percent(manaBase.castabilityTarget)} on curve; ` +
            `the deck's heaviest single-card requirement is held to ${percent(manaBase.heavyCastabilityTarget)}, ` +
            'because missing a color entirely and casting one card a turn late are not the same failure. ' +
            'Each row is scored against whichever check set its floor.',
        );

  const shortfallList =
    shortfalls.length === 0
      ? null
      : createElement(
          'ul',
          { className: 'mtg-mana__shortfalls' },
          ...shortfalls.map((shortfall, index) =>
            createElement('li', { key: `${String(index)}` }, shortfall),
          ),
        );

  return createElement('div', { className: 'mtg-mana' }, table, provenance, bands, shortfallList);
}
