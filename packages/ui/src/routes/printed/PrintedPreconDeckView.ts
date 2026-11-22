/**
 * A printed preconstructed deck, read the way every other deck in the lab is.
 *
 * `mtg-r9vgk`. This route drew its own list -- a heading per card type and a
 * `4× Name` line under it -- directly beneath the deck picker, so the Commander
 * page was the one page in the lab where opening a deck meant scrolling past it
 * rather than opening it, and the one place a deck was organized by type
 * heading instead of by curve. `../deck/PreconDeckScreen.ts` settled that
 * argument for a written deck from a generated set (`mtg-pmpu.1`): a deck is a
 * `DeckPane` over `../deck/StripColumns.ts`, whichever universe its cards come
 * from. This is that pane with printed catalog rows as its members.
 *
 * It is a second component rather than a mode of `PreconDeckView` because the
 * members are `PrintedCardCatalogEntry` rows and not DSL cards -- the same
 * reason `../deck/OpenDeckScreen.ts` is separate from that screen -- and every
 * fact the columns need is read off the row here rather than derived twice.
 */
import { createElement as h, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { PrintedCardCatalogEntry, PrintedConstructedDeck } from '@mtg/printed-card';
import { PrintedCardFace } from '../../card/PrintedCardFace';
import type { PrintedCardPresentation } from '../../card/printed-card-art';
import { DeckPane, PANE_CARD_VIEWS, usePaneControls } from '../deck/DeckPane';
import { StripColumns } from '../deck/StripColumns';
import type { StripFaceGestures } from '../deck/StripColumns';
import { CLEAR_SELECTION_LABEL } from '../deck/ConstructedBuilder';
import { counted, deckCountsLine } from '../deck/DeckCard';
import { groupMembers } from '../deck/grouping';
import type { Strip } from '../deck/strips';
import { stripLabel } from '../deck/strips';
import { cardDensity } from '../deck/view-mode';
import { MAIN_DECK_LABEL } from '../deck/pane-names';
import { useStoredCollapse } from '../play/collapse-preference';
import { useDismissable } from '../play/dismiss';

export const COMMANDER_CARD_KEY = 'mtg.play.commander-card';

/**
 * A catalog row as every other printed surface presents it.
 *
 * The raw `PrintedCardCatalogEntry` carries neither the set it came from nor the
 * rarity sheet it came off, and the printed card face draws the set seal and the
 * rarity seal from exactly those two fields. So this view took the same list
 * `../play/SealedBuilder.ts` and `./PrintedPoolEditor.ts` take -- the route's
 * `printedCardsOf(catalogs, rarities)` -- rather than the bare catalog map it
 * started with, which drew every card in the deck under a sealless frame while
 * the draft builder two tabs away drew the same card correctly.
 */
export type PreconPrinting = PrintedCardCatalogEntry & Pick<PrintedCardPresentation, 'setCode' | 'rarity'>;

/** A slot of the written deck, paired with the printing the catalog holds for it. */
interface PreconPrintedEntry {
  readonly entry: PreconPrinting;
  readonly count: number;
  readonly slotName: string;
}

/** The name a deck's card list region answers to, here and in the tests that open it. */
export function preconListLabel(deck: PrintedConstructedDeck): string {
  return `${deck.name} list`;
}

/** The button that opens this view, named for the deck it opens. */
export function viewDeckLabel(deck: PrintedConstructedDeck): string {
  return `View ${deck.name}`;
}

function entriesOf(
  deck: PrintedConstructedDeck,
  printings: ReadonlyMap<string, PreconPrinting>,
): readonly PreconPrintedEntry[] {
  return deck.cards.flatMap((slot) => {
    const entry = printings.get(slot.physicalId);
    return entry === undefined ? [] : [{ entry, count: slot.count, slotName: slot.name }];
  });
}

/**
 * The whole card over the columns, for the reason the written deck's bar exists:
 * somebody clicked a 26px name and the answer is the card.
 */
function SelectionBar(props: {
  readonly strip: Strip<PreconPrintedEntry>;
  readonly onClear: () => void;
}): ReactElement {
  const { entry, count } = props.strip.member;
  return h(
    'div',
    { className: 'mtg-deck__selection-backdrop' },
    h(
      'div',
      {
        className: 'mtg-deck__selection mtg-deck__selection-overlay',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': `Selected: ${stripLabel(props.strip)}`,
      },
      h('span', { className: 'mtg-deck__selection-name' }, stripLabel(props.strip)),
      h(
        'button',
        { type: 'button', className: 'mtg-btn', autoFocus: true, onClick: props.onClear },
        CLEAR_SELECTION_LABEL,
      ),
      h(PrintedCardFace, {
        card: entry,
        size: 'full',
        footnote: `${String(count)} ${count === 1 ? 'copy' : 'copies'}`,
      }),
    ),
  );
}

export interface PrintedPreconDeckViewProps {
  readonly deck: PrintedConstructedDeck;
  /** Every printing the format ships, seals and all; see `PreconPrinting`. */
  readonly printings: readonly PreconPrinting[];
}

export function PrintedPreconDeckView(props: PrintedPreconDeckViewProps): ReactElement {
  const controls = usePaneControls(`printed-precon-${props.deck.id}`, undefined, PANE_CARD_VIEWS);
  const view = controls.view;
  const [selected, setSelected] = useState<Strip<PreconPrintedEntry> | null>(null);
  const commander = useStoredCollapse(COMMANDER_CARD_KEY, false);
  const commanderId = `mtg-printed-precon-commanders-${props.deck.id}`;
  useDismissable({
    open: selected !== null,
    within: () => null,
    outside: false,
    onDismiss: () => {
      setSelected(null);
    },
  });
  const printings = useMemo(
    () => new Map(props.printings.map((card) => [card.physicalId, card])),
    [props.printings],
  );
  const entries = entriesOf(props.deck, printings);
  const cards = entries.reduce((sum, member) => sum + member.count, 0);
  const isLand = (member: PreconPrintedEntry): boolean =>
    (member.entry.typeLine.split('—')[0] ?? '').split(/\s+/).includes('Land');
  const isCreature = (member: PreconPrintedEntry): boolean =>
    (member.entry.typeLine.split('—')[0] ?? '').split(/\s+/).includes('Creature');
  const count = (predicate: (member: PreconPrintedEntry) => boolean): number =>
    entries.filter(predicate).reduce((sum, member) => sum + member.count, 0);
  const lands = count(isLand);
  const creatures = count(isCreature);
  const groups = groupMembers(
    entries,
    (member) => ({
      name: member.entry.name,
      manaValue: member.entry.manaValue,
      colorIdentity: member.entry.colorIdentity.join(''),
      typeLine: member.entry.typeLine,
      rarity: member.entry.rarity ?? null,
    }),
    (member) => member.count,
    controls.grouping.grouping,
  );
  return h(
    'div',
    { className: 'mtg-deck' },
    h(
      'section',
      { className: 'mtg-printed-precon-deck', 'aria-label': preconListLabel(props.deck) },
      h(
        'div',
        { className: 'mtg-printed-precon-commanders-head' },
        h('span', { className: 'mtg-printed-precon-commander__label' }, 'Commander'),
        h(
          'button',
          {
            type: 'button',
            className: 'mtg-btn',
            'aria-expanded': !commander.collapsed,
            'aria-controls': commanderId,
            onClick: commander.toggle,
          },
          commander.collapsed ? 'Show commander' : 'Hide commander',
        ),
      ),
      commander.collapsed
        ? null
        : h(
            'div',
            { id: commanderId, className: 'mtg-printed-precon-commanders' },
            props.deck.commanders.flatMap((slot) => {
              const entry = printings.get(slot.physicalId);
              if (entry === undefined) return [];
              return [
                h(
                  'div',
                  { key: slot.physicalId, className: 'mtg-printed-precon-commander' },
                  h(PrintedCardFace, {
                    card: entry,
                    size: 'full',
                    deferArt: true,
                  }),
                ),
              ];
            }),
          ),
      h(
        DeckPane,
        {
          kind: 'deck',
          label: MAIN_DECK_LABEL,
          title: `${MAIN_DECK_LABEL}: ${String(cards)}`,
          note: deckCountsLine([
            counted(creatures, 'creature'),
            counted(cards - creatures - lands, 'noncreature spell'),
            counted(lands, 'land'),
          ]),
          controls,
        },
        h(StripColumns<PreconPrintedEntry>, {
          groups,
          factsOf: (member: PreconPrintedEntry) => ({
            key: member.entry.physicalId,
            name: member.slotName,
            manaCost: member.entry.manaCost,
            colorIdentity: member.entry.colorIdentity.join(''),
            copies: member.count,
          }),
          density: cardDensity(view.mode),
          ...(selected === null ? {} : { selectedKey: selected.key }),
          onSelect: setSelected,
          label: `${props.deck.name} cards`,
          renderFace: (member: PreconPrintedEntry, gestures: StripFaceGestures) =>
            h(PrintedCardFace, {
              card: member.entry,
              size: 'full',
              deferArt: true,
              selected: gestures.selected,
              footnote: `${String(member.count)} ${member.count === 1 ? 'copy' : 'copies'}`,
              onSelect: gestures.onSelect,
            }),
        }),
      ),
      selected === null
        ? null
        : h(SelectionBar, {
            strip: selected,
            onClear: () => {
              setSelected(null);
            },
          }),
    ),
  );
}
