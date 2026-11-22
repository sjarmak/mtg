/** Compile the bridge against Forge and mutation-test the generic selected-mode guard. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { expect, it } from 'vitest';
import { compileInstalledForgeBridge, findForgeInstall } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

forgeIt(
  'accepts an exact linked player-gain mode and rejects adjacent hostile modal shapes',
  () => {
    const install = findForgeInstall();
    const compiled = compileInstalledForgeBridge();
    if (install === null || compiled === null) throw new Error('Required installed Forge is absent');
    try {
      const source = join(compiled.classDirectory, 'SelectedModalPlayerGainProbe.java');
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

public class SelectedModalPlayerGainProbe {
  private static Card card(String gain) {
    var rules = CardRules.fromScript(List.of(
      "Name:Structural Modal Probe",
      "ManaCost:3 G G",
      "Types:Sorcery",
      "A:SP$ Charm | Choices$ DBGain,DBChange,DBSearch | CharmNum$ 2",
      "SVar:DBGain:" + gain,
      "SVar:DBChange:DB$ ChangeZone | ValidTgts$ Permanent.nonCreature | Origin$ Battlefield | Destination$ Library",
      "SVar:DBSearch:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Creature | ChangeNum$ 1"
    ));
    Card card = CardFactory.getCard(new PaperCard(rules, "TST", CardRarity.Rare), null, null);
    card.setSVar("DBGain", gain);
    card.setSVar("DBChange", "DB$ ChangeZone | ValidTgts$ Permanent.nonCreature | Origin$ Battlefield | Destination$ Library");
    card.setSVar("DBSearch", "DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Creature | ChangeNum$ 1");
    return card;
  }

  private static SpellAbility root(String gain, boolean linked) {
    return root(gain, linked, false);
  }

  private static SpellAbility root(String gain, boolean linked, boolean rootTargeted) {
    SpellAbility root = AbilityFactory.getAbility(
      "SP$ Charm | Choices$ DBGain,DBChange,DBSearch | CharmNum$ 2"
        + (rootTargeted ? " | ValidTgts$ Player" : ""),
      card(gain)
    );
    List<AbilitySub> modes = root.getAdditionalAbilityList("Choices");
    if (linked) {
      root.setSubAbility(modes.get(0));
      modes.get(0).setSubAbility(modes.get(1));
    } else {
      root.setSubAbility(modes.get(1));
      modes.get(1).setSubAbility(modes.get(2));
    }
    return root;
  }

  private static boolean invoke(SpellAbility ability) throws Exception {
    var method = Class.forName("ForgeBridge$BridgeSession").getDeclaredMethod(
      "isReviewedSelectedModalTarget",
      SpellAbility.class
    );
    method.setAccessible(true);
    return (boolean) method.invoke(null, ability);
  }

  public static void main(String[] args) throws Exception {
    Localizer.getInstance().initialize("en-US", "res/languages/");
    Lang.createInstance("en-US");

    SpellAbility exactRoot = root("DB$ GainLife | ValidTgts$ Player | LifeAmount$ 7", true);
    SpellAbility exact = exactRoot.getSubAbility();
    boolean accepted = invoke(exact);
    boolean secondAccepted = invoke(exact.getSubAbility());

    SpellAbility copiedRoot = exactRoot.copy();
    SpellAbility copied = copiedRoot.getSubAbility();
    boolean copiedAccepted = invoke(copied);

    SpellAbility runtimeRoot = exactRoot.copy();
    SpellAbility runtime = runtimeRoot.getSubAbility();
    for (SpellAbility selected = runtime; selected != null; selected = selected.getSubAbility()) {
      selected.getMapParams().put("StackDescription", "SpellDescription");
    }
    boolean runtimeAccepted = invoke(runtime);

    SpellAbility extraRoot = exactRoot.copy();
    SpellAbility extra = extraRoot.getSubAbility();
    extra.getMapParams().put("AILogic", "GainLife");
    boolean extraParam = invoke(extra);

    SpellAbility unlinkedRoot = root("DB$ GainLife | ValidTgts$ Player | LifeAmount$ 7", false);
    boolean unlinked = invoke(unlinkedRoot.getAdditionalAbilityList("Choices").get(0));

    SpellAbility broadRoot = root("DB$ GainLife | ValidTgts$ Player | TargetMax$ 2 | LifeAmount$ 7", true);
    boolean broad = invoke(broadRoot.getSubAbility());

    SpellAbility delegatedRoot = root("DB$ GainLife | ValidTgts$ Player | TargetingPlayer$ You | LifeAmount$ 7", true);
    boolean delegated = invoke(delegatedRoot.getSubAbility());

    SpellAbility creatureRoot = root("DB$ GainLife | ValidTgts$ Creature | LifeAmount$ 7", true);
    boolean creatureTarget = invoke(creatureRoot.getSubAbility());

    SpellAbility targetedRoot = root("DB$ GainLife | ValidTgts$ Player | LifeAmount$ 7", true, true);
    boolean rootTargeted = invoke(targetedRoot.getSubAbility());

    SpellAbility foreignRoot = root("DB$ GainLife | ValidTgts$ Player | LifeAmount$ 7", true);
    SpellAbility foreign = foreignRoot.getSubAbility();
    SpellAbility otherRoot = root("DB$ GainLife | ValidTgts$ Player | LifeAmount$ 7", true);
    ((AbilitySub) foreign).setParent(otherRoot);
    boolean foreignParent = invoke(foreign);

    System.out.println(
      "accepted=" + accepted
        + ",secondAccepted=" + secondAccepted
        + ",copiedAccepted=" + copiedAccepted
        + ",runtimeAccepted=" + runtimeAccepted
        + ",extraParam=" + extraParam
        + ",unlinked=" + unlinked
        + ",broad=" + broad
        + ",delegated=" + delegated
        + ",creatureTarget=" + creatureTarget
        + ",rootTargeted=" + rootTargeted
        + ",foreignParent=" + foreignParent
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
          .find((line) => line.startsWith('accepted=')),
      ).toBe(
        'accepted=true,secondAccepted=true,copiedAccepted=true,runtimeAccepted=true,extraParam=false,unlinked=false,broad=false,delegated=false,creatureTarget=true,rootTargeted=false,foreignParent=false',
      );
    } finally {
      compiled.dispose();
    }
  },
  180_000,
);
