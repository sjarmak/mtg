/** Compile the bridge and mutation-test targeted revealed-hand discard shapes. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { expect, it } from 'vitest';
import { compileInstalledForgeBridge, findForgeInstall } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

forgeIt(
  'accepts Thoughtseize and Lay Bare while rejecting adjacent discard shapes',
  () => {
    const install = findForgeInstall();
    const compiled = compileInstalledForgeBridge();
    if (install === null || compiled === null) throw new Error('Required installed Forge is absent');
    try {
      const source = join(compiled.classDirectory, 'TargetedRevealDiscardProbe.java');
      writeFileSync(
        source,
        `
import forge.card.CardRarity;
import forge.card.CardRules;
import forge.game.ability.AbilityFactory;
import forge.game.card.Card;
import forge.game.card.CardFactory;
import forge.game.spellability.SpellAbility;
import forge.item.PaperCard;
import forge.util.Lang;
import forge.util.Localizer;
import java.util.List;

public class TargetedRevealDiscardProbe {
  private static SpellAbility ability(String name, String mana, String definition) {
    Card card = CardFactory.getCard(new PaperCard(
      CardRules.fromScript(List.of(
        "Name:" + name,
        "ManaCost:" + mana,
        "Types:Sorcery",
        "SVar:DBLoseLife:DB$ LoseLife | LifeAmount$ 2"
      )),
      "TST",
      CardRarity.Uncommon
    ), null, null);
    return AbilityFactory.getAbility(definition, card);
  }

  private static boolean accepts(SpellAbility ability) throws Exception {
    var method = Class.forName("ForgeBridge$BridgeSession").getDeclaredMethod(
      "isReviewedTargetedRevealDiscard",
      SpellAbility.class
    );
    method.setAccessible(true);
    return (boolean) method.invoke(null, ability);
  }

  public static void main(String[] args) throws Exception {
    Localizer.getInstance().initialize("en-US", "res/languages/");
    Lang.createInstance("en-US");
    String thoughtseize = "SP$ Discard | ValidTgts$ Player | NumCards$ 1 | DiscardValid$ Card.nonLand | Mode$ RevealYouChoose | SubAbility$ DBLoseLife | SpellDescription$ Target player reveals their hand.";
    String layBare = "SP$ Discard | ValidTgts$ Opponent | Mode$ RevealYouChoose | DiscardValid$ Card.nonLand+nonLegendary | DiscardValidDesc$ nonlegendary, nonland | SpellDescription$ Target opponent reveals their hand.";
    String wrongMode = thoughtseize.replace("RevealYouChoose", "TgtChoose");
    String tooMany = thoughtseize.replace("NumCards$ 1", "NumCards$ 2");
    String broadTarget = thoughtseize.replace("ValidTgts$ Player", "ValidTgts$ Player | TargetMax$ 2");
    String wrongTarget = thoughtseize.replace("ValidTgts$ Player", "ValidTgts$ Creature");
    String activated = thoughtseize.replace("SP$ Discard", "AB$ Discard | Cost$ 0");
    SpellAbility extra = ability("Extra", "B", thoughtseize);
    extra.putParam("AILogic", "Discard");
    System.out.println(
      "thoughtseize=" + accepts(ability("Thoughtseize", "B", thoughtseize))
        + ",layBare=" + accepts(ability("Lay Bare the Heart", "1 B", layBare))
        + ",wrongMode=" + accepts(ability("Wrong mode", "B", wrongMode))
        + ",tooMany=" + accepts(ability("Too many", "B", tooMany))
        + ",broadTarget=" + accepts(ability("Broad target", "B", broadTarget))
        + ",wrongTarget=" + accepts(ability("Wrong target", "B", wrongTarget))
        + ",activated=" + accepts(ability("Activated", "B", activated))
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
          .find((line) => line.startsWith('thoughtseize=')),
      ).toBe(
        'thoughtseize=true,layBare=true,wrongMode=false,tooMany=false,broadTarget=false,wrongTarget=false,activated=false,extra=false',
      );
    } finally {
      compiled.dispose();
    }
  },
  180_000,
);
