/** Static boundary for Liliana of the Veil's exact TwoPiles ultimate. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("the Forge bridge owns only Liliana of the Veil's reviewed choices", () => {
  it('pins the whole TwoPiles ability and its resolved sacrifice SVar', () => {
    expect(bridge).toContain('isReviewedLilianaTwoPilesAbility');
    expect(bridge).toContain('"Liliana of the Veil".equals(source.getName())');
    expect(bridge).toContain('ability.getApi() == ApiType.TwoPiles');
    expect(bridge).toContain('ability.getParent() == null');
    expect(bridge).toContain('ability.getTargets().size() == 1');
    expect(bridge).toContain('ability.getTargets().contains(player)');
    expect(bridge).toContain('"You".equals(ability.getParam("Separator"))');
    expect(bridge).toContain('"DBSacAll".equals(ability.getParam("ChosenPile"))');
    expect(bridge).toContain('"Permanent".equals(ability.getParam("ValidCards"))');
    expect(bridge).toContain('"Battlefield".equals(ability.getParam("Zone"))');
    expect(bridge).toContain('"Worst".equals(ability.getParam("AILogic"))');
    expect(bridge).toContain('"6".equals(loyalty.getAmount())');
    expect(bridge).toContain('"CARDNAME".equals(loyalty.getType())');
    expect(bridge).toContain('loyalty.payCostFromSource()');
    expect(bridge).toContain('"Loyalty".equals(loyalty.counter.getName())');
    expect(bridge).toContain(
      '"DB$ SacrificeAll | ValidCards$ Permanent.IsRemembered".equals(source.getSVar("DBSacAll"))',
    );
  });

  it('keeps both live callbacks inside exact battlefield partitions', () => {
    expect(bridge).toContain('chooseLilianaTwoPilesPartition');
    expect(bridge).toContain('"Divide cards into two piles".equals(title)');
    expect(bridge).toContain('max != sourceList.size()');
    expect(bridge).toContain('sourceList.size() != battlefield.size()');
    expect(bridge).toContain('!sourceList.containsAll(battlefield)');
    expect(bridge).toContain('chooseLilianaPile');
    expect(bridge).toContain('"False".equals(faceUp)');
    expect(bridge).toContain('Collections.disjoint(first, second)');
    expect(bridge).toContain('union.size() != battlefield.size()');
    expect(bridge).toContain('outside reviewed-liliana-two-piles-v1');
  });

  it('opens the exact singleton +1 discard without widening the shared callback', () => {
    const structuralStart = bridge.indexOf('private boolean isReviewedEachPlayerSingletonSelfDiscard(');
    const structuralEnd = bridge.indexOf('\n        private ', structuralStart + 1);
    const structuralBoundary = bridge.slice(structuralStart, structuralEnd);

    expect(structuralStart).toBeGreaterThanOrEqual(0);
    expect(structuralBoundary).not.toContain('Liliana of the Veil');
    expect(structuralBoundary).toContain('discardingPlayer != player');
    expect(structuralBoundary).toContain('ability.getActivatingPlayer() == null');
    expect(structuralBoundary).toContain(
      'ability.getHostCard().getController() != ability.getActivatingPlayer()',
    );
    expect(structuralBoundary).toContain('ability.getApi() != ApiType.Discard');
    expect(structuralBoundary).toContain('!ability.isActivatedAbility()');
    expect(structuralBoundary).toContain('ability.isTrigger()');
    expect(structuralBoundary).toContain('ability.isCopied()');
    expect(structuralBoundary).toContain('ability.usesTargeting()');
    expect(structuralBoundary).toContain('ability.getTargetRestrictions() != null');
    expect(bridge).toContain('"1".equals(ability.getParam("NumCards"))');
    expect(bridge).toContain('"Player".equals(ability.getParam("Defined"))');
    expect(structuralBoundary).toContain('"TgtChoose".equals(ability.getParam("Mode"))');
    expect(bridge).toContain('!ability.hasParam("ValidTgts")');
    expect(structuralBoundary).toContain('min != 1');
    expect(structuralBoundary).toContain('max != 1');
    expect(structuralBoundary).toContain('alreadyChosen != validCards');
    expect(structuralBoundary).toContain('ability.getMapParams().keySet().equals(Set.of(');
    expect(structuralBoundary).toContain('CostPutCounter.class');
    expect(structuralBoundary).toContain('"1".equals(loyalty.getAmount())');
    expect(structuralBoundary).toContain('"Loyalty".equals(loyalty.getCounter().getName())');
    expect(structuralBoundary).toContain('discardingPlayer.getCardsIn(ZoneType.Hand).contains(card)');
    expect(bridge).toContain('boolean reviewedEachPlayerSelfDiscard =');
    expect(bridge).toContain('outside reviewed-singleton-discard-v4');
  });
});
