/** Static refusal boundary for the reviewed optional library-search routes. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns only the reviewed optional library searches', () => {
  it('admits bounded optional single-card callbacks by structure rather than source name', () => {
    expect(bridge).toContain('boolean reviewedBoundedOptionalZoneChoice =');
    expect(bridge).toContain('isReviewedVariableBasicLandSearch(');
    expect(bridge).toContain('isReviewedEachPlayerPermanentPlacement(');
    expect(bridge).toContain('reviewedBoundedOptionalZoneCandidate(');
    expect(bridge).toContain('"zone-decline", "Find no card"');

    const start = bridge.indexOf('private boolean isReviewedVariableBasicLandSearch(');
    const end = bridge.indexOf('private boolean isReviewedEachPlayerPermanentPlacement(', start);
    const variableSearch = bridge.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(variableSearch).not.toContain('Harvest Season');

    const placementEnd = bridge.indexOf('private boolean reviewedBoundedOptionalZoneCandidate(', end);
    const eachPlayerPlacement = bridge.slice(end, placementEnd);
    expect(placementEnd).toBeGreaterThan(end);
    expect(eachPlayerPlacement).not.toContain('Show and Tell');
  });

  it('pins both structural profiles and verifies every submitted card in its origin again', () => {
    expect(bridge).toContain('"Count$Valid Creature.tapped+YouCtrl".equals(ability.getSVar("X"))');
    expect(bridge).toContain('"Land.Basic".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('"Creature,Artifact,Enchantment,Land".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('player.getCardsIn(ZoneType.Library).contains(card)');
    expect(bridge).toContain('player.getCardsIn(ZoneType.Hand).contains(card)');
    expect(bridge).toContain(
      'card.isCreature() || card.isArtifact() || card.isEnchantment() || card.isLand()',
    );
  });

  it('pins each singleton search to its exact source and callback shape', () => {
    expect(bridge).toContain('boolean reviewedOptionalLibrarySearch =');
    expect(bridge).toContain('case "Stoneforge Mystic" -> destination == ZoneType.Hand');
    expect(bridge).toContain('case "Solemn Simulacrum" -> destination == ZoneType.Battlefield');
    expect(bridge).toContain('case "Golos, Tireless Pilgrim" -> destination == ZoneType.Battlefield');
    expect(bridge).toContain('case "Ranger-Captain of Eos" -> destination == ZoneType.Hand');
    expect(bridge).toContain('"True".equals(ability.getParam("ShuffleNonMandatory"))');
    expect(bridge).toContain('"Select a card from your library".equals(selectPrompt)');
    // The four reviewed searches in order; a later set's own search can land between any two
    // of them or after the last, ahead of the closing paren.
    expect(bridge).toMatch(
      /\|\|\s*reviewedOptionalLibrarySearch\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedSearchForTomorrowSearch\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedSwordOfHearthAndHomeSearch\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedPathToExileSearch\s*(?:\|\|\s*\w+\s*)*\);/u,
    );
  });

  it('pins each multi-card search and verifies every candidate remains in the local library', () => {
    expect(bridge).toContain('REVIEWED_OPTIONAL_LIBRARY_MULTI_SEARCHES = Set.of(');
    expect(bridge).toContain('"Land Tax",\n                "Primeval Titan"');
    expect(bridge).toContain('void verifyReviewedOptionalLibraryCards(');
    expect(bridge).toContain('case "Land Tax" -> destination == ZoneType.Hand');
    expect(bridge).toContain('case "Primeval Titan" -> destination == ZoneType.Battlefield');
    expect(bridge).toContain('&& min == 0');
    expect(bridge).toContain('&& max == 3');
    expect(bridge).toContain('&& max == 2');
    expect(bridge).toContain('!player.getCardsIn(ZoneType.Library).contains(card)');
    expect(bridge).toContain('outside reviewed-optional-library-search-v1');
  });
});
