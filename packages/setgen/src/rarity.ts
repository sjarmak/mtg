/**
 * What a rarity is for, read off the profile's own two rarity rules.
 *
 * A rare slot used to reach the model as the word "rare" in its slot line and
 * nothing else. Every other tier's brief was the same brief, so nineteen rares
 * generated at 250 cards were nineteen more uncommons with a different letter in
 * their slot code — the skeleton copies the uncommon shape into the rare tier
 * outright and says so in its own derivation note, and no role, allocator or
 * validator told the two apart.
 *
 * The rules that settle it were already in the profile and read by nobody:
 * `bombsMinRarity` says where a set may print a card that wins the game on its
 * own, and `maxComplexityRarity` says where the set's most complicated cards
 * belong. This file turns those two into the two facts a fill prompt needs about
 * the tier it is filling, and nothing else in the package decides either one.
 *
 * # Why this is a policy and not a scorer
 *
 * The application layer may say which slots are *allowed* to be bombs, because
 * that is the profile's stated rule and it is settled before any model call.
 * What a bomb *is* — which card in this set at this cost would take a game over —
 * is design judgment and stays with the model (ZFC). Nothing here scores a
 * finished card's power, and nothing should: a threshold in code that graded
 * power would be the exact heuristic this project delegates.
 */
import { atLeastRarity } from '@mtg/design-data';
import type { SliceRarity, SliceRarityRules } from '@mtg/design-data';

/**
 * What the profile's rules say a slot at this rarity is for.
 *
 * Two independent facts rather than one tier name, because the profile states
 * them independently and a set can be built where they do not coincide: a
 * profile whose most complicated cards live at uncommon while its bombs start at
 * rare is a legal profile and this answers it correctly without a special case.
 * Under the shipped play-booster profile both land on `rare` and nowhere else.
 */
export interface RarityPolicy {
  /**
   * This slot may print a card that wins the game on its own: its rarity is at
   * or above `bombsMinRarity`.
   *
   * No slot in a 90-card slice is ever asked, because the derivation allocates
   * that set no tier at or above the line. That is the rule holding rather than
   * the rule being skipped: bombs are kept to rare, and a set with no rares has
   * none to keep.
   */
  readonly bomb: boolean;
  /**
   * This slot is the set's home for its most complicated cards: its rarity is
   * exactly `maxComplexityRarity`.
   *
   * Exactly, not "at or below". The rule is a ceiling on where complexity is
   * welcome, and the tiers under it are governed by the New World Order budget
   * instead; a tier *above* it exists to be splashy and straightforward, which
   * is the sentence the rule was transcribed from.
   */
  readonly complexityHome: boolean;
}

export function rarityPolicy(rarity: SliceRarity, rules: SliceRarityRules): RarityPolicy {
  return {
    bomb: atLeastRarity(rarity, rules.bombsMinRarity),
    complexityHome: rarity === rules.maxComplexityRarity,
  };
}

/** True when a tier has anything to be told that an unremarkable tier does not. */
export function hasRarityInstruction(policy: RarityPolicy): boolean {
  return policy.bomb || policy.complexityHome;
}
