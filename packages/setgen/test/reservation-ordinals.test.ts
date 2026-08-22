import { describe, expect, it } from 'vitest';
import { COLORS } from '@mtg/dsl';
import {
  deriveSkeletonLite,
  MAX_SLICE_TARGET_SIZE,
  MIN_SLICE_TARGET_SIZE,
  SLICE_RARITIES,
} from '@mtg/design-data';
import { allocateSlots, parseBrief, reserveArchetypes } from '@mtg/setgen';
import { TEST_BRIEF } from './helpers';

/**
 * Archetype reservation removes the role it converted, at the ordinal that role
 * still occupies.
 *
 * `reserveColor` converts several inert spell slots in one pass, and each
 * conversion drops one entry from `spellRoles` by ordinal. Every drop shifts the
 * ordinals of everything after it, so the conversions have to be applied in
 * descending ordinal order or a later drop reads a stale position. The pass
 * ordered them by the *keep preference* instead (mana value, then role name),
 * reversed, which is descending ordinal only by luck.
 *
 * When the luck ran out the drop fell off the end of the array and removed
 * nothing, while the plan's `spells` count went down anyway. The group then held
 * more roles than spells, `allocateGroup` built a slot per role, and
 * `allocateSlots` threw "allocated 251 slots for a 250-card profile; the profile
 * is inconsistent" - for every set of 99 cards or more, which is every set size
 * the flagship could ship at. the set design document, decision 3 is
 * "roughly 250 cards".
 */
describe('archetype reservation keeps a role for every spell it plans', () => {
  it('holds at every set size the profile can be derived at', () => {
    const broken: string[] = [];
    // The bounds are the derivation's own, so "every set size" is every size it
    // will build rather than every size this file thought to try.
    for (let targetSize = MIN_SLICE_TARGET_SIZE; targetSize <= MAX_SLICE_TARGET_SIZE; targetSize += 1) {
      const reserved = reserveArchetypes(deriveSkeletonLite({ targetSize })).profile;
      for (const color of COLORS) {
        for (const rarity of SLICE_RARITIES) {
          const plan = reserved.colors[color][rarity];
          if (plan.spellRoles.length === plan.spells) continue;
          broken.push(
            `${targetSize} ${rarity} ${color}: ${plan.spellRoles.length} role(s) for ${plan.spells} spell(s)`,
          );
        }
      }
    }
    expect(broken).toStrictEqual([]);
  });

  it('allocates a set at the size the flagship states', () => {
    const slots = allocateSlots(parseBrief({ ...TEST_BRIEF, targetSize: 250 })).slots;
    expect(slots).toHaveLength(250);
  });
});
