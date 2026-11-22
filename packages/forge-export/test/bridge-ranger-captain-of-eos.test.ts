import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("the Forge bridge owns only Ranger-Captain of Eos's reviewed routes", () => {
  it('pins the optional search to its exact source, filter, destination, and cardinality', () => {
    expect(bridge).toContain('case "Ranger-Captain of Eos" -> destination == ZoneType.Hand');
    expect(bridge).toContain('"Creature.cmcLE1".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('"1".equals(ability.getParam("ChangeNum"))');
    expect(bridge).toContain('"True".equals(ability.getParam("ShuffleNonMandatory"))');
    expect(bridge).toContain('"Select a card from your library".equals(selectPrompt)');
  });

  it('pins the activated Effect and fixed-source sacrifice before automatic payment', () => {
    expect(bridge).toContain('isReviewedRangerCaptainEffect(SpellAbility ability)');
    expect(bridge).toContain('ability.getApi() != ApiType.Effect');
    expect(bridge).toContain('"STCantBeCast".equals(ability.getParam("StaticAbilities"))');
    expect(bridge).toContain('parts.get(0).getClass() != CostSacrifice.class');
    expect(bridge).toContain('sacrifice.payCostFromSource()');
    expect(bridge).toContain('&& !session.isReviewedRangerCaptainEffect(ability)');
    expect(bridge).toContain('(ability.isSpell() || ability.isActivatedAbility())');
    expect(bridge).toContain('!ability.checkRestrictions(ability.getHostCard(), player)');
  });
});
