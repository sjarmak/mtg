/**
 * The command zone: a seat's commander, drawn beside its battlefield, with the
 * ledger a Commander player keeps in their head (CR 903.8).
 *
 * A commander may be cast from this zone, and each cast after the first costs
 * `{2}` more than the last. The engine owns that count (`SeatView.commanderCasts`),
 * so what is drawn here is read rather than counted: `casts` is how many times
 * the engine says this commander has been cast from here, and `cost` is what
 * the next cast asks for, tax folded in. A card that has left the zone still
 * has a ledger, so the entry is what carries it and the zone draws its empty
 * sentence when the commander is on the table or in the graveyard.
 *
 * The card itself is the hand's contract restated: a `CardSlot` that is a
 * button when the caller says the engine offers a cast and inert otherwise,
 * with the same three gestures a held card answers. `../styles/board/command.ts`
 * places the panel on the right-hand side of the battlefield.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { CardSlot } from './CardSlot';
import type { HandCard } from './Hand';
import { Zone } from './Zone';
import { symbolizeLine } from '../card/SymbolText';

export interface CommanderCard extends HandCard {
  /** How many times the engine has seen this commander cast from the command zone. */
  readonly casts: number;
  /** The next cast's whole cost, commander tax included; null for a card with no cost. */
  readonly cost: string | null;
}

export interface CommandZoneProps {
  readonly label: string;
  readonly commanders: readonly CommanderCard[];
  readonly selectedKey?: string;
  readonly onSelect?: (card: CommanderCard) => void;
  readonly onActivate?: (card: CommanderCard) => void;
  readonly onMenu?: (card: CommanderCard) => void;
  readonly pickerFor?: (key: string, name: string) => ReactNode;
  readonly pointed?: ReadonlySet<string>;
  /**
   * Casts the engine has counted across every commander of this seat, read
   * while the zone is empty: the card is on the table or in the graveyard, and
   * the tax it will owe on the way back is still a fact about this seat.
   */
  readonly tally?: number;
}

/** What the ledger under the card says about the tax already owed. */
export function commanderTaxText(casts: number): string {
  if (casts === 0) return 'not yet cast';
  return `cast ${String(casts)}× · tax {${String(2 * casts)}}`;
}

function ledger(entry: CommanderCard): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-command__ledger', 'data-casts': String(entry.casts) },
    createElement(
      'span',
      { className: 'mtg-command__casts' },
      ...symbolizeLine(commanderTaxText(entry.casts)),
    ),
    entry.cost === null
      ? null
      : createElement(
          'span',
          { className: 'mtg-command__cost', 'aria-label': `Next cast costs ${entry.cost}` },
          'next ',
          ...symbolizeLine(entry.cost),
        ),
  );
}

function commander(props: CommandZoneProps, entry: CommanderCard): ReactElement {
  const inert = entry.playable !== true;
  const onSelect = inert ? undefined : props.onSelect;
  const onActivate = inert ? undefined : props.onActivate;
  const onMenu = inert ? undefined : props.onMenu;
  const picker = props.pickerFor?.(entry.key, entry.card.name) ?? null;
  return createElement(
    'div',
    { key: entry.key, className: 'mtg-command__entry' },
    createElement(CardSlot, {
      kind: 'hand',
      card: entry.card,
      art: entry.art ?? null,
      selected: props.selectedKey === entry.key,
      permanentKey: entry.key,
      ...(props.pointed?.has(entry.key) === true ? { pointed: true } : {}),
      ...(picker === null ? {} : { picker }),
      ...(onSelect === undefined ? {} : { onSelect: (): void => onSelect(entry) }),
      ...(onActivate === undefined ? {} : { onActivate: (): void => onActivate(entry) }),
      ...(onMenu === undefined ? {} : { onMenu: (): void => onMenu(entry) }),
    }),
    ledger(entry),
  );
}

export function CommandZone(props: CommandZoneProps): ReactElement {
  return createElement(
    'div',
    { className: 'mtg-command' },
    createElement(Zone, {
      label: props.label,
      items: props.commanders.map((entry) => commander(props, entry)),
      tone: 'rail',
      emptyText:
        props.tally === undefined || props.tally === 0
          ? 'commander in play'
          : `commander in play · ${commanderTaxText(props.tally)}`,
    }),
  );
}
