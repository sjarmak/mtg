/**
 * The harness, plus the one export that can only exist inside a test run.
 *
 * Everything else moved to `./chrome-driver.ts` unchanged, and this file
 * re-exports all of it, so no `.browser.test.ts` changed an import. The split
 * is not a tidy-up: `browserIt` reaches `vitest`, `vitest` throws
 * "failed to access its internal state" the moment it is imported outside a
 * `vitest` command, and `../../tools/shots.ts` is a plain Node program that
 * needs the CDP client and nothing else. One import of this file from a tool
 * took the whole harness down with it.
 *
 * So the rule the split encodes: the driver knows how to start a browser and
 * talk to it, and knows nothing about test runners. What decides whether a test
 * runs, skips, or fails for want of a browser stays here.
 */
import { it } from 'vitest';
import { browserMode, browserPresent, missingBrowserMessage } from './chrome-driver';

export * from './chrome-driver';

/**
 * `it` where a browser exists, `it.skip` where one does not, and a failing test
 * where one does not and the run said it needed one.
 *
 * A checkout with no browser cache is a normal checkout; a suite that fails
 * there is a suite nobody can run, and the CI image that has the browser is
 * where these assertions are meant to bite. So the default skips and the
 * environment variable above is how CI refuses to be told nothing.
 */
export const browserIt: (name: string, fn: () => Promise<void>, timeout?: number) => void = ((): ((
  name: string,
  fn: () => Promise<void>,
  timeout?: number,
) => void) => {
  switch (browserMode(browserPresent, process.env['MTG_REQUIRE_BROWSER'])) {
    case 'run':
      return it;
    case 'require':
      return (name, _fn, timeout) =>
        it(
          name,
          () => {
            throw new Error(missingBrowserMessage());
          },
          timeout,
        );
    case 'skip':
      return it.skip;
  }
})();
