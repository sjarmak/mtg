/** Compile the bridge and execute its private failure formatter against synthetic stacks. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { expect, it } from 'vitest';
import { compileInstalledForgeBridge, findForgeInstall } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

forgeIt(
  'reports 32 engine frames while preserving the existing bridge-frame boundary',
  () => {
    const install = findForgeInstall();
    const compiled = compileInstalledForgeBridge();
    if (install === null || compiled === null) throw new Error('Required installed Forge is absent');
    try {
      const source = join(compiled.classDirectory, 'FailureDiagnosticProbe.java');
      writeFileSync(
        source,
        `
import java.lang.reflect.Method;
import java.util.Arrays;

public final class FailureDiagnosticProbe {
  private static String describe(Throwable failure) throws Exception {
    Class<?> session = Class.forName("ForgeBridge$BridgeSession");
    Method method = session.getDeclaredMethod("describeFailure", Throwable.class);
    method.setAccessible(true);
    return (String) method.invoke(null, failure);
  }

  private static StackTraceElement frame(String owner, int line) {
    return new StackTraceElement(owner, "step", owner + ".java", line);
  }

  public static void main(String[] args) throws Exception {
    Throwable engine = new StackOverflowError();
    StackTraceElement[] engineFrames = new StackTraceElement[40];
    for (int index = 0; index < engineFrames.length; index++) {
      engineFrames[index] = frame("forge.engine.Frame" + index, index);
    }
    engine.setStackTrace(engineFrames);
    String engineText = describe(engine);
    long engineCount = engineText.lines().filter(line -> line.startsWith("  at ")).count();
    System.out.println("engineCount=" + engineCount);
    System.out.println("engineHasFirst=" + engineText.contains("forge.engine.Frame0.step"));
    System.out.println("engineHasLastKept=" + engineText.contains("forge.engine.Frame31.step"));
    System.out.println("engineHasFirstDropped=" + engineText.contains("forge.engine.Frame32.step"));

    Throwable bridge = new IllegalStateException("bridge callback");
    bridge.setStackTrace(new StackTraceElement[] {
      frame("forge.engine.Before", 1),
      frame("ForgeBridge$BridgeController", 2),
      frame("forge.engine.After", 3)
    });
    String bridgeText = describe(bridge);
    System.out.println("bridgeFrames=" + Arrays.toString(
      bridgeText.lines().filter(line -> line.startsWith("  at ")).toArray()
    ));
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
          .filter((line) => /^(engine|bridge)/u.test(line)),
      ).toEqual([
        'engineCount=32',
        'engineHasFirst=true',
        'engineHasLastKept=true',
        'engineHasFirstDropped=false',
        'bridgeFrames=[  at forge.engine.Before.step(forge.engine.Before.java:1),   at ForgeBridge$BridgeController.step(ForgeBridge$BridgeController.java:2)]',
      ]);
    } finally {
      compiled.dispose();
    }
  },
  180_000,
);
