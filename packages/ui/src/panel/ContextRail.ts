/**
 * The contextual rail: a strip of sections beside the thing being worked on,
 * one of them showing, and an action pinned under them.
 *
 * `mtg-aqxi.2`. Three surfaces in this lab were about to grow the same furniture
 * independently — the played table wants STACK / CARD / LOG beside the board,
 * the draft wants the chosen card and the pool beside the pack, and deckbuilding
 * wants the pool and a card's detail beside the deck. Written three times that
 * is three keyboard stories, three sets of ids and three answers to what happens
 * when a section is empty. Written once it is this file.
 *
 * # Why buttons and not `role="tab"`
 *
 * ARIA's tab pattern is not a look, it is a contract: a tablist owns roving
 * focus, arrow keys move between tabs, Home and End jump, and the panel is
 * reachable from the selected tab. A component that paints tabs and implements
 * none of that is worse for a screen reader than plain buttons, because the
 * reader announces "tab 2 of 3" and then the arrow keys do nothing.
 *
 * So these are buttons with `aria-pressed`, which is what this codebase already
 * uses for a segmented control (`../app/Shell.ts`'s mode switch, the deck tab's
 * density control), each naming the region it shows with `aria-controls`. Tab
 * reaches them one at a time, Space and Enter press them, and nothing lies about
 * what a key will do. If a full tablist is ever wanted, it wants the focus
 * management with it, and that is a change in one file rather than three.
 *
 * # Empty sections stay reachable
 *
 * A section with nothing in it draws its own sentence rather than disappearing.
 * A control that vanishes when its subject is empty moves every control beside
 * it, and on a phone that means the button under your thumb is not the button
 * you looked at. The count beside the name is how emptiness is reported.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';

export interface RailSection {
  /** The word on the control, and the accessible name of the region it shows. */
  readonly name: string;
  /** How many things are in it, drawn beside the name. Omitted draws nothing. */
  readonly count?: number | undefined;
  /** What the region holds. `null` draws `empty` instead. */
  readonly render: () => ReactNode;
  /** The sentence an empty section says about itself. */
  readonly empty?: string | undefined;
}

export interface ContextRailProps {
  /** Names the whole rail, e.g. "Draft context". */
  readonly label: string;
  readonly sections: readonly RailSection[];
  /** Which section's name is showing. An unknown name shows the first section. */
  readonly active: string;
  readonly onSelect: (name: string) => void;
  /**
   * The action pinned to the foot, below the scrolling region.
   *
   * Pinned rather than placed in the section, because the one action a rail
   * carries is the commit — `Pick Windrider Drake`, `Pass` — and a commit that
   * scrolls out of reach is a commit that gets missed. §11 of the brief calls
   * this out by name: regions scroll, primary controls stay anchored.
   */
  readonly foot?: ReactNode;
  /** Extra classes on the root, for a surface that positions its own rail. */
  readonly className?: string | undefined;
  /**
   * A control drawn above the sections, in both states: the disclosure that
   * shuts the rail. It is the first child whether the rail is open or shut, so
   * the button a person pressed is the button that is still under their focus
   * after the press.
   */
  readonly head?: ReactNode;
  /**
   * Shut: the head is drawn and nothing else is. The foot goes with the
   * sections, so a caller whose foot carries a commit has to draw that commit
   * somewhere else while the rail is shut (`../routes/draft/DraftPack.ts` does).
   */
  readonly collapsed?: boolean | undefined;
}

/** A stable, collision-resistant id fragment for one rail on one page. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function control(
  props: ContextRailProps,
  section: RailSection,
  showing: boolean,
  railId: string,
): ReactElement {
  return createElement(
    'button',
    {
      key: section.name,
      type: 'button',
      className: 'mtg-rail__tab',
      'aria-pressed': showing,
      'aria-controls': `${railId}-body`,
      onClick: (): void => {
        props.onSelect(section.name);
      },
    },
    createElement('span', { className: 'mtg-rail__tab-name' }, section.name),
    section.count === undefined
      ? null
      : createElement('span', { className: 'mtg-rail__tab-count' }, String(section.count)),
  );
}

export function ContextRail(props: ContextRailProps): ReactElement {
  const first = props.sections[0];
  if (first === undefined) throw new Error('ContextRail: a rail with no sections has nothing to show');
  const showing = props.sections.find((section) => section.name === props.active) ?? first;
  const railId = `mtg-rail-${slug(props.label)}`;
  const collapsed = props.collapsed === true;
  const body = collapsed ? null : showing.render();
  return createElement(
    'section',
    {
      className: props.className === undefined ? 'mtg-rail' : `mtg-rail ${props.className}`,
      'aria-label': props.label,
      ...(collapsed ? { 'data-collapsed': 'true' } : {}),
    },
    props.head === undefined ? null : createElement('div', { className: 'mtg-rail__head' }, props.head),
    collapsed
      ? null
      : createElement(
          'div',
          { className: 'mtg-rail__tabs', role: 'group', 'aria-label': `${props.label} sections` },
          ...props.sections.map((section) => control(props, section, section === showing, railId)),
        ),
    collapsed
      ? null
      : createElement(
          'div',
          {
            className: 'mtg-rail__body',
            id: `${railId}-body`,
            role: 'group',
            'aria-label': showing.name,
          },
          body ?? createElement('p', { className: 'mtg-rail__empty' }, showing.empty ?? 'Nothing here yet.'),
        ),
    collapsed || props.foot === undefined
      ? null
      : createElement('div', { className: 'mtg-rail__foot' }, props.foot),
  );
}
