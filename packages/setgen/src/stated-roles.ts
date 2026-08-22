/**
 * The brief's stated spell roles, applied to the profile before anything is
 * allocated.
 *
 * The skeleton profile gives every tier of every pool the *head* of that color's
 * common spell-slot list, because that list is the only one the published
 * profile has: `skeleton-lite.ts`'s own INFERRED note records that there is no
 * rare slot table to copy. At a tier that prints one spell, the head of a common
 * list is the cheap staple a common pool leads with, which is the right card at
 * common and the wrong card at the tier a set may print a bomb at (`mtg-j3bp`).
 *
 * This pass is the whole of the fix, and it is deliberately three lines of
 * arithmetic wrapped in a lot of stated reasoning. Which roles a tier deserves
 * is design judgment; ordering the role table by power in code would be the
 * heuristic ZFC delegates, and writing that order into the profile would publish
 * ratings the source document never stated. So the author states the roles and
 * the reason in the brief, and this pass cycles them over the slots the skeleton
 * already allocated.
 *
 * # Where it runs, and why first
 *
 * First: before archetype reservation, before the required-card settlement,
 * before answer reservation. A stated role is therefore an input to those three
 * passes rather than an override of them, and every rule they enforce still
 * holds over it — a color's inert budget, a pair's answer floor, a named card's
 * seat. That matters in a way an author will meet: a role whose only legal
 * effects cannot touch the battlefield is still capped at one card per color and
 * still converted to a body, so stating a counterspell at rare in a set that
 * already prints a cantrip at common gets a creature and a note saying which
 * slot went and why. Running last instead would silence those passes, and their
 * checks would then fail the finished set instead.
 *
 * # What it moves
 *
 * The role names of one group, and nothing else. Card count, creature share,
 * curve, keyword budget and the rarity split are the profile's exactly as they
 * were, and the cost window a role prints at is the role table's fixed window or
 * the group's own spell curve, neither of which this pass touches.
 *
 * A tier the skeleton did not build is silent rather than noisy. The rare tier
 * is derived per set size and a small set has none at all, so a brief that
 * states rare roles and is then built at 75 cards would otherwise report six
 * sentences about a tier the set does not have — the same sentence the allocator
 * already declines to print when it skips an empty group.
 */
import type { SkeletonLiteProfile, SliceGroupPlan, SliceRarityPlans } from '@mtg/design-data';
import { cycleRoles } from '@mtg/design-data';
import type { Color } from '@mtg/dsl';
import type { SetBrief, TierSpellRoles } from './brief';
import { slotPoolFor } from './brief';

export interface StatedRoleApplication {
  /** The profile with every stated tier's roles replaced. */
  readonly profile: SkeletonLiteProfile;
  /** One note per statement that reached a group, plus one per statement that could not. */
  readonly notes: readonly string[];
}

function poolName(pool: Color | null): string {
  return pool ?? 'colorless';
}

/**
 * One statement applied to one pool's plans, or `undefined` when nothing moved.
 *
 * Three ways nothing moves, and only one of them is worth a note. A tier the
 * skeleton did not build is silent (see the file docblock). A tier with no spell
 * slot is a note, because the group exists and the author's statement reached
 * nothing. Roles that already match are silent, because the statement and the
 * profile agree and there is nothing to report.
 *
 * A statement longer than the group is the fourth case, and it used to be the
 * one silent path here that had no argument behind it. `cycleRoles` truncates,
 * so a brief stating two rare roles into a group with one spell slot loses the
 * second one and the note said only what the first one became. The rare tier is
 * where this bites: the derivation gives a pool at most two rare spell slots at
 * any set size, and the schema lets an author state eight. So the roles that did
 * not fit are named on the same line, and `checkStatedRoles` reads the same
 * statement back off the finished set for a reader who never sees the notes.
 */
function applyToPool(
  plans: SliceRarityPlans,
  stated: TierSpellRoles,
  notes: string[],
): SliceRarityPlans | undefined {
  const pool = slotPoolFor(stated.pool);
  const plan = plans[stated.rarity];
  if (plan.cards === 0) return undefined;
  if (plan.spells === 0) {
    notes.push(
      `${stated.rarity} ${poolName(pool)}: the brief states ${stated.roles.join(', ')} here, ` +
        'and the skeleton allocated the group no spell slot to print any of them in.',
    );
    return undefined;
  }
  const roles = cycleRoles(stated.roles, plan.spells);
  if (
    roles.length === plan.spellRoles.length &&
    roles.every((role, index) => role === plan.spellRoles[index])
  ) {
    return undefined;
  }
  const next: SliceGroupPlan = { ...plan, spellRoles: roles };
  const dropped = stated.roles.slice(roles.length);
  notes.push(
    `${stated.rarity} ${poolName(pool)}: the brief states this tier's spell roles as ${roles.join(', ')}, ` +
      `replacing ${plan.spellRoles.join(', ')} from the pool's common slot list. ${stated.why}` +
      (dropped.length === 0
        ? ''
        : ` The group has ${plan.spells} spell slot(s) and the brief states ${stated.roles.length} role(s), ` +
          `so ${dropped.join(', ')} did not fit and the set prints no such card at this tier.`),
  );
  return { ...plans, [stated.rarity]: next };
}

/**
 * Replaces the stated tiers' spell roles. Deterministic and model-free: a brief
 * that states none gets its profile back, the same object, with no notes.
 */
export function applyStatedSpellRoles(profile: SkeletonLiteProfile, brief: SetBrief): StatedRoleApplication {
  if (brief.spellRoles.length === 0) return { profile, notes: [] };

  const notes: string[] = [];
  const colors = { ...profile.colors };
  let colorless = profile.colorless;
  let moved = false;

  for (const stated of brief.spellRoles) {
    const pool = slotPoolFor(stated.pool);
    const before = pool === null ? colorless : colors[pool];
    const after = applyToPool(before, stated, notes);
    if (after === undefined) continue;
    moved = true;
    if (pool === null) colorless = after;
    else colors[pool] = after;
  }

  if (!moved) return { profile, notes };
  return { profile: { ...profile, colors, colorless }, notes };
}
