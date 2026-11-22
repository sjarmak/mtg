/** Compile the bridge and replay the two preserved Forge LKI failure stacks. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { expect, it } from 'vitest';
import { compileInstalledForgeBridge, findForgeInstall } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

forgeIt(
  'recognizes only the pinned land-play and simulated-combat LKI failures',
  () => {
    const install = findForgeInstall();
    const compiled = compileInstalledForgeBridge();
    if (install === null || compiled === null) throw new Error('Required installed Forge is absent');
    try {
      const source = join(compiled.classDirectory, 'LkiLandSimulationProbe.java');
      writeFileSync(
        source,
        `
import java.lang.reflect.Method;
public class LkiLandSimulationProbe {
  private static final String MESSAGE =
      "Cannot invoke \\"forge.game.card.CardState.getName()\\" because \\"source\\" is null";

  private static StackTraceElement frame(String owner, String name) {
    return new StackTraceElement(owner, name, owner.substring(owner.lastIndexOf('.') + 1) + ".java", 1);
  }

  private static NullPointerException failure(boolean combat, boolean includeLandFilter) {
    NullPointerException error = new NullPointerException(MESSAGE);
    var frames = new java.util.ArrayList<StackTraceElement>();
    frames.add(frame("forge.game.card.CardState", "copyFrom"));
    frames.add(frame("forge.game.card.CardCopyService", "getLKICopy"));
    if (combat) {
      frames.add(frame("forge.game.combat.CombatUtil", "checkDeclaredAttacker"));
      frames.add(frame("forge.ai.simulation.GameStateEvaluator", "simulateUpcomingCombatThisTurn"));
    } else {
      frames.add(frame("forge.game.player.Player", "playLand"));
    }
    frames.add(frame("forge.ai.simulation.OnePlaySafetyChecker", "isAcceptable"));
    if (includeLandFilter) frames.add(frame("forge.ai.AiController", "filterLandsToPlay"));
    error.setStackTrace(frames.toArray(StackTraceElement[]::new));
    return error;
  }

  public static void main(String[] args) throws Exception {
    Method classifier = Class.forName("ForgeBridge").getDeclaredMethod(
        "isUnsafeLandSimulationFailure", RuntimeException.class);
    classifier.setAccessible(true);
    System.out.println("land=" + classifier.invoke(null, failure(false, true)));
    System.out.println("combat=" + classifier.invoke(null, failure(true, true)));
    System.out.println("unrelated=" + classifier.invoke(null, failure(false, false)));
  }
}
`,
      );
      const output = execFileSync(
        'java',
        ['-cp', `${compiled.classDirectory}${delimiter}${install.jar}`, source],
        { cwd: install.home, encoding: 'utf8', timeout: 120_000 },
      );
      expect(output.trim().split('\n')).toEqual(['land=true', 'combat=true', 'unrelated=false']);
    } finally {
      compiled.dispose();
    }
  },
  180_000,
);
