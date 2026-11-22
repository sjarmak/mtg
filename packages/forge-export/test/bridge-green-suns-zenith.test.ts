/** Static boundary checks complement the real-Forge outcome regression. */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

it('admits only the reviewed Zenith chain without widening singleton spells', () => {
  const start = bridge.indexOf('boolean reviewedGreenSunsZenith =');
  const end = bridge.indexOf('boolean singletonLibrarySpell =', start);
  expect(start).toBeGreaterThan(0);
  const guard = bridge.slice(start, end);
  for (const condition of [
    '"Green Sun\'s Zenith".equals(source.getName())',
    '"Creature.Green+cmcLEX".equals(ability.getParam("ChangeType"))',
    'zenithShuffle.getParent() == ability',
    'zenithShuffle.getSubAbility() == null',
    '"Stack".equals(zenithShuffle.getParam("Origin"))',
    '"Library".equals(zenithShuffle.getParam("Destination"))',
    '"True".equals(zenithShuffle.getParam("Shuffle"))',
    '"Parent".equals(zenithShuffle.getParam("Defined"))',
    'Set.of("DB", "Origin", "Destination", "Shuffle", "Defined")',
  ])
    expect(guard).toContain(condition);
  expect(bridge.slice(end, end + 180)).toContain('&& ability.getSubAbility() == null');
  // This test owns reviewedGreenSunsZenith's membership in the library-search disjunction
  // beside Vizier of the Anointed's own guard; a later set can add its own reviewed search
  // before, between, or after either name.
  expect(bridge).toMatch(
    /\|\|\s*reviewedGreenSunsZenith\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedVizierOfTheAnointedSearch(?:\s*\|\|\s*\w+)*;/u,
  );
  expect(bridge).toContain('|| !card.isCreature() || !card.isGreen()');
  expect(bridge).toContain('card.getCMC() > ability.getXManaCostPaid()');
});
