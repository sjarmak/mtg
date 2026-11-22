/** Static boundary for the opening-hand reveal the bridge owns for the local seat. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns the opening-hand reveal and keeps it narrow', () => {
  it('overrides chooseSaToActivateFromOpeningHand for the local seat', () => {
    expect(bridge).toContain(
      'public List<SpellAbility> chooseSaToActivateFromOpeningHand(List<SpellAbility> usable)',
    );
    expect(bridge).toContain('session.chooseOpeningHandActions(getPlayer(), usable)');
    expect(bridge).toContain('"opening-hand-action"');
  });

  it('answers as a subset with a floor of zero, so revealing nothing is a move', () => {
    expect(bridge).toMatch(
      /"opening-hand-action",\s+"Reveal cards from your opening hand",\s+usable,\s+0,\s+usable\.size\(\)/u,
    );
  });

  it('admits the exact Leyline self-placement shape without admitting starting-player changes', () => {
    expect(bridge).toContain('outside reviewed-opening-hand-reveal-v1');
    expect(bridge).toContain('isReviewedOpeningHandAction(player, ability)');
    expect(bridge).toContain('api == ApiType.ChangeZone');
    expect(bridge).toContain('"Hand".equals(ability.getParam("Origin"))');
    expect(bridge).toContain('"Battlefield".equals(ability.getParam("Destination"))');
    expect(bridge).toContain('"Self".equals(ability.getParam("Defined"))');
    expect(bridge).toContain('ability.hasParam("BecomeStartingPlayer")');
    expect(bridge).toContain('keyword.getOriginal().startsWith("MayEffectFromOpeningHand")');
  });
});

describe('OPENING_HAND seeds the real pregame instead of the devMode phase jump', () => {
  it('branches runGame on the scenario phase without touching the MAIN1/COMBAT_BEGIN call', () => {
    expect(bridge).toContain('if (initial.isOpeningHand()) {');
    expect(bridge).toContain('initial.seedOpeningHand(game);');
    expect(bridge).toContain('match.startGame(game, () -> initial.applyAndVerify(game));');
  });

  it('seeds at GameEventGameStarted, after prepareAllZones has replaced the library with the deck', () => {
    expect(bridge).toContain('game.subscribeToEvents(new Object() {');
    expect(bridge).toContain('public void seedPregame(GameEventGameStarted started) {');
    expect(bridge).toContain('fail(error);');
  });

  it('pins starting hand size to zero so the unfiltered draw cannot disturb the seeded hand', () => {
    expect(bridge).toContain('player.setStartingHandSize(0);');
    expect(bridge).toContain(
      'player.getZone(ZoneType.Hand).setCards(scenarioCards(names(seat, "hand"), player));',
    );
  });

  it('refuses a declared battlefield or graveyard, and a non-zero active seat', () => {
    expect(bridge).toContain('OPENING_HAND seat may not declare');
    expect(bridge).toContain('OPENING_HAND active seat is fixed to 0 by Puzzle mode');
  });
});
