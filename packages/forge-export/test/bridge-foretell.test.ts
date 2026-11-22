import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');
const foretellBoundary = bridge.slice(
  bridge.indexOf('private static boolean isReviewedForetellAbility('),
  bridge.indexOf('private static boolean isReviewedFreeCounterspellAlternativeAbility('),
);

describe('Forge bridge exact Foretell boundary', () => {
  it('pins only the two reviewed source identities and the exact keyword-generated action', () => {
    expect(bridge).toContain('isReviewedForetellAbility');
    expect(bridge).toContain('source.getOriginalState(CardStateName.Original).getName()');
    expect(foretellBoundary).toContain('"Starnheim Unleashed".equals(name)');
    expect(foretellBoundary).toContain('"Alrund\'s Epiphany".equals(name)');
    expect(foretellBoundary).toContain('ability.isForetelling()');
    expect(foretellBoundary).toContain('"{2}".equals(mana)');
    expect(foretellBoundary).toContain('ZoneType.Hand');
    expect(foretellBoundary).toContain('"True".equals(ability.getParam("Secondary"))');
  });

  it('pins the later cast to an exact reviewed source, Foretold alternative cost, and exile', () => {
    expect(foretellBoundary).toContain('ability.isForetold()');
    expect(foretellBoundary).toContain('ZoneType.Exile');
    expect(foretellBoundary).toContain('"{X}{X}{W}".equals(mana)');
    expect(foretellBoundary).toContain('"{4}{U}{U}".equals(mana)');
    expect(foretellBoundary).toContain('source.isForetold()');
    expect(foretellBoundary).toContain('source.enteredThisTurn()');
  });

  it('requires every Foretell-shaped priority action on a reviewed source to match the boundary', () => {
    expect(bridge).toContain('reviewed Foretell ability drift');
    expect(bridge).toContain('reviewedForetellAbilities(player)');
  });
});
