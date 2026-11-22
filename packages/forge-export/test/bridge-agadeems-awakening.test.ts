import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe("Forge bridge exact Agadeem's Awakening boundary", () => {
  it('pins the X-reanimation callback to the exact spell, zone, filter, and derivations', () => {
    expect(bridge).toContain('chooseAgadeemsAwakeningTargets');
    expect(bridge).toContain('isReviewedAgadeemsAwakeningTarget');
    expect(bridge).toContain('"Agadeem\'s Awakening".equals(source.getName())');
    expect(bridge).toContain('"Creature.YouOwn+cmcLEX".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('"Graveyard".equals(ability.getParam("Origin"))');
    expect(bridge).toContain('"Battlefield".equals(ability.getParam("Destination"))');
    expect(bridge).toContain('"0".equals(restrictions.getMinTargets())');
    expect(bridge).toContain('"Y".equals(restrictions.getMaxTargets())');
    expect(bridge).toContain('"Count$xPaid".equals(source.getSVar("X"))');
    expect(bridge).toContain('"Count$ValidGraveyard Creature.YouOwn".equals(source.getSVar("Y"))');
    expect(bridge).toContain('restrictions.isDifferentCMC()');
    expect(bridge).toContain('card.getOwner() != player');
    expect(bridge).toContain('card.getCMC() > xPaid');
  });

  it('keeps zero-target completion distinct from casting cancellation and checks each target again', () => {
    expect(bridge).toContain('"agadeem-targets-done"');
    expect(bridge).toContain('"target-cancel"');
    expect(bridge).toContain('if ("agadeem-targets-done".equals(selected.id)) return true;');
    expect(bridge).toContain('if ("target-cancel".equals(selected.id)) return false;');
    expect(bridge).toContain('ability.getTargets().add(target)');
    expect(bridge).toContain('ability.canTarget(candidate)');
  });

  it('pins the modal land entry choice to pay exactly three life or enter tapped', () => {
    expect(bridge).toContain('payAgadeemEntryLife');
    expect(bridge).toContain('"Agadeem, the Undercrypt".equals(source.getName())');
    expect(bridge).toContain('"3".equals(life.getAmount())');
    expect(bridge).toContain('ability.getApi() != ApiType.Tap');
    expect(bridge).toContain('"Self".equals(ability.getParam("Defined"))');
    expect(bridge).toContain('"PayLife<3>".equals(ability.getParam("UnlessCost"))');
    expect(bridge).toContain('"You".equals(ability.getParam("UnlessPayer"))');
    expect(bridge).toContain('"optional-cost-pay-life-3"');
    expect(bridge).toContain('PaymentDecision.number(3)');
  });
});
