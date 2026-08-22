/**
 * Forge file- and script-naming conventions, reproduced from the shipped
 * 2.0.14 resources rather than guessed:
 *
 * - card scripts: `Lightning Bolt` -> `lightning_bolt.txt`, `Aang's Defense`
 *   -> `aangs_defense.txt` (lowercase, punctuation dropped, spaces to `_`);
 * - token scripts: `w_2_2_knight_vigilance`, `g_2_2_bear`, `bg_2_2_elf`
 *   (color letters, power, toughness, subtype words, then keywords);
 * - noncreature token scripts: `c_a_treasure`, `c_a_clue` — the same grammar
 *   with `a` for the artifact type where a creature writes its two numbers.
 *   A bodiless token is named after itself rather than its subtype; see
 *   `tokenIdentityParts` for why.
 *
 * File names are cosmetic to Forge — it reads the `Name:` line — but matching
 * the convention keeps an exported set diffable against the real corpus.
 */
import type { Color, Keyword, TokenSpec } from '@mtg/dsl';
import { isCreatureTokenSpec, KEYWORD_PRINT_NAMES, sortColors, sortKeywords } from '@mtg/dsl';

/** Lowercase, drop everything but letters/digits/spaces, spaces to `_`. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

/** `Lightning Bolt` -> `lightning_bolt.txt`. Empty when the name has no word characters. */
export function forgeCardFileName(cardName: string): string {
  const slug = slugify(cardName);
  return slug.length === 0 ? '' : `${slug}.txt`;
}

/** Color prefix of a token script: `w`, `bg`, or `c` when colorless. */
export function tokenColorPrefix(colors: readonly Color[]): string {
  if (colors.length === 0) return 'c';
  return sortColors(colors)
    .map((color) => color.toLowerCase())
    .join('');
}

function keywordSlug(keyword: Keyword): string {
  return slugify(KEYWORD_PRINT_NAMES[keyword]);
}

/**
 * The middle of a token's script name: its stats, or the artifact type it has
 * instead of stats.
 *
 * A token with no body is an artifact token (`tokenCard`), and Forge's shipped
 * artifact tokens are `c_a_treasure`, `c_a_clue`, `c_a_food` — `a` in the slot
 * where a creature token writes `2_2`. That is the shipped corpus's convention
 * and not a rule anybody has seen Forge apply; no bead is cited for it, because
 * `mtg-17a` is the `S:` mapping and this is a file name. The file name is
 * cosmetic to Forge, which reads the `Name:` line, so a wrong guess here costs
 * diffability against the real corpus rather than a set that fails to load.
 */
function tokenBodyParts(token: TokenSpec): readonly string[] {
  if (!isCreatureTokenSpec(token)) return ['a'];
  return [String(token.power), String(token.toughness)];
}

/**
 * The words that tell one token from another inside its script name.
 *
 * Forge's own convention identifies a creature token by its subtypes
 * (`g_2_2_bear`) and leans on the two numbers and the keywords beside them to
 * carry the rest. That convention assumes a vanilla token's subtype already
 * distinguishes it, which held for a 90-card set minting one `Bear` and broke
 * at 22 tokens: the flagship mints five differently-named 0/1 colorless
 * tokens, all carrying the shared subtype `Part`, so the old
 * subtypes-only identity asked for `c_0_1_part` five times over and
 * `transpileSet` rejected the set with `DUPLICATE_TOKEN_SCRIPT`. Five more
 * collided the same way on `c_0_1_construct`.
 *
 * The name is the only field guaranteed to separate same-subtype tokens
 * (this repository's fixtures give every `Part` the identical subtype
 * `Part`, per the set design document, decision 9), so the name
 * goes in first and subtype words follow, only the ones the name does not
 * already spell: `Trophy Horn` + `Part` is `trophy_horn_part`, while a token
 * named `Treasure` with subtype `Treasure` stays `treasure` rather than
 * doubling. That last case lands on `c_a_treasure`, which is also the name
 * of a script Forge itself ships, and nobody has loaded a set carrying both
 * to see which file wins. Deliberately not guessed at, and deliberately
 * citing no bead: `mtg-17a` is the `S:` mapping, and parking this behind it
 * would let that bead close with this question untouched. The file name is
 * cosmetic to Forge, which reads the `Name:` line.
 *
 * A creature token and a bodiless one used to take different paths here —
 * subtypes-first for the former, name-first for the latter — which is what
 * let the creature path collide while the bodiless path (fixed for
 * `mtg-17a`-adjacent work) already survived a shared subtype. They now share
 * one rule.
 */
function tokenIdentityParts(token: TokenSpec): readonly string[] {
  const name = slugify(token.name);
  const spelled = new Set(name.split('_'));
  const extra = token.subtypes
    .map((subtype) => slugify(subtype))
    .filter((slug) => slug.length > 0 && !slug.split('_').every((word) => spelled.has(word)));
  return [name, ...extra];
}

/** `g_2_2_bear`, `w_2_2_knight_vigilance`, `c_a_trophy_horn_part`. */
export function forgeTokenScriptName(token: TokenSpec): string {
  const parts = [
    tokenColorPrefix(token.colors),
    ...tokenBodyParts(token),
    ...tokenIdentityParts(token),
    ...sortKeywords(token.keywords).map(keywordSlug),
  ];
  return parts.filter((part) => part.length > 0).join('_');
}

/**
 * Forge's token scripts name the object `<Thing> Token` (`Bear Token`,
 * `Soldier Token`), which is what the game surface displays.
 */
export function forgeTokenDisplayName(token: TokenSpec): string {
  return token.name.endsWith(' Token') ? token.name : `${token.name} Token`;
}
