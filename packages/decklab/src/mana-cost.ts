/**
 * Scryfall's printed mana-cost string into structured color demand.
 *
 * This answers exactly one question: which colored sources does this card
 * force the deck to produce, and how insistently. It deliberately does **not**
 * compute mana value. The store already carries Scryfall's own `mana_value` for
 * every card, and a second, locally-derived total would be a competing source
 * of truth that silently disagrees on the strange cards — `{HW}` is half a
 * mana, `{D}` adds nothing to Boulder Jockey's cost of 3, `{1000000}` is a real
 * printed cost. Every one of those was a crash or a wrong answer while this
 * module tried to own mana value; none of them matter once it does not.
 *
 * Hybrid, Phyrexian and half pips are the cases that carry real information. A
 * hybrid pip `{W/U}` is payable with either color, so counting it as one pip
 * of each overstates demand for both and inflates the mana base; it is recorded
 * as a *choice* and resolved against the colors the deck actually plays.
 * Phyrexian `{W/P}` is payable with life, so it forces no source at all.
 * Getting these wrong does not fail loudly — it quietly produces a mana base
 * that is wrong for the deck.
 */
import type { Color, ManaCost } from '@mtg/dsl';
import { COLORS, ZERO_MANA_COST } from '@mtg/dsl';

const COLOR_SET: ReadonlySet<string> = new Set<string>(COLORS);

/** A pip payable by more than one color; the deck picks a side. */
export interface HybridPip {
  readonly options: readonly Color[];
  /** True when one side is generic or colorless, so no color is forced. */
  readonly hasColorlessOption: boolean;
}

export interface ParsedManaCost {
  /**
   * Pips that are unavoidably required. `generic` counts symbols that need no
   * specific color; it is not a mana value.
   */
  readonly fixed: ManaCost;
  /** Pips payable by any of several colors. */
  readonly hybrid: readonly HybridPip[];
  /** Pips payable with life instead of mana; they demand no source. */
  readonly phyrexian: readonly Color[];
  /** Half pips, as on the silver-bordered `{HW}`. */
  readonly half: Readonly<Record<Color, number>>;
  /** Symbols this parser did not recognize, kept visible rather than dropped. */
  readonly unrecognised: readonly string[];
}

const SYMBOL_PATTERN = /\{([^}]+)\}/g;

/**
 * Symbols that occupy a slot in the cost but force no colored source.
 *
 * `S` is snow, payable from any snow permanent; `C` is true colorless; `L`
 * and `D` are modern set-specific symbols that no basic land produces. All of
 * them are charged as generic for demand purposes, because a deck of basics
 * cannot aim a source at them.
 */
const COLOURLESS_SYMBOLS: ReadonlySet<string> = new Set(['S', 'C', 'L', 'D']);

/** Variable symbols, zero on the stack. */
const VARIABLE_SYMBOLS: ReadonlySet<string> = new Set(['X', 'Y', 'Z']);

const EMPTY_HALF: Readonly<Record<Color, number>> = { W: 0, U: 0, B: 0, R: 0, G: 0 };

/**
 * Parses a printed cost. `null` or `''` (lands, and the back faces of some
 * layouts) is a zero cost, not an error.
 *
 * Only the front face is read: for a split, adventure or modal card Scryfall
 * joins the faces with `//`, and a deck pays one side or the other, never both.
 *
 * An unrecognised symbol is recorded rather than thrown. A single silver-
 * bordered oddity must not take down a query spanning 38,623 cards, and since
 * mana value comes from the store, the worst case is one card's color demand
 * being understated.
 */
export function parseManaCost(cost: string | null): ParsedManaCost {
  if (cost === null || cost.trim() === '') {
    return { fixed: ZERO_MANA_COST, hybrid: [], phyrexian: [], half: EMPTY_HALF, unrecognised: [] };
  }

  const front = cost.split('//')[0] ?? cost;
  const fixed = { ...ZERO_MANA_COST };
  const hybrid: HybridPip[] = [];
  const phyrexian: Color[] = [];
  const half = { ...EMPTY_HALF };
  const unrecognised: string[] = [];

  for (const match of front.matchAll(SYMBOL_PATTERN)) {
    const symbol = (match[1] ?? '').toUpperCase();
    if (symbol === '') continue;

    if (VARIABLE_SYMBOLS.has(symbol)) continue;

    if (COLOURLESS_SYMBOLS.has(symbol)) {
      fixed.generic += 1;
      continue;
    }

    if (/^\d+$/.test(symbol)) {
      fixed.generic += Number.parseInt(symbol, 10);
      continue;
    }

    if (COLOR_SET.has(symbol)) {
      fixed[symbol as Color] += 1;
      continue;
    }

    // `{HW}`: half a white pip. Real, and only on silver-bordered cards.
    if (symbol.startsWith('H') && symbol.length === 2 && COLOR_SET.has(symbol.slice(1))) {
      half[symbol.slice(1) as Color] += 1;
      continue;
    }

    if (symbol.includes('/')) {
      const parts = symbol.split('/');
      const colors = parts.filter((part): part is Color => COLOR_SET.has(part));

      if (parts.includes('P')) {
        // Phyrexian, possibly hybrid-phyrexian like `{G/U/P}`. Either way it is
        // payable with life, so it forces nothing.
        phyrexian.push(...colors);
        continue;
      }

      if (colors.length === 0) {
        unrecognised.push(match[0]);
        fixed.generic += 1;
        continue;
      }

      hybrid.push({
        options: colors,
        hasColorlessOption: parts.some((part) => /^\d+$/.test(part) || COLOURLESS_SYMBOLS.has(part)),
      });
      continue;
    }

    unrecognised.push(match[0]);
  }

  return { fixed, hybrid, phyrexian, half, unrecognised };
}

/**
 * Resolves a parsed cost to concrete pip demand for a deck of known colors.
 *
 * A hybrid pip is assigned to whichever option the deck already plays; if it
 * plays several, the pip is split evenly, because the deck genuinely can pay it
 * from either and charging one color the whole pip skews the apportionment. A
 * hybrid with a colorless side forces nothing. Phyrexian pips contribute
 * nothing: they are payable with life.
 */
export function pipDemand(parsed: ParsedManaCost, deckColors: readonly Color[]): Record<Color, number> {
  const demand: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const color of COLORS) demand[color] = parsed.fixed[color] + parsed.half[color] * 0.5;

  for (const pip of parsed.hybrid) {
    if (pip.hasColorlessOption) continue;
    const payable = pip.options.filter((color) => deckColors.includes(color));
    const targets = payable.length > 0 ? payable : pip.options;
    for (const color of targets) demand[color] += 1 / targets.length;
  }
  return demand;
}

/** Colors a cost forces the deck to produce, ignoring life-payable pips. */
export function requiredColors(parsed: ParsedManaCost): readonly Color[] {
  return COLORS.filter((color) => parsed.fixed[color] > 0 || parsed.half[color] > 0);
}
