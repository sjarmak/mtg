/**
 * The set icon: the printed set's own symbol, referenced rather than drawn.
 *
 * `./set-seal.ts` draws a mark for every set from its code, and that stays the
 * specification's seal: it is what a generated set carries, what the printed
 * SVG face draws, and what `packages/card-render/test/parity.test.ts` holds the
 * two faces to. the playtester, 2026-09-14: "pull in the set icon as part of the
 * frame so it isn't just the three letter text showing the rarity and has the
 * set symbol". An official set has a symbol of its own, and a card face that
 * spells its code in the seal's box reads as a proof rather than as the card.
 *
 * So an official set's icon resolves the way the mana symbols do in
 * `./symbols.ts`, under the same licensing argument: Scryfall's set SVGs are
 * Wizards' glyphs, so nothing in this tree ever holds a copy of one. A launcher
 * fetches the file once through `@mtg/image-cache` into the gitignored
 * `data/images/`, copies it into the equally gitignored `public/set-icons/`,
 * and the page references it from its own origin — the `local` arm of the
 * symbol registry, and nothing else. There is no `scryfall` arm for the web
 * face, for the reason `./symbols.ts` gives for `local` existing at all: a page
 * in front of a person may not depend on another host being reachable from
 * wherever that person sits.
 *
 * **Which sets have one is the launcher's decision, and it is a fact about the
 * set rather than about Scryfall.** A generated set has no icon anywhere, and
 * its code could collide with a real one — the flagship is `XMP`, and every
 * three letters are somebody's set sooner or later — so asking Scryfall "is
 * there an icon for this code" would hand a generated set a stranger's symbol,
 * which is the defect `./set-seal.ts` was written to end. `tools/stage-set-icons.ts`
 * therefore stages icons only for sets that state an official origin (a reduced
 * reference build, a printed-format catalog) and hands the page the list of
 * codes it actually served, through `MTG_SET_ICONS`, the way `MTG_SYMBOL_SET`
 * carries the symbol decision. A code not on that list draws its mark.
 *
 * **The rarity is still the ink.** A Scryfall set icon is one black glyph; the
 * rarity has been the color of the set symbol since Exodus, and `RARITY_SEAL_INK`
 * is what varies. The web face paints the glyph as a mask over the rarity's
 * token (`@mtg/ui`'s `styles/card.ts`), so the icon carries exactly what the
 * drawn mark carried: the set in the shape, the rarity in the color.
 */
import { SET_CODE_PATTERN } from '@mtg/dsl';

/** Where the referenced icons live. Referenced, never copied; see the docblock. */
export const SCRYFALL_SET_ICON_BASE = 'https://svgs.scryfall.io/sets/';

/**
 * The directory under `public/` a launcher stages the icons into, and
 * therefore also the URL prefix — the arrangement `SYMBOL_DIR` has.
 */
export const SET_ICON_DIR = 'set-icons';
export const LOCAL_SET_ICON_BASE = `${SET_ICON_DIR}/`;

/**
 * The file an icon is served as, from its set code.
 *
 * Uppercase, because that is how a code is spelled on a card and in every
 * registry this repository keeps, and one spelling is what lets the page derive
 * the href without a manifest. Scryfall's own path is lowercase; `setIconSourceUrl`
 * does that translation once.
 */
export function setIconAssetName(code: string): string {
  return `${code.toUpperCase()}.svg`;
}

/** The hosted file a launcher fetches for one set. */
export function setIconSourceUrl(code: string): string {
  return `${SCRYFALL_SET_ICON_BASE}${code.toLowerCase()}.svg`;
}

/**
 * The codes a launcher says it staged, from the comma-separated string it wrote.
 *
 * A malformed entry is dropped rather than refused, for the reason
 * `symbolSetFrom` lands unknown values on `original`: the only writer is a
 * launcher in this repository, and a page that refuses to start over a stray
 * comma is worse than a page that draws one set's mark instead of its icon.
 */
export function stagedSetIconsFrom(configured: string): ReadonlySet<string> {
  return new Set(
    configured
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter((code) => SET_CODE_PATTERN.test(code)),
  );
}

/**
 * The staged list as it reaches the browser bundle.
 *
 * Declared rather than imported for the reason `__MTG_SYMBOL_SET__` is in
 * `./symbols.ts`: it is a build-time substitution `vite.config.ts` defines
 * from `MTG_SET_ICONS`, and outside that bundle the identifier does not exist,
 * which `typeof` alone survives.
 */
declare const __MTG_SET_ICONS__: unknown;

/** The icons this page can paint with; empty unless a launcher staged some. */
export const STAGED_SET_ICONS: ReadonlySet<string> = stagedSetIconsFrom(
  typeof __MTG_SET_ICONS__ === 'string' ? __MTG_SET_ICONS__ : '',
);

/**
 * The served icon for a set, or `null` when the face should draw its mark.
 *
 * `null` rather than a fallback href: the drawn mark is a path the face emits
 * itself, not a file, and a caller that got an href for every code would have
 * to know which ones are real. Case-insensitive on the code, because a card's
 * `set.code` and a launcher's roster both come from the same registries but
 * nothing forces either to shout.
 */
export function setIconHref(code: string, staged: ReadonlySet<string> = STAGED_SET_ICONS): string | null {
  const upper = code.toUpperCase();
  return staged.has(upper) ? `${LOCAL_SET_ICON_BASE}${setIconAssetName(upper)}` : null;
}
