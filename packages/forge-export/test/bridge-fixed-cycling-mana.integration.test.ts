/** Exercise the actual compiled boundary, including costs outside the reviewed shape. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { expect, it } from 'vitest';
import { compileInstalledForgeBridge, findForgeInstall } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

forgeIt(
  'compiled cycling mana boundary accepts only positive fixed generic/WUBRGC costs',
  () => {
    const install = findForgeInstall();
    const compiled = compileInstalledForgeBridge();
    if (install === null || compiled === null) throw new Error('Required installed Forge is absent');
    try {
      const source = join(compiled.classDirectory, 'CyclingManaProbe.java');
      writeFileSync(
        source,
        `
import forge.card.mana.ManaCost;
import forge.card.mana.ManaCostParser;
import forge.game.cost.CostPartMana;
public class CyclingManaProbe {
  public static void main(String[] args) throws Exception {
    var method = Class.forName("ForgeBridge$BridgeController")
      .getDeclaredMethod("isReviewedFixedCyclingMana", CostPartMana.class);
    method.setAccessible(true);
    for (String cost : args) {
      var mana = new ManaCost(new ManaCostParser(cost));
      System.out.println(cost + "=" + method.invoke(null, new CostPartMana(mana, "")));
    }
  }
}
`,
      );
      const accepted = ['1', '3', 'U', '1 G', '3 G', 'W U B R G', '2 C'];
      const refused = ['0', 'no cost', 'X', 'X 1 U', 'W/U', '2/W', 'W/P', 'S'];
      const output = execFileSync(
        'java',
        ['-cp', `${compiled.classDirectory}${delimiter}${install.jar}`, source, ...accepted, ...refused],
        { encoding: 'utf8', timeout: 30_000 },
      );
      expect(output.trim().split('\n')).toEqual([
        ...accepted.map((cost) => `${cost}=true`),
        ...refused.map((cost) => `${cost}=false`),
      ]);
    } finally {
      compiled.dispose();
    }
  },
  180_000,
);
