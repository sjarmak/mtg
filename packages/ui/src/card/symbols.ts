/**
 * The glyph registry: a brace token to the artwork that paints it.
 *
 * `@mtg/dsl` prints a cost as a brace token — `{T}`, `{1}{R}`, `Equip {2}` —
 * and both faces used to hand that line to a text run, so the braces printed
 * literally. Substituting them is what this module is for; *which drawing* they
 * are substituted with is the reason it is a registry rather than an import.
 *
 * **The licensing layer, which is subtler than it looks.** The obvious source is
 * the Mana font (`andrewgioia/mana`, SIL OFL 1.1) or Scryfall's symbol SVGs, and
 * both are dead ends for the same reason: `andrewgioia/mana`'s own README
 * disclaims the glyph *designs* as Wizards' copyright, and Scryfall says the
 * same of its SVGs. A font license covers the file; it grants nothing about what
 * the glyph depicts. `docs/research/prior-art-data-sources.md` §5.4 records the
 * CardConjurer cease-and-desist of 2022-11-03, whose leading item was the mana
 * symbols.
 *
 * So the artwork resolves through a named set and nothing in this repository
 * ever holds a copy of it:
 *
 *  * `scryfall` **references** Scryfall's hosted SVG by URL. Nothing is
 *    downloaded, vendored, traced or redistributed by this tree; a viewer's
 *    browser fetches the same file it would fetch looking at Scryfall.
 *  * `local` references the *same file*, fetched once by a launcher and served
 *    from this origin — `symbols/{T}.svg` beside the page rather than
 *    `svgs.scryfall.io`. Still nothing in git: `tools/stage-symbols.ts` pulls
 *    them through `@mtg/image-cache` into the gitignored `data/images/` and
 *    copies them into the equally gitignored `public/symbols/`, the same
 *    fetch-once-stage-locally path `tools/stage-art.ts` puts a card's
 *    illustration through.
 *  * `original` is the lab's own drawing — the six shapes `anatomy.ts` already
 *    draws on the categories each color has always used, plus a lettered disc
 *    for the tap symbol, for `{X}` and for a generic amount. It holds no
 *    third-party artwork at all, which is what makes it the set an artifact
 *    leaving this machine is published with (`tools/render-set.ts --symbols`).
 *
 * **Why `local` exists.** `scryfall` was the default for both faces, and on the
 * web face that broke a promise the lab had already made in two other places:
 * `npm run play` needs no network, and `npm run lab` stages a deck's art
 * locally "so the page never reaches another host while you are looking at it".
 * A viewer behind a DNS filter or on the far end of a tunnel got one empty box
 * per symbol. Referencing another host is fine for a file that names it
 * outright; it is not fine for the page in front of a person.
 *
 * **Which set each face defaults to.** The two are no longer one constant, and
 * the split is the point rather than a convenience:
 *
 *  * `PRINTED_SYMBOL_SET` is `scryfall`, unchanged. A printed SVG leaves this
 *    machine, so a relative `symbols/T.svg` would resolve against wherever it
 *    was opened. Print either names the host or draws its own, and
 *    `--symbols original` remains the publish choice.
 *  * `DEFAULT_SYMBOL_SET` is what the web face paints with, and it is
 *    `original` unless a launcher says it staged the local copies. Not `local`:
 *    a bare `vite dev`, a `vitest` run and a first launch with no network have
 *    staged nothing, and defaulting to files that are not there is the empty
 *    box again with a different href. So the safe set is the floor and the
 *    launcher raises it, never the other way round.
 *
 * ADR-0002's parity is untouched by the split. `scryfall` and `local` are the
 * same drawing at two addresses, so the card on screen and the card on paper
 * still come from one registry entry; only the origin serving it differs.
 */
import { PIP_GLYPHS } from './anatomy';
import type { PipGlyph } from './anatomy';
import type { ColorIdentity } from '../styles/tokens';

/** Which drawing a face paints its symbols with. */
export type SymbolSet = 'scryfall' | 'local' | 'original';

export const SYMBOL_SETS: readonly SymbolSet[] = ['scryfall', 'local', 'original'];

/**
 * What a printed file references unless it is told otherwise. See the module
 * docblock: a file that leaves this machine cannot carry a relative href, and
 * `original` is the explicit publish choice rather than the default.
 */
export const PRINTED_SYMBOL_SET: SymbolSet = 'scryfall';

/**
 * The set a launcher staged, as it reaches the browser bundle.
 *
 * Declared rather than imported because it is a build-time substitution:
 * `vite.config.ts` defines it from `MTG_SYMBOL_SET`, which `tools/play.ts` and
 * `tools/lab.ts` set to whatever their staging run actually achieved. Outside
 * that bundle — a `vitest` run, `@mtg/card-render` under `tsx` — the identifier
 * does not exist at all, which is why it is read through `typeof` and typed
 * `unknown`: `typeof` is the one operator an undeclared name survives.
 */
declare const __MTG_SYMBOL_SET__: unknown;

/**
 * The set a configured name asks for, or the drawn set.
 *
 * Every unrecognized value lands on `original` rather than throwing, because
 * the only caller is a build-time string this repository writes and a page that
 * refuses to start is worse than a page drawn with the lab's own symbols. A
 * launcher that could not stage passes `original` outright and says so on
 * stdout; this is the floor under that.
 */
export function symbolSetFrom(configured: string): SymbolSet {
  return (SYMBOL_SETS as readonly string[]).includes(configured) ? (configured as SymbolSet) : 'original';
}

/** What the web face paints with unless it is told otherwise; see the docblock. */
export const DEFAULT_SYMBOL_SET: SymbolSet = symbolSetFrom(
  typeof __MTG_SYMBOL_SET__ === 'string' ? __MTG_SYMBOL_SET__ : '',
);

/** Largest generic amount the registry states a symbol for. */
export const MAX_GENERIC_SYMBOL = 20;

/**
 * How a symbol occupies a line, as multiples of the font size, from Scryfall's
 * shipped stylesheet.
 *
 * Declared here rather than in either renderer because both need all four and
 * they must agree: the web sheet writes them into CSS (`../styles/symbols.ts`)
 * and the printed sheet measures line breaks with them and then draws the box
 * it measured (`@mtg/card-render`'s `text/symbols.ts`). A printed face that
 * measured a symbol at one width and drew it at another would overflow its
 * rules box while reporting a clean fit, which is the one failure that package
 * exists to prevent.
 *
 * The advance is the box plus both margins, so two adjacent symbols stand
 * `SYMBOL_MARGIN_EM * 2` apart. `SYMBOL_DROP_EM` is how far the box's bottom
 * edge sits below the baseline; the glyph box is 0.8 ascent over 0.26 descent,
 * so a 0.94em square dropped 0.0625em needs no change of line height.
 */
export const SYMBOL_BOX_EM: number = 0.94;
export const SYMBOL_MARGIN_EM: number = 0.0625;
export const SYMBOL_DROP_EM: number = 0.0625;
export const SYMBOL_ADVANCE_EM: number = SYMBOL_BOX_EM + SYMBOL_MARGIN_EM * 2;

/** The one mana letter with no color: colorless mana, drawn as a cut stone. */
const COLORLESS_TOKEN = 'C';

const COLOR_TOKENS: readonly string[] = ['W', 'U', 'B', 'R', 'G', COLORLESS_TOKEN];

/** Every token both sets are total over: the mana letters, `{X}`, `{T}`, `{0}`..`{20}`. */
export const SYMBOL_TOKENS: readonly string[] = [
  ...COLOR_TOKENS,
  'X',
  'T',
  ...Array.from({ length: MAX_GENERIC_SYMBOL + 1 }, (_, amount) => String(amount)),
];

/** A stretch of printed text with no symbol in it. */
export interface OracleTextChunk {
  readonly kind: 'text';
  readonly text: string;
}

/** One brace token: the letters inside the braces, and the braces as printed. */
export interface OracleSymbolChunk {
  readonly kind: 'symbol';
  readonly token: string;
  readonly text: string;
}

export type OracleChunk = OracleTextChunk | OracleSymbolChunk;

const TOKEN_PATTERN = /\{([^{}]*)\}/g;

/**
 * A printed line, split into the runs a face draws separately.
 *
 * A brace group the registry does not state stays *text*, and deliberately: a
 * card carrying a token this lab has never heard of prints the token rather
 * than a blank or a guess, and the renderers need no second failure path for
 * it. Both faces are then only as symbolized as the registry is total, which is
 * a fact a test can hold (`SYMBOL_TOKENS`).
 */
export function oracleChunks(line: string): readonly OracleChunk[] {
  const chunks: OracleChunk[] = [];
  let cursor = 0;
  let pending = '';
  TOKEN_PATTERN.lastIndex = 0;
  for (let match = TOKEN_PATTERN.exec(line); match !== null; match = TOKEN_PATTERN.exec(line)) {
    const token = match[1] ?? '';
    const before = line.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    if (!isKnownToken(token)) {
      pending += `${before}${match[0]}`;
      continue;
    }
    const text = `${pending}${before}`;
    pending = '';
    if (text.length > 0) chunks.push({ kind: 'text', text });
    chunks.push({ kind: 'symbol', token, text: match[0] });
  }
  const tail = `${pending}${line.slice(cursor)}`;
  if (tail.length > 0) chunks.push({ kind: 'text', text: tail });
  return chunks;
}

function isKnownToken(token: string): boolean {
  return SYMBOL_TOKENS.includes(token);
}

/**
 * What one symbol is drawn as.
 *
 * `image` is a reference to a file this tree does not hold; `drawn` and
 * `lettered` are the lab's own shapes, and both carry the identity the disc
 * behind them is painted from, so neither renderer names a color.
 */
export type SymbolArt =
  | { readonly kind: 'image'; readonly href: string }
  | { readonly kind: 'drawn'; readonly glyph: PipGlyph; readonly identity: ColorIdentity }
  | { readonly kind: 'lettered'; readonly text: string; readonly identity: 'generic' };

/** Where the referenced set lives. Referenced, never copied; see the docblock. */
export const SCRYFALL_SYMBOL_BASE = 'https://svgs.scryfall.io/card-symbols/';

/**
 * The directory under `public/` a launcher stages the local set into, and
 * therefore also the URL prefix — the arrangement `ART_DIR` already has.
 *
 * Named here rather than beside the staging tool because the registry is what
 * turns a token into an href, and a served file whose name the page cannot
 * derive would need a manifest. Naming each file for its token is what keeps
 * `symbolArt` a pure function of the token.
 */
export const SYMBOL_DIR = 'symbols';
export const LOCAL_SYMBOL_BASE = `${SYMBOL_DIR}/`;

const DRAWN_BY_TOKEN: Readonly<
  Record<string, { readonly glyph: PipGlyph; readonly identity: ColorIdentity }>
> = {
  W: { glyph: PIP_GLYPHS.w, identity: 'w' },
  U: { glyph: PIP_GLYPHS.u, identity: 'u' },
  B: { glyph: PIP_GLYPHS.b, identity: 'b' },
  R: { glyph: PIP_GLYPHS.r, identity: 'r' },
  G: { glyph: PIP_GLYPHS.g, identity: 'g' },
  C: { glyph: PIP_GLYPHS.c, identity: 'c' },
};

/**
 * The artwork for one token in one set, or `null` for a token no set states.
 *
 * `null` rather than a throw or a placeholder: `oracleChunks` never hands an
 * unknown token here, so a `null` is a caller asking about something outside the
 * vocabulary rather than a card that failed to draw.
 */
export function symbolArt(token: string, set: SymbolSet): SymbolArt | null {
  if (!isKnownToken(token)) return null;
  if (set === 'scryfall') return { kind: 'image', href: `${SCRYFALL_SYMBOL_BASE}${token}.svg` };
  if (set === 'local') return { kind: 'image', href: `${LOCAL_SYMBOL_BASE}${token}.svg` };
  const drawn = DRAWN_BY_TOKEN[token];
  if (drawn !== undefined) return { kind: 'drawn', glyph: drawn.glyph, identity: drawn.identity };
  return { kind: 'lettered', text: token, identity: 'generic' };
}

const COLOR_NAMES: Readonly<Record<string, string>> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  C: 'colorless',
};

/**
 * What a symbol is called when it is described rather than drawn: the `title`
 * of the abbreviation on the web face, and the `<title>` of the printed group.
 * The token itself stays the element's own text, so this is a gloss and never
 * the only copy of what the card says.
 */
export function symbolLabel(token: string): string | null {
  if (!isKnownToken(token)) return null;
  const color = COLOR_NAMES[token];
  if (color !== undefined) return `one ${color} mana`;
  if (token === 'T') return 'tap this permanent';
  if (token === 'X') return 'X generic mana';
  return `${token} generic mana`;
}
