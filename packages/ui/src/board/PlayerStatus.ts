/**
 * Player status rail: life, the three zone counts, whose turn it is, and the
 * floating mana pool when there is one.
 *
 * Props only. This component never asks what a legal action would be; it prints
 * numbers the caller already has.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { PIP_GLYPHS } from '../card/anatomy';
import { pipGlyph, registryPip } from '../card/ManaPips';
import { DEFAULT_SYMBOL_SET } from '../card/symbols';
import type { SymbolSet } from '../card/symbols';
import { seatPossessive } from '../seat';
import type { ColorIdentity } from '../styles/tokens';

/** Mana pool shape, WUBRG plus colorless — structurally the kernel's `ManaPool`. */
export type ManaSymbol = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
export const MANA_SYMBOLS: readonly ManaSymbol[] = ['W', 'U', 'B', 'R', 'G', 'C'];
export type ManaPoolView = Readonly<Record<ManaSymbol, number>>;

/**
 * The pool's symbols are the DSL's identities, so a floating pip is drawn from
 * the same specification as a cost pip. Colorless is the one identity only a
 * pool can hold: a `ManaCost` has no way to state it.
 */
const PIP_KIND: Readonly<Record<ManaSymbol, Exclude<ColorIdentity, 'm'>>> = {
  W: 'w',
  U: 'u',
  B: 'b',
  R: 'r',
  G: 'g',
  C: 'c',
};

export interface PlayerStatusProps {
  /**
   * The seat's label. It is drawn as written and said as *theirs* in the strip's
   * accessible name (`../seat.ts`): a region called `You status` is what a
   * screen reader reads out, where a sighted player sees a name over a life
   * total and reads the relation off the layout.
   */
  readonly name: string;
  readonly life: number;
  readonly handCount: number;
  /** `null` means "this view cannot know" — a replay frame, say. Never guessed. */
  readonly libraryCount: number | null;
  readonly graveyardCount: number | null;
  /** True for the active player (whose turn it is). */
  readonly active?: boolean;
  /** True for the player currently holding priority. */
  readonly priority?: boolean;
  /** Life at or below which the number turns negative-toned. Default 5. */
  readonly lowLifeAt?: number;
  readonly mana?: ManaPoolView | null;
  /**
   * Which drawing the floating pips are painted with. A pool drawn from one set
   * beside a cost line drawn from another is the disagreement `mtg-bc2.45.5`
   * closed one layer up, when the pool spelled color letters and the face drew
   * symbols; a set is the same disagreement about which symbols.
   */
  readonly symbols?: SymbolSet;
}

function count(label: string, value: number | null): ReactElement {
  return createElement(
    'div',
    { key: label, className: 'mtg-status__count' },
    createElement(
      'span',
      { className: 'mtg-status__count-value', title: value === null ? 'not recorded' : label },
      value === null ? '—' : String(value),
    ),
    createElement('span', { className: 'mtg-status__count-label' }, label),
  );
}

/**
 * The floating pool, as pips.
 *
 * Exported because `./SeatPod.ts` draws the same pool in the other arrangement,
 * and a second copy of this would be a second answer to which drawing a floating
 * `{U}` gets — the disagreement `mtg-bc2.45.5` closed once already, one layer up.
 * The class name travels with it; a pod that wants the pips laid out differently
 * says so from its own block.
 */
export function poolPips(pool: ManaPoolView, symbols: SymbolSet): ReactElement | null {
  const pips = MANA_SYMBOLS.flatMap((symbol) =>
    Array.from({ length: Math.max(0, pool[symbol]) }, (_unused, index) => {
      const kind = PIP_KIND[symbol];
      // The lab's own outline is the floor: every mana letter is in the
      // registry, so this is reached only if a set ever stops stating one.
      return registryPip(`${symbol}${index}`, symbol, kind, symbols, pipGlyph(PIP_GLYPHS[kind]));
    }),
  );
  if (pips.length === 0) return null;
  return createElement(
    'span',
    { className: 'mtg-status__mana', role: 'img', 'aria-label': `Mana pool: ${pips.length} floating` },
    ...pips,
  );
}

export function PlayerStatus(props: PlayerStatusProps): ReactElement {
  const lowAt = props.lowLifeAt ?? 5;
  const pool = props.mana ?? null;
  const tags = [
    props.active === true ? createElement('span', { key: 'active', className: 'mtg-badge' }, 'Active') : null,
    props.priority === true
      ? createElement('span', { key: 'priority', className: 'mtg-badge' }, 'Priority')
      : null,
  ];
  return createElement(
    'div',
    {
      className: 'mtg-status',
      'data-active': props.active === true,
      'aria-label': `${seatPossessive(props.name)} status`,
    },
    createElement(
      'div',
      { className: 'mtg-status__who' },
      createElement('span', { className: 'mtg-status__name' }, props.name),
      createElement('span', { className: 'mtg-status__tags' }, ...tags),
    ),
    createElement(
      'span',
      { className: 'mtg-status__life', 'data-low': props.life <= lowAt, title: 'life total' },
      String(props.life),
    ),
    pool === null ? null : poolPips(pool, props.symbols ?? DEFAULT_SYMBOL_SET),
    createElement(
      'div',
      { className: 'mtg-status__counts' },
      count('hand', props.handCount),
      count('library', props.libraryCount),
      count('graveyard', props.graveyardCount),
    ),
  );
}
