/**
 * Set-level composition: curve, creature share, rarity totals, duplication and
 * mechanic coverage.
 *
 * These are the checks that only exist across the whole card list. Curve and
 * creature share are asserted against the same skeleton-lite plan the allocator
 * used, with the +/-1 card tolerance the set-design lane recommends (real sets
 * deviate from their own skeleton). Duplication reuses the DSL's own set-level
 * uniqueness pass so "functional reprint" means exactly what the engine means.
 */
import type { Card, Color, Rarity } from '@mtg/dsl';
import {
  cardManaValue,
  COLORS,
  RARITIES,
  isPricedEffectKind,
  tokenNameConflicts,
  validateSetUniqueness,
} from '@mtg/dsl';
import type { CurveBucket, SkeletonLiteProfile, SliceGroupPlan, SliceRarity } from '@mtg/design-data';
import { classify, SLICE_RARITIES } from '@mtg/design-data';
import type { DesiredMechanic, RequiredCard, TierSpellRoles } from '../brief';
import { slotPoolFor } from '../brief';
import type { Slot } from '../slot';
import { slotGroupKey } from '../slot';
import type { SetFinding } from './findings';
import { finding } from './findings';
// A value import into `mechanics.ts`, whose only reach back here is
// `import type { Entry }` and so is erased: no cycle survives compilation.
import { printedAbilityKinds, printedEffectKinds } from './mechanics';

/** Real sets deviate from their own skeleton; one card of slack per bucket. */
const TOLERANCE = 1;

export interface Entry {
  readonly slot: Slot;
  readonly card: Card;
}

export function planFor(
  profile: SkeletonLiteProfile,
  rarity: SliceRarity,
  color: Color | null,
): SliceGroupPlan {
  return color === null ? profile.colorless[rarity] : profile.colors[color][rarity];
}

function groupEntries(entries: readonly Entry[]): Map<string, Entry[]> {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = slotGroupKey(entry.slot);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [entry]);
    else bucket.push(entry);
  }
  return groups;
}

export function checkCreatureShare(entries: readonly Entry[], profile: SkeletonLiteProfile): SetFinding[] {
  const found: SetFinding[] = [];
  for (const [key, bucket] of groupEntries(entries)) {
    const first = bucket[0];
    if (first === undefined) continue;
    const plan = planFor(profile, first.slot.rarity, first.slot.color);
    const creatures = bucket.filter((entry) => entry.card.kind === 'creature').length;
    if (Math.abs(creatures - plan.creatures) <= TOLERANCE) continue;
    found.push(
      finding(
        'CREATURE_SHARE_BAND',
        'error',
        `group ${key} printed ${creatures} creatures; the skeleton wants ${plan.creatures} (+/-${TOLERANCE})`,
        bucket.map((entry) => entry.slot.id),
      ),
    );
  }
  return found;
}

/**
 * Histogram fit against the plan's curve buckets. Published curves overlap
 * ("1-2" next to "2-2"), so a naive first-match assignment would pile every
 * two-drop into the wider bucket and report a mismatch that is not there.
 * Filling each bucket to its planned capacity before spilling over is the
 * reading that treats the profile as a target rather than a trap.
 */
function fitCurve(manaValues: readonly number[], buckets: readonly CurveBucket[]): number[] {
  const counts = buckets.map(() => 0);
  const fits = (bucket: CurveBucket, value: number): boolean =>
    value >= bucket.mvMin && value <= bucket.mvMax;
  for (const value of [...manaValues].sort((a, b) => a - b)) {
    const withRoom = buckets.findIndex(
      (bucket, index) => fits(bucket, value) && (counts[index] ?? 0) < bucket.count,
    );
    const index = withRoom >= 0 ? withRoom : buckets.findIndex((bucket) => fits(bucket, value));
    if (index >= 0) counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts;
}

export function checkCurve(entries: readonly Entry[], profile: SkeletonLiteProfile): SetFinding[] {
  const found: SetFinding[] = [];
  for (const [key, bucket] of groupEntries(entries)) {
    const first = bucket[0];
    if (first === undefined) continue;
    const plan = planFor(profile, first.slot.rarity, first.slot.color);
    const creatures = bucket.filter((entry) => entry.card.kind === 'creature');
    const counts = fitCurve(
      creatures.map((entry) => cardManaValue(entry.card)),
      plan.creatureCurve,
    );
    const off = plan.creatureCurve
      .map((bucketPlan, index) => ({ bucketPlan, actual: counts[index] ?? 0 }))
      .filter((item) => Math.abs(item.actual - item.bucketPlan.count) > TOLERANCE);
    if (off.length === 0) continue;
    const detail = off
      .map(
        (item) =>
          `MV ${item.bucketPlan.mvMin}-${item.bucketPlan.mvMax}: ${item.actual}/${item.bucketPlan.count}`,
      )
      .join('; ');
    found.push(
      finding(
        'CURVE_MISMATCH',
        'error',
        `group ${key} misses its creature curve (${detail})`,
        creatures.map((entry) => entry.slot.id),
      ),
    );
  }
  return found;
}

/** The profile's plan for a rarity; a tier it does not allocate plans zero. */
function rarityTotalFor(profile: SkeletonLiteProfile, rarity: Rarity): number {
  const tier = SLICE_RARITIES.find((candidate) => candidate === rarity);
  return tier === undefined ? 0 : profile.rarityTotals[tier];
}

export function checkRarityTotals(entries: readonly Entry[], profile: SkeletonLiteProfile): SetFinding[] {
  const found: SetFinding[] = [];
  // Every tier the skeleton allocates, read off the constant rather than
  // written out: a hardcoded pair stopped checking when the rare tier landed, so
  // a 250-card run printing 18 or 20 rares against a planned 19 passed clean
  // (`mtg-lqyu`). A profile that allocates a tier no cards is checked for zero,
  // which is the true statement about it.
  // Every rarity the *DSL* has, not every tier the skeleton allocates. Iterating
  // `SLICE_RARITIES` counted a printed mythic nowhere at all: promoting eight
  // rares to mythic left the rare tier eight short (reported) and the eight
  // mythics unmentioned, so the finding named the wrong problem. A tier the
  // profile allocates nothing is expected to print nothing, which is the true
  // statement about it and the one that surfaces an unplanned promotion.
  for (const rarity of RARITIES) {
    const actual = entries.filter((entry) => entry.card.rarity === rarity).length;
    const expected = rarityTotalFor(profile, rarity);
    if (actual === expected) continue;
    found.push(
      finding(
        'RARITY_DISTRIBUTION',
        'error',
        `the set printed ${actual} ${rarity}s; the profile allocates ${expected}`,
        // Both sides of the disagreement: the slots planned at this rarity and
        // the cards printed at it. A mythic sits in no slot of its own, so
        // naming slots alone would report the count and point at nothing.
        entries
          .filter((entry) => entry.slot.rarity === rarity || entry.card.rarity === rarity)
          .map((entry) => entry.slot.id),
      ),
    );
  }
  return found;
}

export function checkDuplicateNames(entries: readonly Entry[]): SetFinding[] {
  const firstSeen = new Map<string, string>();
  const found: SetFinding[] = [];
  for (const entry of entries) {
    const key = entry.card.name.trim().toLowerCase();
    const earlier = firstSeen.get(key);
    if (earlier === undefined) {
      firstSeen.set(key, entry.slot.id);
      continue;
    }
    found.push(
      finding(
        'DUPLICATE_NAME',
        'error',
        `"${entry.card.name}" repeats the name already printed at ${earlier}; every card in a set needs a distinct name`,
        [entry.slot.id],
      ),
    );
  }
  return found;
}

/** `cards[7].id` -> 7. The DSL's set validators use this path format. */
const CARD_INDEX_PATTERN = /^cards\[(\d+)\]/;

export function checkSetUniqueness(entries: readonly Entry[]): SetFinding[] {
  const violations = validateSetUniqueness(entries.map((entry) => entry.card));
  return violations.flatMap((item): SetFinding[] => {
    // The token-name half of the pass is reported by `checkTokenNames` instead,
    // and passed over here so the report states the fact once. Both read the
    // same walk; only that one can blame slots. A token conflict is pathed
    // `tokens["Key"]`, so mapping it here would produce a finding naming no
    // slot, which the retry loop cannot act on.
    if (item.code === 'DUPLICATE_TOKEN_NAME') return [];
    const match = CARD_INDEX_PATTERN.exec(item.path);
    const index = match?.[1] === undefined ? -1 : Number(match[1]);
    const blamed = entries[index];
    const code = item.code === 'DUPLICATE_FINGERPRINT' ? 'DUPLICATE_MECHANICS' : 'DUPLICATE_IDENTITY';
    return [finding(code, 'error', item.message, blamed === undefined ? [] : [blamed.slot.id])];
  });
}

/**
 * A token name that two or more cards define incompatibly (`tokenNameConflicts`
 * in `@mtg/dsl`) blames every slot whose card prints one of the disagreeing
 * definitions, so the regeneration loop retries all of them rather than
 * silently keeping whichever the walk reached first.
 */
export function checkTokenNames(entries: readonly Entry[]): SetFinding[] {
  const byCardId = new Map<string, string>();
  for (const entry of entries) byCardId.set(entry.card.id, entry.slot.id);

  return tokenNameConflicts(entries.map((entry) => entry.card)).map((conflict) => {
    const slotIds = [...new Set(conflict.shapes.flatMap((shape) => shape.createdBy))]
      .map((cardId) => byCardId.get(cardId))
      .filter((slotId): slotId is string => slotId !== undefined);
    const shapes = conflict.shapes
      .map((shape) =>
        shape.card.kind === 'creature' ? `${shape.card.power}/${shape.card.toughness}` : 'artifact',
      )
      .join(' vs ');
    return finding(
      'DUPLICATE_TOKEN_NAME',
      'error',
      `"${conflict.name}" names ${conflict.shapes.length} incompatible tokens (${shapes}); one name cannot describe two tokens`,
      slotIds,
    );
  });
}

/**
 * Whether this card carries this mechanic: any one of the words the brief stated
 * it in, read off everywhere that word can be printed.
 *
 * "Any one of the words" is the split with `checkMechanicsPrinted`
 * (`mechanics.ts`), which takes the every-word reading; this one asks where the
 * mechanic is rather than how completely it is drawn.
 *
 * Where it reads is the half that had to be fixed. Both the effect and the
 * ability reading went through the card's own two lists, and for a permanent
 * neither list is where the mechanic is: `assemble.ts` stamps `effects: []` on
 * every generated creature and artifact, because a permanent prints its effects
 * inside its abilities, and Fuse is printed on a *token's* ability rather than on
 * the card that mints it. So the flagship set's `createToken` and `putCounters`
 * were unmatchable at common and Fuse was covered only by the bare word
 * "triggered" — and a mechanic stated as an effect kind with no ability kind, on
 * a set whose permanents print it, was reported absent from the set that prints
 * it. `printedEffectKinds` and `printedAbilityKinds` are the one walk every other
 * reader in this directory already used.
 */
function mechanicMatches(mechanic: DesiredMechanic, card: Card): boolean {
  const colorOk =
    mechanic.colors.length === 0 || card.colors.some((color) => mechanic.colors.includes(color));
  if (!colorOk) return false;
  const byKeyword = card.keywords.some((keyword) => mechanic.keywords.includes(keyword));
  const byEffect = printedEffectKinds(card).some(
    (kind) => isPricedEffectKind(kind) && mechanic.effectKinds.includes(kind),
  );
  // A mechanic stated as an ability kind is printed as an ability, so the
  // finished set is read back the same way it was asked for. Without this a
  // brief whose mechanic names only ability kinds could never be covered, and
  // "if the theme isn't at common, it isn't the theme" would fail every set that
  // put the theme exactly where the brief asked.
  const byAbility = printedAbilityKinds(card).some((kind) => mechanic.abilityKinds.includes(kind));
  return byKeyword || byEffect || byAbility;
}

/**
 * "If the theme isn't at common, it isn't the theme" (Nuts & Bolts #3). Every
 * requested mechanic must be printed on at least one common. When the allocator
 * could not place a mechanic at all, the finding is a warning naming that fact:
 * regenerating cards cannot fix a slot that was never allocated.
 */
export function checkMechanicCoverage(
  entries: readonly Entry[],
  mechanics: readonly DesiredMechanic[],
): SetFinding[] {
  const found: SetFinding[] = [];
  for (const mechanic of mechanics) {
    const commons = entries.filter(
      (entry) => entry.slot.rarity === 'common' && mechanicMatches(mechanic, entry.card),
    );
    if (commons.length > 0) continue;
    const allocated = entries.filter(
      (entry) => entry.slot.rarity === 'common' && entry.slot.mechanics.includes(mechanic.name),
    );
    if (allocated.length === 0) {
      found.push(
        finding(
          'MECHANIC_UNPLACEABLE',
          'warning',
          `mechanic "${mechanic.name}" was never allocated a common slot: the allocator places a mechanic only by its keywords, effect kinds or ability kinds, and none of those reached a common role in its colors`,
        ),
      );
      continue;
    }
    found.push(
      finding(
        'MECHANIC_ABSENT_AT_COMMON',
        'error',
        `mechanic "${mechanic.name}" appears on no common, though ${allocated.length} common slot(s) were allocated to it`,
        allocated.map((entry) => entry.slot.id),
      ),
    );
  }
  return found;
}

/**
 * Every card the brief required is in the set, by name.
 *
 * This is the structural half of the required-cards contract: the allocator
 * reserved a slot per name and the prompt carried the name to it, and here the
 * code reads the finished list back. A name printed on some other slot still
 * counts - the requirement is about the set, not about which slot obeyed - and
 * "exactly once" is `checkDuplicateNames`, which already rejects a set that
 * printed the same name twice.
 *
 * The finding blames the reserved slot, so a miss costs one regeneration
 * rather than a whole-set redo, and a critique revision that renames a required
 * card is reverted by the same path that reverts any other illegal revision.
 * `required-repair.test.ts` walks both: drop the blamed slot id from the finding
 * below and the retry round stops happening and the revision stands.
 */
export function checkRequiredCards(
  entries: readonly Entry[],
  slots: readonly Slot[],
  required: readonly RequiredCard[],
): SetFinding[] {
  if (required.length === 0) return [];
  const printedNames = new Set(entries.map((entry) => entry.card.name.trim()));
  const printedBySlot = new Map(entries.map((entry) => [entry.slot.id, entry.card]));
  const reservedFor = new Map<string, Slot>();
  for (const slot of slots) {
    if (slot.requiredCard !== undefined) reservedFor.set(slot.requiredCard.name.trim(), slot);
  }

  return required.flatMap((card): SetFinding[] => {
    if (printedNames.has(card.name.trim())) return [];
    const slot = reservedFor.get(card.name.trim());
    if (slot === undefined) {
      return [
        finding(
          'REQUIRED_CARD_MISSING',
          'error',
          `the brief requires a card named "${card.name}" and no slot was reserved for it`,
        ),
      ];
    }
    const printed = printedBySlot.get(slot.id);
    const instead = printed === undefined ? 'printed nothing' : `printed "${printed.name}"`;
    return [
      finding(
        'REQUIRED_CARD_MISSING',
        'error',
        `the brief requires a card named "${card.name}"; slot ${slot.id} was reserved for it and ${instead}`,
        [slot.id],
      ),
    ];
  });
}

/**
 * A spell role the brief stated for a tier that the finished set does not print.
 *
 * A stated role is not a promise the allocator can keep unconditionally, and
 * making it one would be the wrong trade. The skeleton derives spell slots per
 * set size, so a pool gets at most two rare spell slots at any size the profile
 * builds while `TierSpellRolesSchema` lets an author state eight; and
 * `applyStatedSpellRoles` deliberately runs *before* archetype reservation, the
 * required-card settlement and answer reservation, so a stated role is an input
 * those passes may still spend. the flagship set's own brief asks for exactly
 * that: it states a rare blue counterspell and its reason says the inert cap
 * will turn it into a body. A generator that refused to run whenever a human
 * over-specified past the slot budget would fail on a brief that is working as
 * designed, and refusing is not recoverable at the seat where it happens.
 *
 * So the outcome is reported rather than enforced, and it is reported as a
 * `warning`: warnings do not enter `failingSlotIds`, so nothing regenerates and
 * the set still ships, and they are printed by `formatReport` and carried into
 * the slice summary, so a reader of the finished set learns that a stated card
 * is missing without diffing the brief against the card list by hand. That is
 * the property this check exists for, and it is why it reads the *entries*
 * rather than the allocation: the claim is about what the set prints.
 *
 * One statement, at most one finding, and a group the skeleton did not build at
 * this size is silent - a brief that states rare roles and is then built at 75
 * cards is describing a tier the set does not have, which is the same silence
 * `applyStatedSpellRoles` already keeps for an empty group.
 */
export function checkStatedRoles(
  entries: readonly Entry[],
  slots: readonly Slot[],
  stated: readonly TierSpellRoles[],
): SetFinding[] {
  return stated.flatMap((statement): SetFinding[] => {
    const pool = slotPoolFor(statement.pool);
    const inGroup = (slot: Slot): boolean => slot.rarity === statement.rarity && slot.color === pool;
    if (!slots.some(inGroup)) return [];

    const printed = entries.filter((entry) => inGroup(entry.slot));
    const roles = new Set(printed.map((entry) => entry.slot.role));
    const missing = [...new Set(statement.roles)].filter((role) => !roles.has(role));
    if (missing.length === 0) return [];

    const group = `${statement.rarity} ${statement.pool}`;
    const instead =
      printed.length === 0
        ? 'that group prints nothing'
        : `that group prints ${[...roles].sort().join(', ')}`;
    return [
      finding(
        'STATED_ROLE_UNPRINTED',
        'warning',
        `the brief states the ${group} spell roles as ${statement.roles.join(', ')}, and the set prints ` +
          `no ${group} card in the ${missing.join(' or ')} role; ${instead}. ` +
          `The brief's stated reason was: ${statement.why}`,
      ),
    ];
  });
}

/**
 * A brief mechanic's keyword, requested in a color it names, that the finished
 * set does not print anywhere in that color's group.
 *
 * `emphasizeKeywords` (`allocate.ts`) tries to bend a color's keyword budget
 * toward every applicable mechanic, once per rarity that color prints, and it
 * declines two ways: the keyword is entirely off the color's pie, or the
 * group's budget has no token left to spend on an on-pie one. Both are noted
 * there, and a note is the allocator's own record - nobody greps notes. This
 * reads the *entries* instead, for the same reason `checkStatedRoles` does: a
 * signpost's payoff keyword (`archetype/assign.ts`'s `stampKeyword`) is chosen
 * from a plan's `payoffKeywords`, which can repeat the exact keyword a mechanic
 * asked for, and it is stamped independently of the budget `emphasizeKeywords`
 * declined to spend. A finding raised off the note alone would be a false
 * positive on that path.
 *
 * A color entirely off a keyword's pie can never carry it, at any rarity, so
 * that half is reported once per (mechanic, color) rather than once per group -
 * repeating the same unfixable fact five times would not tell a reader
 * anything the first sentence did not. The budget half is genuinely
 * per-(mechanic, color, rarity), because each rarity's group has its own
 * budget and a request can succeed at one and fail at another, exactly as it
 * does for the flagship set's own `Glasscut` mechanic in `allocate.test.ts`.
 *
 * A warning, not an error, and for the same reason `STATED_ROLE_UNPRINTED` is
 * one: nothing here is a promise the allocator can keep unconditionally, so
 * nothing regenerates and the set still ships. A group a size this small does
 * not build is silent, the same silence `checkStatedRoles` keeps for a tier the
 * skeleton did not build at all.
 */
export function checkMechanicKeywordUnprinted(
  entries: readonly Entry[],
  slots: readonly Slot[],
  mechanics: readonly DesiredMechanic[],
): SetFinding[] {
  return mechanics.flatMap((mechanic): SetFinding[] => {
    if (mechanic.keywords.length === 0) return [];
    const colors = mechanic.colors.length === 0 ? COLORS : mechanic.colors;
    return colors.flatMap((color): SetFinding[] => {
      if (!slots.some((slot) => slot.color === color)) return [];
      const onPie = mechanic.keywords.filter((keyword) => classify(keyword, color).verdict !== 'fail');
      if (onPie.length === 0) {
        return [
          finding(
            'MECHANIC_KEYWORD_UNPRINTED',
            'warning',
            `mechanic "${mechanic.name}" asks for keyword(s) ${mechanic.keywords.join(', ')} in ${color}, and ` +
              `none of them are on ${color}'s color pie; the set can print no such keyword there.`,
          ),
        ];
      }
      return SLICE_RARITIES.flatMap((rarity): SetFinding[] => {
        const group = slots.filter((slot) => slot.rarity === rarity && slot.color === color);
        if (group.length === 0) return [];
        const printed = entries.filter((entry) => entry.slot.rarity === rarity && entry.slot.color === color);
        const hasKeyword = printed.some((entry) =>
          entry.card.keywords.some((keyword) => onPie.includes(keyword)),
        );
        if (hasKeyword) return [];
        return [
          finding(
            'MECHANIC_KEYWORD_UNPRINTED',
            'warning',
            `mechanic "${mechanic.name}" asks for keyword(s) ${onPie.join(', ')} in ${rarity} ${color}, and the ` +
              `set prints none of them there.`,
          ),
        ];
      });
    });
  });
}
