/**
 * A built variation, read: the plan, the list, why each card is here, and the
 * mana base it was built to.
 *
 * The provenance is the part that is not decoration. `mtg-bc2.24`'s second
 * acceptance clause is that every card choice traces to a stated criterion, and
 * until this it was checkable only in a terminal report. A clause nobody can see
 * on the surface where they actually look at the deck is a clause that rots. So
 * every row names the criteria it cited, and the ids resolve against the
 * variation's own `statedCriteria` rather than against anything this page knows
 * — a citation naming an id the person never stated is a defect, and drawing it
 * as an unresolved id is how it gets noticed.
 *
 * Shortfalls are drawn, not hidden. A variation four cards short is a real
 * variation somebody may still want to look at, and a view that drew it as
 * finished would be lying about it.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { deckTypeCounts, typeCountsLine } from '../type-counts';
import type { Variation } from './client';
import { VariationDeck } from './VariationDeck';

export const PLAN_LABEL = 'The plan';
export const SHORTFALL_LABEL = 'What this build could not do';
export const MANA_BASE_LABEL = 'Mana base';
export const PROVENANCE_LABEL = 'Why each card is here';

function section(title: string, ...children: readonly ReactNode[]): ReactElement {
  return createElement(
    'section',
    { className: 'mtg-workbench__section' },
    createElement('h3', { className: 'mtg-workbench__section-title' }, title),
    ...children,
  );
}

/**
 * The play button, and who to play against.
 *
 * One select rather than a second button, and the mirror is its first option:
 * facing your own list is the game a lone deck can always be given, and it is
 * what this button did before there was anything else to choose. An opponent is
 * a choice made beside the button rather than a different button, because it is
 * one gesture — play this deck, against that one.
 *
 * With nothing else on the shelf the select is not drawn at all. A control with
 * one option is a control that cannot be used, and drawing it would advertise a
 * choice the person does not have yet.
 */
function playControls(
  onPlay: (opponentId: string | null) => void,
  opponents: readonly { readonly id: string; readonly name: string }[],
): readonly ReactNode[] {
  // Held outside React state on purpose: this is one uncontrolled select read at
  // the moment the button is pressed, and a re-render per keystroke of a list
  // that cannot change would redraw the whole deck under it.
  let chosen: string | null = null;
  return [
    createElement(
      'button',
      {
        key: 'play',
        type: 'button',
        className: 'mtg-btn',
        'data-variant': 'primary',
        onClick: (): void => {
          onPlay(chosen);
        },
      },
      'Play this deck',
    ),
    ...(opponents.length === 0
      ? []
      : [
          createElement(
            'label',
            { key: 'against', className: 'mtg-workbench__opponent' },
            createElement('span', { className: 'mtg-workbench__opponent-label' }, 'against'),
            createElement(
              'select',
              {
                className: 'mtg-select',
                'aria-label': 'Opponent',
                defaultValue: '',
                onChange: (event: { target: { value: string } }): void => {
                  chosen = event.target.value === '' ? null : event.target.value;
                },
              },
              createElement('option', { key: 'mirror', value: '' }, 'A copy of this deck'),
              ...opponents.map((deck) =>
                createElement('option', { key: deck.id, value: deck.id }, deck.name),
              ),
            ),
          ),
        ]),
  ];
}

export interface VariationViewProps {
  readonly variation: Variation;
  /**
   * Offered under the deck when the page can hand it to a game.
   *
   * Takes the opponent it was asked for: `null` is the mirror `deal.ts` has
   * always dealt, and an id is another deck on the shelf.
   */
  readonly onPlay?: (opponentId: string | null) => void;
  /**
   * The other decks on the shelf, offered as opponents.
   *
   * The playtester asked to play the Alaric deck against the Vessari deck, and until this
   * there was nothing to ask with: a built deck could only face a copy of
   * itself. Handed down from the screen, which already holds the shelf, rather
   * than fetched here.
   */
  readonly opponents?: readonly { readonly id: string; readonly name: string }[];
  readonly onRebuild: () => void;
  readonly onDelete: () => void;
  /**
   * The build this one came from, when the shelf still holds it.
   *
   * Resolved by the screen rather than fetched here, for the reason the shelf
   * resolves it: a parent that is gone is worth saying, and a second request per
   * selection to learn a name the page already has is a request for nothing.
   */
  readonly parent?: { readonly id: string; readonly name: string };
  /** Opens the parent. Absent when there is no parent to open. */
  readonly onOpenParent?: (id: string) => void;
  /**
   * A refusal earned by one of these buttons, drawn beside them.
   *
   * The one that arrives is a deck that cannot be dealt because the staged sets
   * no longer hold cards it names. It is drawn here rather than in the other
   * column because that is where the button is: measured, the sentence used to
   * render about 331px below the fold of a separately scrolled column, 1158px
   * away from the control that earned it.
   */
  readonly refusal?: string;
}

export function VariationView(props: VariationViewProps): ReactElement {
  const { variation } = props;
  const statements = new Map(
    variation.statedCriteria.map((criterion) => [criterion.id, criterion.statement]),
  );
  const basicCount = variation.basics.reduce((sum, basic) => sum + basic.count, 0);
  // The header's own counter, not a second one. "38 spells" here and "29
  // creatures, 9 noncreature spells" in the builder over the same deck were two
  // surfaces of one lab disagreeing about the word "spells", which is the
  // contradiction `../deck-counts.ts` was written about. Basics carry no printed
  // type line and are counted where they belong.
  const counted = deckTypeCounts([...variation.spells, ...variation.lands]);
  const counts = { ...counted, lands: counted.lands + basicCount };
  const totalCards = counts.lands + counts.creatures + counts.other;

  return createElement(
    'div',
    { className: 'mtg-workbench__variation' },

    createElement(
      'div',
      { className: 'mtg-workbench__variation-head' },
      createElement('h2', { className: 'mtg-workbench__variation-name' }, variation.name),
      createElement(
        'p',
        { className: 'mtg-workbench__variation-meta' },
        `${String(totalCards)} cards · ${typeCountsLine(counts)} · ` +
          `${variation.criteria.sets.join(', ')} · chosen from ${String(variation.universeSize)} the criteria allow`,
      ),
      // The bill, and the ceiling it was authorized against. `mtg-yp33.7`. The
      // shelf row carries the first half; only this one answers whether there
      // was room left to keep going, which is what a person reads a ceiling for.
      variation.build === undefined
        ? null
        : createElement(
            'p',
            { className: 'mtg-workbench__variation-cost' },
            `$${variation.build.spentUsd.toFixed(2)} over ` +
              `${variation.build.rounds === 1 ? '1 round' : `${String(variation.build.rounds)} rounds`}, ` +
              `of a $${variation.build.maxSpendUsd.toFixed(2)} ceiling`,
          ),
      // The lineage, on the deck rather than only on the shelf row that opened
      // it. The whole argument for a shelf over a transcript is that "make it
      // cheaper" is a diff against a named predecessor, and a child variation's
      // own view said nothing about what it was a variation of.
      props.parent === undefined
        ? null
        : createElement(
            'p',
            { className: 'mtg-workbench__variation-meta' },
            'A variation of ',
            props.onOpenParent === undefined
              ? props.parent.name
              : createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'mtg-workbench__parent',
                    onClick: (): void => {
                      props.onOpenParent?.(props.parent?.id ?? '');
                    },
                  },
                  props.parent.name,
                ),
          ),
      createElement(
        'div',
        { className: 'mtg-workbench__variation-actions' },
        ...(props.onPlay === undefined ? [] : playControls(props.onPlay, props.opponents ?? [])),
        createElement(
          'button',
          { type: 'button', className: 'mtg-btn', onClick: props.onRebuild },
          'Change something and rebuild',
        ),
        createElement('button', { type: 'button', className: 'mtg-btn', onClick: props.onDelete }, 'Remove'),
      ),
      props.refusal === undefined
        ? null
        : createElement('p', { className: 'mtg-workbench__refusal' }, props.refusal),
    ),

    section(PLAN_LABEL, createElement('p', { className: 'mtg-workbench__plan' }, variation.plan)),

    variation.shortfalls.length === 0
      ? null
      : section(
          SHORTFALL_LABEL,
          createElement(
            'ul',
            { className: 'mtg-workbench__shortfalls' },
            variation.shortfalls.map((line, index) =>
              createElement('li', { key: `${String(index)}-${line}` }, line),
            ),
          ),
        ),

    section(
      PROVENANCE_LABEL,
      createElement(VariationDeck, { variation, statements }),
      variation.basics.length === 0
        ? null
        : createElement(
            'p',
            { className: 'mtg-workbench__basics' },
            // Basics cite nothing because nobody chose them: they are what the
            // land slot is filled with once the chosen cards are counted.
            `Plus ${variation.basics
              .map((basic) => `${String(basic.count)} ${basic.color}`)
              .join(', ')}, apportioned from the pip demand of the cards above.`,
          ),
    ),

    section(
      MANA_BASE_LABEL,
      createElement(
        'p',
        { className: 'mtg-workbench__plan' },
        `${String(variation.manaBase.totalLands)} lands, ` +
          `${variation.manaBase.landSource === 'stated' ? 'the count you stated' : 'decided for this deck'}: ` +
          variation.manaBase.landReason,
      ),
      createElement(
        'table',
        { className: 'mtg-workbench__mana' },
        createElement(
          'thead',
          null,
          createElement(
            'tr',
            null,
            ['color', 'pips', 'sources', 'needs', 'castable on curve'].map((head) =>
              createElement('th', { key: head }, head),
            ),
          ),
        ),
        createElement(
          'tbody',
          null,
          variation.manaBase.colors.map((color) =>
            createElement(
              'tr',
              { key: color.color, 'data-meets': color.meetsTarget ? 'true' : 'false' },
              createElement('td', null, color.color),
              createElement('td', null, color.pipCount.toFixed(1)),
              createElement('td', null, String(color.sources)),
              createElement('td', null, String(color.sourceFloor)),
              createElement('td', null, `${(color.castability * 100).toFixed(0)}%`),
            ),
          ),
        ),
      ),
    ),
  );
}
