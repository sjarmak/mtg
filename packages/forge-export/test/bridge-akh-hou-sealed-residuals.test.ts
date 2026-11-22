/** Exact bridge boundaries for interaction families found by the AKH/HOU sealed sweep. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('AKH/HOU sealed residual guards', () => {
  it('owns only Authority’s exact optional two-creature target block', () => {
    expect(bridge).toContain('isReviewedAuthorityTarget(ability)');
    expect(bridge).toContain('"Authority".equals(source.getName())');
    expect(bridge).toContain('"Creature.OppCtrl".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('ability.getMinTargets() == 0 && ability.getMaxTargets() == 2');
  });

  it('owns only Kefnet’s exact optional land-return subability', () => {
    expect(bridge).toContain('boolean reviewedKefnetLandReturn =');
    expect(bridge).toContain('"Kefnet the Mindful".equals(source.getName())');
    expect(bridge).toContain('"Land.YouCtrl".equals(ability.getParam("ChangeType"))');
    // Kefnet and Yorion select the battlefield beside Doomfall; a later set adds its own
    // return to the same selector (Kaladesh added Cloudstone Curio's), so tolerate terms
    // anywhere between the three rather than repinning this file per set.
    expect(bridge).toMatch(
      /reviewedYorionBattlefieldExile\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedKefnetLandReturn\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedDoomfallBattlefieldZoneChange\s*\? ZoneType\.Battlefield/u,
    );
  });

  it('owns Unwavering Initiate’s exact embalm source-exile cost', () => {
    expect(bridge).toContain('isReviewedUnwaveringInitiateEmbalmAbility(ability)');
    expect(bridge).toContain('"Unwavering Initiate".equals(reviewedSourceName(ability.getHostCard()))');
    expect(bridge).toContain('"{4}{W}".equals(mana.getMana().getSimpleString())');
  });

  it('owns Champion of Rhonas’s exact optional creature placement from hand', () => {
    expect(bridge).toContain('boolean reviewedChampionOfRhonasHandPlacement =');
    expect(bridge).toContain('"Champion of Rhonas".equals(source.getName())');
    expect(bridge).toContain('"Creature".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('"DB$ ChangeZone | Origin$ Hand | Destination$ Battlefield');
    // Champion's placement is one exemption in the hidden-hand refusal; a later set adds its
    // own && !reviewedX between it and the composite guard.
    expect(bridge).toMatch(
      /!reviewedHiddenHandZoneChange\s*(?:&&\s*!\w+\s*)*&&\s*!reviewedChampionOfRhonasHandPlacement/u,
    );
  });

  it('binds Steadfast Sentinel to the reusable exact Eternalize profile', () => {
    expect(bridge).toContain('isReviewedSteadfastSentinelEternalizeAbility(ability)');
    expect(bridge).toMatch(
      /isReviewedEternalizeAbility\(\s*ability, "Steadfast Sentinel", "\{4\}\{W\}\{W\}", "Human", "Cleric"\)/u,
    );
    expect(bridge).toContain('Forge reached Steadfast Sentinel outside its exact reviewed Eternalize route');
  });

  it('orders Unconventional Tactics through the general wrapped optional-trigger boundary', () => {
    expect(bridge).toContain('isReviewedSimultaneousOptionalTrigger(ability, player)');
    expect(bridge).toContain('ability instanceof WrappedAbility wrapper');
    expect(bridge).toContain('wrapped.getHostCard() == source');
    expect(bridge).toContain('wrapped.getTrigger() == trigger');
    expect(bridge).toContain('wrapped.getActivatingPlayer() == player');
    expect(bridge).toContain('trigger.getHostCard() == source');
    expect(bridge).toContain('ability.getActivatingPlayer() == player');
  });
});
