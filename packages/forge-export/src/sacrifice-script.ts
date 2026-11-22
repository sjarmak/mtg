/** Source-proven Forge selector used inside `Sac<count/filter>`. */
import type { SacrificeMatching } from '@mtg/dsl';
import { forgeFilteredTargets } from './vocabulary-map';

export function forgeSacrificeMatching(
  sacrifice: SacrificeMatching & { readonly excludeSource?: true | undefined },
): string | null {
  const members = forgeFilteredTargets('Permanent', sacrifice.filter, 'base');
  if (members?.length !== 1) return null;
  const member = members[0];
  if (member === undefined) return null;
  const selected = sacrifice.nontoken === true ? `${member}.!token/nontoken ${member}` : member;
  if (sacrifice.excludeSource !== true) return selected;
  return member === 'Creature' && sacrifice.nontoken !== true ? 'Creature.Other/another creature' : null;
}
