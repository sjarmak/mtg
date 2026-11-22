import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact remaining planeswalker boundary', () => {
  it('pins Gideon, Jace, and Chandra to their exact single-target loyalty abilities', () => {
    expect(bridge).toContain('isReviewedRemainingPlaneswalkerSingleTarget');
    expect(bridge).toContain('case "Gideon, Battle-Forged"');
    expect(bridge).toContain('case "Jace, Telepath Unbound"');
    expect(bridge).toContain('case "Chandra, Acolyte of Flame"');
    expect(bridge).toContain('"Creature.OppCtrl".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('"UntilYourNextTurn".equals(ability.getParam("Duration"))');
    expect(bridge).toContain('"Instant.YouCtrl,Sorcery.YouCtrl".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('"Instant.YouCtrl+cmcLE3,Sorcery.YouCtrl+cmcLE3".equals(');
    expect(bridge).toContain('reviewedRemainingPlaneswalkerTarget');
    expect(bridge).toContain(
      'Forge reached a remaining planeswalker target outside its exact reviewed route',
    );
    expect(bridge).toContain('Forge offered a target outside reviewed-remaining-planeswalker-targets-v1');
  });

  it('pins Nissa to an exact optional Forest search and zero-to-six land ultimate', () => {
    expect(bridge).toContain('case "Nissa, Vastwood Seer" -> destination == ZoneType.Hand');
    expect(bridge).toContain('"Forest.Basic".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('!card.isBasicLand() || !card.getType().hasSubtype("Forest")');
    expect(bridge).toContain('isReviewedNissaSageAnimistUltimate');
    expect(bridge).toContain('chooseNissaSageAnimistTargets');
    expect(bridge).toContain('ability.getMinTargets() == 0');
    expect(bridge).toContain('ability.getMaxTargets() == 6');
    expect(bridge).toContain('"6".equals(animate.getParam("Power"))');
    expect(bridge).toContain('"Permanent".equals(animate.getParam("Duration"))');
    expect(bridge).toContain(
      'Forge reached Nissa multiple targeting outside reviewed-nissa-sage-animist-ultimate-v1',
    );
    expect(bridge).toContain("Forge offered a target outside Nissa's exact land profile");
  });

  it('pins Jace Vryn to the exact loot-and-transform discard chain', () => {
    expect(bridge).toContain('"Jace, Vryn\'s Prodigy".equals(source.getName())');
    expect(bridge).toContain('parent.getApi() == ApiType.Draw');
    expect(bridge).toContain('"TgtChoose".equals(ability.getParam("Mode"))');
    expect(bridge).toContain('"GE5".equals(jaceExile.getParam("ConditionSVarCompare"))');
    expect(bridge).toContain('"True".equals(jaceReturn.getParam("Transformed"))');
    expect(bridge).toContain('"Count$ValidGraveyard Card.YouOwn".equals(source.getSVar("X"))');
    // This test owns Chart/Seeker/DrawThenDiscard's membership in the fallback negation;
    // a later set's own && !reviewedX can land between these three names.
    expect(bridge).toMatch(
      /!reviewedChart\s*(?:&&\s*!\w+\s*)*&&\s*!reviewedSeekerOfInsight\s*(?:&&\s*!\w+\s*)*&&\s*!reviewedDrawThenDiscard/u,
    );
    expect(bridge).toContain('&& !reviewedGateToTheAfterlife');
    // This test owns Jace and EachPlayerSelfDiscard's membership in the same fallback
    // negation; a later set's own && !reviewedX can land between the two.
    expect(bridge).toMatch(/&&\s*!reviewedJace\s*(?:&&\s*!\w+\s*)*&&\s*!reviewedEachPlayerSelfDiscard/u);
    expect(bridge).toContain('Forge reached discard selection outside reviewed-singleton-discard-v4');
  });
});
