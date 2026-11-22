import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns only the reviewed Goldspan and Magda Treasure routes', () => {
  it('pins Goldspan Dragon’s granted two-mana Treasure ability', () => {
    expect(bridge).toContain('isReviewedGoldspanTreasureManaAbility');
    expect(bridge).toContain('"Treasure Token".equals(source.getName())');
    expect(bridge).toContain('source.isToken()');
    expect(bridge).toContain('source.getType().hasSubtype("Treasure")');
    expect(bridge).toContain('"Goldspan Dragon".equals(card.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.Mana');
    expect(bridge).toContain('"Any".equals(ability.getParam("Produced"))');
    expect(bridge).toContain('"2".equals(ability.getParam("Amount"))');
    expect(bridge).toContain('!ability.isIntrinsic()');
    expect(bridge).toContain('isReviewedGoldspanTreasureSacrificeCost');
    expect(bridge).toContain('"1".equals(cost.getAmount())');
    expect(bridge).toContain('"CARDNAME".equals(cost.getType())');
    expect(bridge).toContain('cost.payCostFromSource()');
    expect(bridge).toContain(
      'Forge reached a Goldspan-granted Treasure ability outside its exact reviewed route',
    );
  });

  it('pins Magda’s activation and chooses five distinct live controlled Treasures', () => {
    expect(bridge).toContain('isReviewedMagdaSearchAbility');
    expect(bridge).toContain('"Magda, Brazen Outlaw".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.ChangeZone');
    expect(bridge).toContain('"Library".equals(ability.getParam("Origin"))');
    expect(bridge).toContain('"Battlefield".equals(ability.getParam("Destination"))');
    expect(bridge).toContain('"Card.Artifact,Card.Dragon".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('isReviewedMagdaTreasureSacrificeCost');
    expect(bridge).toContain('"5".equals(cost.getAmount())');
    expect(bridge).toContain('"Treasure".equals(cost.getType())');
    expect(bridge).toContain('chooseMagdaTreasureSacrificeCost');
    expect(bridge).toContain('while (chosen.size() < required)');
    expect(bridge).toContain('chosen.contains(card)');
    expect(bridge).toContain('"cost-sacrifice-cancel"');
    expect(bridge).toContain('selected Magda Treasure sacrifice became illegal');
    expect(bridge).toContain('reviewedMagdaSearch');
  });
});
