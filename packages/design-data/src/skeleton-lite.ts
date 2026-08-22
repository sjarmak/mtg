/**
 * skeleton-lite: the thin-slice profile, DERIVED from the full play-booster
 * profile rather than hand-written.
 *
 * Deriving instead of transcribing is the point. A hand-written slice profile
 * drifts from its parent the moment the parent is corrected, and its numbers
 * carry no provenance. Every count below traces back through largest-remainder
 * apportionment to a cited number in `skeleton-play-booster-2024.json`, and the
 * whole derivation is deterministic: same profile plus same target size gives
 * byte-identical output forever.
 *
 * Slice shape (decision-synthesis section 5): ~90 cards, five colors plus
 * artifact, no multicolor, no nonbasic lands. That section said two rarities;
 * `SLICE_RARITIES` is three now, and the difference is size rather than a
 * revision — the rare tier is empty below a target of 123 cards, so the ~90
 * the section describes still prints exactly the two it describes.
 */
import type { Color, Keyword, Rarity } from '@mtg/dsl';
import { apportion, COLORS } from '@mtg/dsl';
import { apportionPair, midpoint, roundHalfUp, seatFromTop } from './apportion';
import {
  commonSlotsForColor,
  derivedCommonCreatureShare,
  derivedUncommonCreatureShare,
  pinnedKeywordBudget,
  PLAY_BOOSTER_2024,
  uncommonSlotsForColor,
  unpinnedKeywordNames,
} from './skeleton';
import type { CurveBucket, SkeletonProfileDocument } from './skeleton-schema';

/**
 * The rarities the slice prints, and the whole list.
 *
 * Three tiers since `mtg-bc2.26.4`, and the rare share is not chosen here. The
 * apportionment that already weighted commons against uncommons by the
 * profile's booster slots (9 : 3) takes the third slot from the same sentence
 * of the same article, `booster.rareOrMythic` (1), so the split is 9 : 3 : 1
 * and the argument for using pack shape rather than the profile's own card
 * counts is the one `DERIVATION_NOTES` already makes. A 250-card set (decision
 * 3 of the set design document) gets 19 rares, which is what lets
 * its named parts and its named weapons be the marquee cards decisions 8 and 12
 * call for. How many weapons is not a number to quote here: decision 12 says
 * roughly eight and the card list at line 96 of the same document says fifteen,
 * and nothing has settled which.
 *
 * A small set prints none, and that comes off the profile too rather than out
 * of the air: `rarityRules.rareCyclesMin` is transcribed from Nuts & Bolts as a
 * generator floor ("You will probably have at least two rare cycles"), so a
 * rare pool that cannot seat two cards in every color is not a tier, and the
 * derivation folds it back into commons and uncommons and says so in a note.
 * The 90-card slice is below that line; the 250-card flagship is well above it.
 *
 * `mythic` is in `@mtg/dsl`'s `RARITIES`, but deliberately not in this slice's
 * allocation. Adding it to the DSL required explicit rows in the total
 * `Record<Rarity, ...>` tables that stop compiling without a mythic decision —
 * the art pipeline's compose module `TIER_BY_RARITY`,
 * `packages/forge-export/src/vocabulary-map.ts` `FORGE_RARITY_CODES`,
 * `packages/ui/src/card/anatomy.ts` `RARITY_SEALS` and
 * `packages/ui/src/routes/CardsRoute.ts` `RARITY_LABELS`. Each wants a decision
 * rather than a default (Forge's code, an art detail tier, a seal shape), which
 * is the total `Record` doing its job. That is the measurement `mtg-bc2.26.8`
 * asked for; the tuple entry was trivial and the four decisions were the tier.
 *
 * Were it allocated, the skeleton would still print none. The profile splits
 * its one rare-or-mythic slot by `booster.mythicOneInN`, seven, so a mythic
 * tier is a seventh of the rare tier: three cards at 250 and fewer below that,
 * short of one cycle let alone `rareCyclesMin` of them. `skeleton-lite.test.ts`
 * runs that arithmetic over every size the derivation accepts - all of them,
 * `MIN_SLICE_TARGET_SIZE` through `MAX_SLICE_TARGET_SIZE` - instead of leaving
 * it as a sentence here, and it runs the size where the arithmetic turns as
 * well: 448 cards, which the ceiling puts 187 out of reach.
 *
 * Widening this list is a set-design decision, not an edit: it re-keys every
 * set-gen prompt at the sizes it reaches and moves the set the balance gate
 * measures. Most of the repo is told by the compiler — a `@mtg/setgen` slot's
 * `rarity` is this type, so its slot-code table and the allocator's per-rarity
 * records stop compiling until each one is decided. `@mtg/deckbuild` is the
 * exception typing cannot reach: it depends on `@mtg/dsl` alone, so no compiler
 * can tell it a tier arrived. That gap has since been closed by deriving rather
 * than declaring - `boosterRecipeFor` reads the pool and deals
 * a fixed rare pack to a set that prints rares and the M11/M13 weighted
 * rare-mythic sheet to a set that prints both. A new fifth DSL tier would still
 * need an explicit collation decision there.
 *
 * The `satisfies` catches one thing and is worth exactly that: a typo. Without
 * it, `'uncomon'` here is a legal string literal, and what the compiler
 * reports is the wreckage downstream — the `Record<SliceRarity, ...>` literals
 * this file builds below, the profile assertions in its test, a
 * `rarity === 'uncommon'` comparison over in `@mtg/setgen` — none of which name
 * the constant. With it, the first error is at the list itself: `'uncomon' is
 * not assignable to '"common" | "uncommon" | "rare"'`. It does not catch a
 * widening: every member of `RARITIES` is a legal entry here, so a fourth tier
 * would satisfy the constraint and still have to be decided at every site the
 * paragraph above names, exactly as `'rare'` just was.
 */
export const SLICE_RARITIES = ['common', 'uncommon', 'rare'] as const satisfies readonly Rarity[];
export type SliceRarity = (typeof SLICE_RARITIES)[number];

export const DEFAULT_SLICE_TARGET_SIZE = 90;
/** Below this, the uncommon pool cannot give every color a card. */
export const MIN_SLICE_TARGET_SIZE = 20;
/**
 * Above this, the derivation would be extrapolating rather than apportioning.
 *
 * The profile describes one printed set of `setSize.total` unique cards - 261,
 * carried with the article's own sentence as its quote - and every count this
 * file produces is that set's shape redistributed by largest remainder onto a
 * target. A target larger than the source is not that operation: it hands the
 * booster weights a set the document never measured, and answers this file
 * gives start changing. The mythic decision is one of them: a seventh of the
 * rare tier is short of a color cycle at every size up to 447 and reaches one at
 * 448, so a derivation with no ceiling settles mythic for the sizes somebody
 * tried and not for the sizes it accepts. The ceiling is the source's own size
 * rather than 447, because the source's size is a number the profile states and
 * 447 is a number this file would have chosen.
 *
 * `@mtg/setgen`'s brief schema carries the same bound, so a set too large is
 * refused at the field the human wrote rather than as a `RangeError` two calls
 * later.
 */
export const MAX_SLICE_TARGET_SIZE = PLAY_BOOSTER_2024.data.setSize.total;
export const SLICE_PROFILE_VERSION = 1;

/**
 * The share of commons a New World Order red flag may touch, overriding
 * `doc.data.complexity.nwoRedFlagBudget` (0.2, sourced from the community
 * codification of Rosewater's article — see that field's citation note in
 * `skeleton-play-booster-2024.json`, which already calls it "a tunable
 * parameter rather than canon" because the article itself states no number).
 *
 * Real New World Order caps *board* complexity: how much a beginner has to
 * track on the table at once. `redFlagsFor` (`@mtg/setgen`) cannot see the
 * board — it prices one card at a time — so it charges the same flag to a
 * death trigger that makes one token as to a five-line activated engine, and
 * 0.2 was measured against the article's own coarser reading of "complexity"
 * rather than against a per-card price. On the flagship set's 253-card
 * build the budget sat at 32 of 35 (91%): `trackedAbility` alone, one flag per
 * common that prints any triggered or activated ability, accounted for 22 of
 * the 32, which priced a printed CR 113 ability off most of the set's commons
 * and is a measured cause of the set's creatures printing no ability at all
 * more than half the time (2026-08-18 power-level audit of the flagship
 * 253-card build). A false negative here is a set a
 * beginner cannot track; a false positive is a common with an ordinary
 * trigger forced up in rarity or stripped to a keyword, which is the cost
 * this override is paying down. 0.35 is the number that gives a common "3/3
 * for three, does one thing" room to exist without eating the whole
 * per-card-priced budget on the first ability it prints; it is a widening of
 * the same tunable parameter the source data already disclaims, not a claim
 * about what the article's own ratio was.
 */
export const NWO_RED_FLAG_BUDGET = 0.35;

export interface SliceKeywordBudget {
  readonly keyword: Keyword;
  readonly count: number;
}

export interface SliceGroupPlan {
  readonly cards: number;
  readonly creatures: number;
  readonly spells: number;
  readonly creatureCurve: readonly CurveBucket[];
  readonly keywords: readonly SliceKeywordBudget[];
  readonly spellRoles: readonly string[];
}

export type SliceRarityPlans = Readonly<Record<SliceRarity, SliceGroupPlan>>;

/**
 * The two rarity rules the slice carries out of the source profile, unchanged.
 *
 * Both were transcribed from Nuts & Bolts with their quotes when the profile was
 * written, and both then sat in the document being read by nobody: a rare tier
 * landed, and the generator still had no statement anywhere that a rare is for
 * anything a smaller card is not. They are copied onto the derived profile
 * rather than looked up again from the document, because the derived profile is
 * what `@mtg/setgen` is handed and a consumer that has to reach past it for a
 * policy will eventually reach for a literal instead.
 *
 * `bombsMinRarity` is the rarity at which a set is allowed to print a card that
 * wins the game on its own ("Magic needs its bombs, and to keep from ruining
 * Limited these bombs are kept to rare and mythic rare"). `maxComplexityRarity`
 * is the highest rarity the set's most complicated cards belong at ("rare is the
 * sole home for the uber-complicated cards"). Neither is a number this file
 * chose, and a profile that states them differently moves the generator's
 * instruction without an edit here.
 *
 * A slice with no rare tier satisfies the first rule by printing no bombs, which
 * is the rule holding rather than the rule being skipped: nothing in the set is
 * at or above `bombsMinRarity`, so nothing is allowed to be one.
 */
export interface SliceRarityRules {
  readonly bombsMinRarity: SliceRarity;
  readonly maxComplexityRarity: SliceRarity;
}

/**
 * The tiers in ascending order, as a total record rather than as the order of
 * `SLICE_RARITIES`.
 *
 * The tier list says which tiers the slice prints and nothing about their
 * ranking, so a fourth tier appended to it would rank below whatever it was
 * appended after, silently and wrongly. Here it does not compile until somebody
 * says where it sits, which is the same argument every other total `Record` over
 * a rarity in this repository makes. One copy, because two rankings of three
 * tiers is two chances to disagree about what "at or above" means.
 */
export const RARITY_ORDER: Readonly<Record<SliceRarity, number>> = { common: 0, uncommon: 1, rare: 2 };

export function rarityRank(rarity: SliceRarity): number {
  return RARITY_ORDER[rarity];
}

/** Whether a tier is at or above a rule's floor. */
export function atLeastRarity(rarity: SliceRarity, floor: SliceRarity): boolean {
  return rarityRank(rarity) >= rarityRank(floor);
}

export interface SkeletonLiteProfile {
  readonly version: number;
  readonly profile: 'skeleton-lite';
  readonly derivedFrom: {
    readonly profile: string;
    readonly version: number;
    readonly verifiedOn: string;
  };
  readonly setSize: number;
  readonly rarityTotals: Readonly<Record<SliceRarity, number>>;
  readonly perColorCards: Readonly<Record<SliceRarity, number>>;
  readonly colors: Readonly<Record<Color, SliceRarityPlans>>;
  readonly colorless: SliceRarityPlans;
  /** The source profile's two rarity rules, carried rather than restated. */
  readonly rarityRules: SliceRarityRules;
  /** Color pairs the balance sim runs as matchups; the slice prints no gold cards. */
  readonly archetypePairs: readonly string[];
  readonly nwoRedFlagBudget: number;
  /** Every judgment call the derivation made, in the order it made them. */
  readonly derivation: readonly string[];
}

export interface SkeletonLiteOptions {
  readonly targetSize?: number;
}

function byColor<T>(make: (color: Color) => T): Record<Color, T> {
  return { W: make('W'), U: make('U'), B: make('B'), R: make('R'), G: make('G') };
}

interface RaritySplit {
  readonly perColor: number;
  readonly colorless: number;
}

/**
 * Splits a rarity's card budget into a colorless share and five equal color
 * pools, or `undefined` when what is left cannot give every color a card.
 *
 * Colors are held strictly equal, which is the one constraint here that is not
 * negotiable: an unequal split would bias the balance sim's per-pair win rates
 * before a single game is played. Everything else follows from the order the
 * two shares are taken in, and the order used to be wrong.
 *
 * It used to round the *colored* nominal up to a whole card per color and let
 * the colorless pool have whatever survived — so colorless was not a share at
 * all, it was the rounding error times five. `mtg-dkgd` is the set owner
 * finding out what that costs: a 253-card build got fifteen common artifacts,
 * three uncommon and **zero rare**, and the flagship's marquee weapons had
 * nowhere to land, so a legendary sword the brief asked for at rare printed at
 * common (`mtg-pnc0`). The profile says colorless is 7.4% of the commons and
 * 9.4% of the uncommons; the derivation was paying it 0% wherever five colors
 * happened to round up cleanly, which is 42 of the tiers across the legal size
 * range and includes every size the flagship is built at.
 *
 * So the colored rounding is kept and given a floor under it: where the profile
 * owes colorless a whole card, the colors never round past the point that would
 * take it. That is the whole change, and it is deliberately the narrow form of
 * it rather than apportioning colorless first at its full weight.
 *
 * Two measurements argue for the narrow form. The first is that a full share
 * taken first has to round, and rounding up deletes a tier: a rare tier is ten
 * cards at every size from 123 to 137, colorless' honest share of ten is 0.94,
 * and paying that as one leaves nine cards for five colors, which is one rare
 * per color and under `rarityRules.rareCyclesMin`. Thirteen sizes would lose
 * their rare tier outright to buy a single artifact. The second is Tideglass
 * Reach, whose four mechanics are every one of them color-scoped: paying its
 * 90-card build a full colorless share grows its common artifact pool from
 * three cards to eight, and `checkSlotFillability` then refuses the allocation,
 * because two gear slots are left with no mechanic in the brief that could fill
 * them. A colorless share is a claim about the set's design, and a set whose
 * design says nothing about artifacts should not be handed more of them.
 *
 * The guard is what the defect actually was. A pool owed 1.89 rare artifacts
 * and paid zero is a different failure from one owed 5.47 and paid 3: the first
 * is a tier that does not exist, and the second is a tier that is a little
 * light. Swept over every legal size, the guard moves 29 of 187 sizes, changes
 * no size's rare-tier presence, and takes the tiers holding no colorless card
 * at all from 42 down to 13 — the 13 being exactly those 123-to-137 rare tiers,
 * where the derivation is saying that a tier of ten cannot afford an artifact
 * and keeping the tier instead.
 *
 * The indivisible remainder still lands on colorless rather than on one lucky
 * color, for the same reason it always did, so where the guard binds the pool
 * lands above its nominal share rather than below — five cards of the 253-card
 * rare tier against a nominal 1.89. That is the price of holding the colors
 * equal and it is the right way round: over-serving colorless prints an extra
 * artifact, under-serving it printed none.
 */
function trySplitRarity(
  total: number,
  profileColored: number,
  profileColorless: number,
): RaritySplit | undefined {
  const colorCount = COLORS.length;
  const share = profileColored + profileColorless;
  const owed = (total * profileColorless) / share >= 1 ? 1 : 0;
  const perColor = Math.min(
    roundHalfUp((total * profileColored) / share / colorCount),
    Math.floor((total - owed) / colorCount),
  );
  if (perColor < 1) return undefined;
  return { perColor, colorless: total - perColor * colorCount };
}

/** The same split for a tier every legal target size prints, where no split is a bug. */
function splitRarity(total: number, profileColored: number, profileColorless: number): RaritySplit {
  const split = trySplitRarity(total, profileColored, profileColorless);
  if (split === undefined) {
    throw new RangeError(
      `deriveSkeletonLite: ${total} cards cannot be split across ${COLORS.length} colors; raise targetSize`,
    );
  }
  return split;
}

/** How many slots of a tier the profile gives the colors, and the colorless pool. */
interface TierWeights {
  readonly colored: number;
  readonly colorless: number;
}

interface RarityBudget {
  readonly totals: Readonly<Record<SliceRarity, number>>;
  readonly splits: Readonly<Record<SliceRarity, RaritySplit>>;
  /** Why the rare tier is the size it is, including when it is nothing. */
  readonly note: string;
}

/** A tier the derivation allocated no cards to. */
const NO_CARDS: RaritySplit = { perColor: 0, colorless: 0 };

/**
 * The three tiers' card budgets.
 *
 * The booster slots weight the split, 9 : 3 : 1, which is the same sentence of
 * the same article the two-tier 9 : 3 came from. What the third slot cannot do
 * is be small: a rare pool short of `rarityRules.rareCyclesMin` cards in every
 * color is not a tier but a handful, and the profile carries that count as a
 * generator floor with the quote it was inferred from. Below the floor the
 * whole target goes to commons and uncommons, byte-identical to the two-tier
 * derivation, and the returned note says which happened and why.
 *
 * The floor is not a line the tier stays above once it crosses. Largest
 * remainder gives 123 cards ten rares and 124 cards nine, and nine floors to one
 * per color, so 124 is the single accepted size above 122 that prints no tier
 * and 125 prints one again. That hole is what apportioning three weights over a
 * whole number does; closing it would mean printing a rare the 9 : 3 : 1 split
 * did not buy.
 */
function rarityBudget(
  targetSize: number,
  doc: SkeletonProfileDocument,
  weights: Readonly<Record<SliceRarity, TierWeights>>,
): RarityBudget {
  const { booster, rarityRules } = doc.data;
  const cycles = rarityRules.rareCyclesMin;
  const split = (rarity: SliceRarity, total: number): RaritySplit =>
    splitRarity(total, weights[rarity].colored, weights[rarity].colorless);

  const [three = 0, threeUncommon = 0, rare = 0] = apportion(targetSize, [
    booster.common,
    booster.uncommon,
    booster.rareOrMythic,
  ]);
  const rareSplit = trySplitRarity(rare, weights.rare.colored, weights.rare.colorless);
  if (rareSplit !== undefined && rareSplit.perColor >= cycles) {
    return {
      totals: { common: three, uncommon: threeUncommon, rare },
      splits: { common: split('common', three), uncommon: split('uncommon', threeUncommon), rare: rareSplit },
      note:
        `Rare tier: ${rare} cards, ${rareSplit.perColor} per color plus ${rareSplit.colorless} colorless. ` +
        `The booster slot split is 9:3:1 (booster.common : booster.uncommon : booster.rareOrMythic), and ${rareSplit.perColor} rares per color meets the profile's rareCyclesMin of ${cycles}.`,
    };
  }

  const [common, uncommon] = apportionPair(targetSize, [booster.common, booster.uncommon]);
  const perColor = rareSplit?.perColor ?? 0;
  return {
    totals: { common, uncommon, rare: 0 },
    splits: { common: split('common', common), uncommon: split('uncommon', uncommon), rare: NO_CARDS },
    note:
      `Rare tier: none. The 9:3:1 booster slot split gives ${rare} rares, ${perColor} per color, ` +
      `under the profile's rareCyclesMin of ${cycles}; the whole target is spent on commons and uncommons instead.`,
  };
}

function scaleCurve(creatures: number, template: readonly CurveBucket[]): CurveBucket[] {
  const counts = apportion(
    creatures,
    template.map((bucket) => bucket.count),
  );
  return template.map((bucket, index) => ({
    mvMin: bucket.mvMin,
    mvMax: bucket.mvMax,
    count: counts[index] ?? 0,
  }));
}

/**
 * The same buckets, seated from the expensive end down.
 *
 * Largest-remainder apportionment answers "what shape is this curve", and for a
 * tier with fewer creatures than the curve has buckets it cannot answer that at
 * all: something has to be dropped, and apportionment drops whatever has the
 * smallest count. Those are the ends of the curve, so a two-creature tier comes
 * out as two copies of the color's *most common* mana value. Measured on the
 * play-booster profile at 250 cards, that is what the rare tier was getting -
 * white's two rares landed on the two-drop and the three-drop buckets while the
 * five-six and six-seven buckets, which the same color's own curve does print,
 * came out empty. Seventeen of the nineteen rares sat at mana value four or
 * below and exactly one above it.
 *
 * For the tier `rarityRules.bombsMinRarity` names, that is backwards, and it is
 * an artifact of the arithmetic rather than a decision anybody made. Which
 * buckets a tier too small for its curve should drop is the decision, and for
 * the tier a set is allowed to print game-winning cards at, it drops the cheap
 * end. Nothing is invented here: every bucket, every mana value and every count
 * ceiling is the color's own published curve, walked from the other end.
 *
 * The walk itself is `seatFromTop`, because `@mtg/setgen`'s spell curve has the
 * same problem at the same tier and a body converted out of a spell slot crosses
 * from that curve to this one. Two copies would be two answers to which end
 * survives, and the two would meet on one card.
 */
function topOfCurve(creatures: number, template: readonly CurveBucket[]): CurveBucket[] {
  const counts = seatFromTop(
    creatures,
    template.map((bucket) => bucket.count),
  );
  return template.map((bucket, index) => ({
    mvMin: bucket.mvMin,
    mvMax: bucket.mvMax,
    count: counts[index] ?? 0,
  }));
}

function scaleKeywords(
  creatures: number,
  template: readonly SliceKeywordBudget[],
  templateCreatures: number,
): SliceKeywordBudget[] {
  const weights = template.map((entry) => entry.count);
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (template.length === 0 || weightSum <= 0 || templateCreatures <= 0) {
    return template.map((entry) => ({ keyword: entry.keyword, count: 0 }));
  }
  const scaled = roundHalfUp((weightSum * creatures) / templateCreatures);
  const budget = Math.min(scaled, creatures);
  const counts = apportion(budget, weights);
  return template.map((entry, index) => ({ keyword: entry.keyword, count: counts[index] ?? 0 }));
}

/**
 * Fills `count` spell slots from a role template, repeating it as often as the
 * count needs and truncating when the count is shorter than the template.
 *
 * Exported because it is the one answer to "how does a list of role names fill a
 * group's spell slots", and `@mtg/setgen` asks the same question of a role list
 * a brief states for a tier. A second copy there would be a second answer, and
 * the two would drift the first time a template shorter than its group came up.
 */
export function cycleRoles(template: readonly string[], count: number): string[] {
  const roles: string[] = [];
  if (template.length === 0) return roles;
  for (let index = 0; index < count; index += 1) {
    const role = template[index % template.length];
    if (role === undefined) break;
    roles.push(role);
  }
  return roles;
}

interface GroupInput {
  readonly cards: number;
  readonly creatureShare: number;
  readonly curveTemplate: readonly CurveBucket[];
  readonly keywordTemplate: readonly SliceKeywordBudget[];
  readonly keywordTemplateCreatures: number;
  readonly spellRoleTemplate: readonly string[];
  /**
   * Whether this group is at or above `rarityRules.bombsMinRarity`.
   *
   * It changes one thing and only when the group is too small to carry its own
   * curve: which end of the curve gets dropped. Every group at every other tier,
   * and every bomb group large enough to seat one card per bucket, apportions
   * exactly as it always did.
   */
  readonly bombTier?: boolean;
}

function buildGroup(input: GroupInput): SliceGroupPlan {
  const creatures = Math.min(input.cards, Math.max(0, roundHalfUp(input.cards * input.creatureShare)));
  const spells = input.cards - creatures;
  const seatFromTop = input.bombTier === true && creatures < input.curveTemplate.length;
  return {
    cards: input.cards,
    creatures,
    spells,
    creatureCurve: seatFromTop
      ? topOfCurve(creatures, input.curveTemplate)
      : scaleCurve(creatures, input.curveTemplate),
    keywords: scaleKeywords(creatures, input.keywordTemplate, input.keywordTemplateCreatures),
    spellRoles: cycleRoles(input.spellRoleTemplate, spells),
  };
}

const DERIVATION_NOTES: readonly string[] = [
  'Rarity split follows the profile booster slots (9 commons : 3 uncommons : 1 rare-or-mythic), not the profile card counts, because the slice is drafted and played rather than collected: what a player sees per pack is the weighting a pool that gets opened deserves.',
  'Colors are held exactly equal at each rarity; the indivisible remainder goes to the colorless (artifact) pool so no color is advantaged in the balance sim.',
  'Creature/spell splits use the share DERIVED from the profile slot tables, not the article-stated percentage. For black, red and green the article states a percentage over a denominator of 14 while its own slot tables give 15 — see the DISCREPANCY citation notes on colors.*.common.creatureShare.',
  'INFERRED: uncommon creature curves reuse the color common curve shape. No published play-booster skeleton gives an uncommon curve.',
  'INFERRED: uncommon keyword budgets reuse the color common keyword table, rescaled by uncommon creature count. No published uncommon keyword table exists.',
  'INFERRED: uncommon spell roles reuse the color common spell-slot list. No published uncommon role list exists.',
  'INFERRED: rare groups reuse the uncommon shape entirely - the uncommon creature share, the color common curve, the color common keyword table and its spell-slot list. The profile publishes no rare slot table, so there is nothing closer to copy.',
  'The copied shape is where the tiers agree, and rarityRules is where they no longer do: bombsMinRarity and maxComplexityRarity are carried onto this profile, so a tier at or above the first is the tier a set may print a card that wins the game on its own at, and consumers read that rather than testing for the word rare.',
  'A group at or above bombsMinRarity with fewer creatures than its curve has buckets is seated from the expensive end down instead of by largest remainder. Apportionment has to drop buckets there and it drops the smallest counts, which are the ends of the curve: at 250 cards the whole rare tier came out at the mode of its color common curve, seventeen of nineteen rares at mana value four or below. No bucket, mana value or count ceiling is invented - it is the same published curve walked from the other end. Every other tier, and any bomb tier large enough to seat one card per bucket, apportions exactly as before.',
  'Keyword budgets are restricted to the pinned slice vocabulary; profile keywords the slice engine cannot run (double strike, ward, defender, flash) are dropped, not remapped.',
  'Fractional profile keyword counts encode rotating slots across sets. The slice prints one set, so budgets are apportioned to integers by largest remainder.',
  'Nonbasic land slots are excluded from the colorless uncommon share: the slice pool is five colors plus artifact, with basic lands supplied by the deck builder.',
  'No multicolor slots are derived. The ten color pairs survive only as the balance sim matchup list; the slice prints no gold cards and therefore no signpost uncommons.',
];

/**
 * Derives the thin-slice profile. Deterministic: equal inputs give a
 * structurally equal profile every time.
 */
export function deriveSkeletonLite(
  options: SkeletonLiteOptions = {},
  doc: SkeletonProfileDocument = PLAY_BOOSTER_2024,
): SkeletonLiteProfile {
  const targetSize = options.targetSize ?? DEFAULT_SLICE_TARGET_SIZE;
  // The ceiling comes off the document in hand, not off the default one: a
  // caller deriving from another profile is bounded by that profile's set size.
  const maxTargetSize = doc.data.setSize.total;
  if (!Number.isInteger(targetSize) || targetSize < MIN_SLICE_TARGET_SIZE || targetSize > maxTargetSize) {
    throw new RangeError(
      `deriveSkeletonLite: targetSize must be an integer in ${MIN_SLICE_TARGET_SIZE}..${maxTargetSize} ` +
        `(the source profile's own set size), got ${targetSize}`,
    );
  }

  const colorless = doc.data.colorless;
  const colorlessCommonSlots = colorless.common.creatures + colorless.common.spells;
  const colorlessUncommonSlots =
    colorless.uncommon.creatures +
    midpoint(colorless.uncommon.noncreaturesMin, colorless.uncommon.noncreaturesMax);
  const coloredCommonSlots = COLORS.reduce((sum, color) => sum + commonSlotsForColor(color, doc), 0);
  const coloredUncommonSlots = COLORS.reduce((sum, color) => sum + uncommonSlotsForColor(color, doc), 0);

  // The rare tier is weighted by the uncommon slot tables, the same object and
  // not a copy of its numbers: the profile publishes no rare slot table at all,
  // and the uncommon one is the nearest thing to it the document contains.
  const uncommonWeights: TierWeights = {
    colored: coloredUncommonSlots,
    colorless: colorlessUncommonSlots,
  };
  const budget = rarityBudget(targetSize, doc, {
    common: { colored: coloredCommonSlots, colorless: colorlessCommonSlots },
    uncommon: uncommonWeights,
    rare: uncommonWeights,
  });

  // Which tiers the profile allows a bomb at, asked once and used everywhere a
  // group is built. Every shipped profile answers `rare` and only `rare`; a
  // profile that answered lower would move the shape and the generator's
  // instruction together, which is the point of asking the document rather than
  // testing for the word.
  const isBombTier = (rarity: SliceRarity): boolean =>
    atLeastRarity(rarity, doc.data.rarityRules.bombsMinRarity);

  const colors = byColor((color): SliceRarityPlans => {
    const profile = doc.data.colors[color].common;
    const keywordTemplate = pinnedKeywordBudget(color, doc);
    const uncommonShaped = (cards: number, bombTier = false): SliceGroupPlan =>
      buildGroup({
        cards,
        creatureShare: derivedUncommonCreatureShare(color, doc),
        curveTemplate: profile.creatureCurve,
        keywordTemplate,
        keywordTemplateCreatures: profile.creatures,
        spellRoleTemplate: profile.spellSlots,
        bombTier,
      });
    return {
      common: buildGroup({
        cards: budget.splits.common.perColor,
        creatureShare: derivedCommonCreatureShare(color, doc),
        curveTemplate: profile.creatureCurve,
        keywordTemplate,
        keywordTemplateCreatures: profile.creatures,
        spellRoleTemplate: profile.spellSlots,
      }),
      uncommon: uncommonShaped(budget.splits.uncommon.perColor, isBombTier('uncommon')),
      rare: uncommonShaped(budget.splits.rare.perColor, isBombTier('rare')),
    };
  });

  const colorlessUncommonShaped = (cards: number, bombTier = false): SliceGroupPlan =>
    buildGroup({
      cards,
      creatureShare: colorlessUncommonSlots === 0 ? 0 : colorless.uncommon.creatures / colorlessUncommonSlots,
      curveTemplate: colorless.common.creatureCurve,
      keywordTemplate: [],
      keywordTemplateCreatures: colorless.common.creatures,
      spellRoleTemplate: colorless.common.spellSlots,
      bombTier,
    });

  const colorlessPlans: SliceRarityPlans = {
    common: buildGroup({
      cards: budget.splits.common.colorless,
      creatureShare: colorlessCommonSlots === 0 ? 0 : colorless.common.creatures / colorlessCommonSlots,
      curveTemplate: colorless.common.creatureCurve,
      keywordTemplate: [],
      keywordTemplateCreatures: colorless.common.creatures,
      spellRoleTemplate: colorless.common.spellSlots,
    }),
    uncommon: colorlessUncommonShaped(budget.splits.uncommon.colorless, isBombTier('uncommon')),
    rare: colorlessUncommonShaped(budget.splits.rare.colorless, isBombTier('rare')),
  };

  const dropped = [...new Set(COLORS.flatMap((color) => unpinnedKeywordNames(color, doc)))].sort();

  return {
    version: SLICE_PROFILE_VERSION,
    profile: 'skeleton-lite',
    derivedFrom: { profile: doc.profile, version: doc.version, verifiedOn: doc.verifiedOn },
    setSize: targetSize,
    rarityTotals: budget.totals,
    perColorCards: {
      common: budget.splits.common.perColor,
      uncommon: budget.splits.uncommon.perColor,
      rare: budget.splits.rare.perColor,
    },
    colors,
    colorless: colorlessPlans,
    rarityRules: {
      bombsMinRarity: doc.data.rarityRules.bombsMinRarity,
      maxComplexityRarity: doc.data.rarityRules.maxComplexityRarity,
    },
    archetypePairs: doc.data.archetypes.pairs,
    // Overridden rather than read off `doc.data.complexity.nwoRedFlagBudget`
    // (0.2) — see `NWO_RED_FLAG_BUDGET`'s docblock for the argument. The doc
    // value is left alone because the source citation still describes it
    // accurately as the community-codified figure; this file is the one place
    // that widens it for what a per-card-priced validator can actually charge.
    nwoRedFlagBudget: NWO_RED_FLAG_BUDGET,
    derivation: [
      ...DERIVATION_NOTES,
      budget.note,
      `Dropped keywords, outside the pinned slice vocabulary: ${dropped.join(', ')}.`,
      `New World Order budget overridden to ${String(NWO_RED_FLAG_BUDGET)} (source profile states ${String(doc.data.complexity.nwoRedFlagBudget)}): the source figure prices board complexity, and \`redFlagsFor\` charges one flat flag per card, so an ordinary death trigger costs what a five-line engine costs. The share is the same share; what it buys is coarser. See \`NWO_RED_FLAG_BUDGET\`'s docblock.`,
    ],
  };
}

/** The default 90-card slice profile, derived once. */
export const SKELETON_LITE: SkeletonLiteProfile = deriveSkeletonLite();

/** Every group plan in a profile, colors first in WUBRG order then colorless. */
export function allGroupPlans(profile: SkeletonLiteProfile): SliceGroupPlan[] {
  const colored = COLORS.flatMap((color) => SLICE_RARITIES.map((rarity) => profile.colors[color][rarity]));
  return [...colored, ...SLICE_RARITIES.map((rarity) => profile.colorless[rarity])];
}

/** Total cards the plan actually allocates; must equal `profile.setSize`. */
export function totalSliceCards(profile: SkeletonLiteProfile): number {
  return allGroupPlans(profile).reduce((sum, plan) => sum + plan.cards, 0);
}

export function totalSliceCreatures(profile: SkeletonLiteProfile): number {
  return allGroupPlans(profile).reduce((sum, plan) => sum + plan.creatures, 0);
}

export function totalSliceSpells(profile: SkeletonLiteProfile): number {
  return allGroupPlans(profile).reduce((sum, plan) => sum + plan.spells, 0);
}
