/** Compile the bridge and mutation-test targeted revealed-hand exile shapes. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { expect, it } from 'vitest';
import { compileInstalledForgeBridge, findForgeInstall } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

forgeIt(
  'accepts Night Terrors while rejecting adjacent hidden-zone shapes',
  () => {
    const install = findForgeInstall();
    const compiled = compileInstalledForgeBridge();
    if (install === null || compiled === null) throw new Error('Required installed Forge is absent');
    try {
      const source = join(compiled.classDirectory, 'TargetedRevealedHandExileProbe.java');
      writeFileSync(
        source,
        `
import forge.card.CardRarity;
import forge.card.CardRules;
import forge.game.ability.AbilityFactory;
import forge.game.card.Card;
import forge.game.card.CardFactory;
import forge.game.spellability.AbilitySub;
import forge.game.spellability.SpellAbility;
import forge.item.PaperCard;
import forge.util.Lang;
import forge.util.Localizer;
import java.util.List;

public class TargetedRevealedHandExileProbe {
  private static Card card() {
    return CardFactory.getCard(new PaperCard(
      CardRules.fromScript(List.of(
        "Name:Night Terrors",
        "ManaCost:2 B",
        "Types:Sorcery"
      )),
      "TST",
      CardRarity.Common
    ), null, null);
  }

  private static SpellAbility[] abilities(String rootScript, String change) {
    Card card = card();
    SpellAbility root = AbilityFactory.getAbility(rootScript, card);
    SpellAbility exile = AbilityFactory.getAbility(change, card);
    root.setSubAbility((AbilitySub) exile);
    return new SpellAbility[] { root, exile };
  }

  private static boolean accepts(SpellAbility ability) throws Exception {
    var method = Class.forName("ForgeBridge$BridgeSession").getDeclaredMethod(
      "isReviewedTargetedRevealedHandExile",
      SpellAbility.class
    );
    method.setAccessible(true);
    return (boolean) method.invoke(null, ability);
  }

  public static void main(String[] args) throws Exception {
    Localizer.getInstance().initialize("en-US", "res/languages/");
    Lang.createInstance("en-US");
    String root = "SP$ RevealHand | Defined$ Targeted | ValidTgts$ Player | IsCurse$ True | SubAbility$ DBChangeZone | StackDescription$ SpellDescription | SpellDescription$ Target player reveals their hand.";
    String exact = "DB$ ChangeZone | Origin$ Hand | Destination$ Exile | Chooser$ You | ChangeType$ Card.nonLand | ChangeNum$ 1 | DefinedPlayer$ Targeted | Mandatory$ True | StackDescription$ SpellDescription | SpellDescription$ You choose a nonland card from it. Exile that card.";
    SpellAbility[] nightTerrors = abilities(root, exact);
    SpellAbility wrongDefinition = abilities(root.replace("Defined$ Targeted", "Defined$ You"), exact)[1];
    SpellAbility notCurse = abilities(root.replace("IsCurse$ True", "IsCurse$ False"), exact)[1];
    SpellAbility extraRoot = abilities(root + " | AILogic$ Discard", exact)[1];
    SpellAbility wrongDestination = abilities(root, exact.replace("Destination$ Exile", "Destination$ Graveyard"))[1];
    SpellAbility optional = abilities(root, exact.replace("Mandatory$ True", "Mandatory$ False"))[1];
    SpellAbility broadCount = abilities(root, exact.replace("ChangeNum$ 1", "ChangeNum$ 2"))[1];
    SpellAbility hidden = abilities(root, exact + " | Hidden$ True")[1];
    SpellAbility unrestricted = abilities(root, exact.replace("Card.nonLand", "Card"))[1];
    SpellAbility extra = abilities(root, exact)[1];
    extra.putParam("AILogic", "Discard");
    System.out.println(
      "nightTerrors=" + accepts(nightTerrors[1])
        + ",wrongDefinition=" + accepts(wrongDefinition)
        + ",notCurse=" + accepts(notCurse)
        + ",extraRoot=" + accepts(extraRoot)
        + ",wrongDestination=" + accepts(wrongDestination)
        + ",optional=" + accepts(optional)
        + ",broadCount=" + accepts(broadCount)
        + ",hidden=" + accepts(hidden)
        + ",unrestricted=" + accepts(unrestricted)
        + ",extra=" + accepts(extra)
    );
    System.out.flush();
    System.exit(0);
  }
}
`,
      );
      const output = execFileSync(
        'java',
        ['-cp', `${compiled.classDirectory}${delimiter}${install.jar}`, source],
        { cwd: install.home, encoding: 'utf8', timeout: 120_000 },
      );
      expect(
        output
          .trim()
          .split('\n')
          .find((line) => line.startsWith('nightTerrors=')),
      ).toBe(
        'nightTerrors=true,wrongDefinition=false,notCurse=false,extraRoot=false,wrongDestination=false,optional=false,broadCount=false,hidden=false,unrestricted=false,extra=false',
      );
    } finally {
      compiled.dispose();
    }
  },
  180_000,
);
