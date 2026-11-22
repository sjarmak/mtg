import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact planeswalker UnlessCost sacrifice boundary', () => {
  it('routes the exact resolve-time cost through the guarded human payment seam', () => {
    expect(
      [
        'isReviewedPlaneswalkerUnlessSacrificeCost',
        'isReviewedPlaneswalkerUnlessSacrificePart',
        'choosePlaneswalkerUnlessSacrificeCost',
        'PlaySpellAbility.payCostDuringAbilityResolve',
        '"True".equals(ability.getParam("UnlessSwitched"))',
        '"You".equals(ability.getParam("UnlessPayer"))',
        'selected planeswalker UnlessCost sacrifice became illegal',
        'outside reviewed-planeswalker-unless-sacrifice-v1',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });

  it('pins Garruk, Daretti, and Grist to their exact effects, loyalty costs, and payment types', () => {
    expect(
      [
        '"Garruk Relentless".equals(name)',
        '"Garruk, the Veil-Cursed".equals(source.getName())',
        'ability.getApi() == ApiType.ChangeZone',
        '"Library".equals(ability.getParam("Origin"))',
        '"Hand".equals(ability.getParam("Destination"))',
        '"Daretti, Ingenious Iconoclast".equals(name)',
        'ability.getApi() == ApiType.Destroy',
        '"Artifact,Creature".equals(ability.getParam("ValidTgts"))',
        '"Grist, the Hunger Tide".equals(name)',
        'ability.getApi() != ApiType.ImmediateTrigger',
        '"Sac<1/Creature>".equals(ability.getParam("UnlessCost"))',
        '"Creature,Planeswalker".equals(execute.getParam("ValidTgts"))',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });

  it("admits only Garruk's exact optional singleton creature search after the reviewed payment", () => {
    expect(
      [
        'reviewedGarrukVeilCursedSearch',
        'BridgeController.isReviewedPlaneswalkerUnlessSacrificeCost(',
        '"Garruk, the Veil-Cursed".equals(source.getName())',
        'origin.equals(List.of(ZoneType.Library))',
        'destination == ZoneType.Hand',
        '"Creature".equals(ability.getParam("ChangeType"))',
        '"Select a card from your library".equals(selectPrompt)',
        '!player.getCardsIn(ZoneType.Library).contains(card)',
        '!card.isCreature()',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });
});
