/**
 * Running a brief from the page, for nothing.
 *
 * `mtg-yddw.5`. The designer's whole argument is that a brief's consequences
 * should be visible before anybody pays for them, and the skeleton plan is most
 * of that. This is the rest: a generation that resolves every call out of the
 * recorded fixtures on disk and spends nothing.
 *
 * # Why it can only replay
 *
 * `createFixtureProvider({ record: false })` is the entire provider. There is no
 * branch here that reaches `createResumableRecorder`, no flag that turns one on,
 * and no option threaded in from the server that could. That is deliberate and
 * is the scope the playtester set: a live provider run stays on the CLI, where
 * `--record` and `--max-usd` are typed by a person each time. A button that
 * spends money is one misclick from a bill, and the safest place to put that
 * property is where it cannot be configured back off.
 *
 * There is deliberately no budget guard beside it, and the reason is worth
 * writing down because a zero-dollar ceiling is the obvious second lock to
 * reach for and it does not exist. `@mtg/llm`'s `createBudgetGuard` calls
 * `assertPositive('maxUsd', …)`, so zero is refused at construction; and its
 * check is `spentUsd >= maxUsd`, so a guard that could be built at zero would
 * refuse the first call of a replay that spends nothing. A guard is a ceiling on
 * spending, not a way to say *no spending*. Saying no spending is the provider's
 * job, which is why the provider is the whole of the lock here.
 *
 * # What a missing fixture is
 *
 * Not an error in the ordinary sense. A brief nobody has recorded is the *usual*
 * state of a brief somebody is writing, so the run comes back saying which key
 * it wanted and what would record it, and the page says the same. Reporting it
 * as a crash would tell a designer their brief is broken when what is true is
 * that it is new.
 */
import { createFixtureProvider, readRunManifest } from '@mtg/llm';
import type { Card } from '@mtg/dsl';
import type { SetBrief } from '../brief';
import { generateSet } from '../generate';
import { generationSemanticsFor } from '../generation-semantics';
import type { GenerationReport } from '../report';

/** What answers `POST /design-api/run`. */
export type DesignRunner = (brief: SetBrief) => Promise<DesignRunResult>;

export type DesignRunResult =
  | {
      readonly ok: true;
      /** True when every slot printed a card that passes every deterministic gate. */
      readonly enforceable: boolean;
      readonly report: GenerationReport;
      readonly cards: readonly Card[];
    }
  | {
      readonly ok: false;
      /** Why the replay could not finish, in the words the provider used. */
      readonly reason: string;
      /**
       * True when the reason is a fixture this checkout does not have, as
       * opposed to a brief the pipeline refused. The page says two different
       * sentences for the two, and only the first names the recording command.
       */
      readonly unrecorded: boolean;
    };

/** The command that would record what a replay is missing, named in one place. */
export const RECORD_COMMAND =
  'npx tsx packages/setgen/src/cli.ts --brief <brief.json> --record --max-usd <n>';

/**
 * A fixture miss reads as one, whatever wrapped it.
 *
 * The provider names the key it could not find, and every layer between it and
 * here re-wraps rather than replaces the message, so the marker survives to the
 * top. Matching on the word is weaker than a typed error and is what the
 * boundary offers today; it decides which of two sentences the page shows and
 * nothing else, so a false negative costs a less specific message rather than a
 * wrong outcome.
 */
function looksUnrecorded(message: string): boolean {
  return message.includes('fixture') || message.includes('not recorded');
}

/**
 * A runner over one fixture directory.
 *
 * `critique` and `flavor` are off. Both are extra model calls, so on a replay
 * they are extra fixtures to miss, and neither answers the question this surface
 * asks — whether the brief builds a set the engine can enforce. The CLI is where
 * a full run is made.
 */
export function fixtureRunner(fixtureDir: string, runManifestPath: string): DesignRunner {
  const semanticsVersion = generationSemanticsFor(readRunManifest(runManifestPath));
  return async (brief: SetBrief): Promise<DesignRunResult> => {
    const provider = createFixtureProvider({ dir: fixtureDir, record: false });
    try {
      const result = await generateSet({
        provider,
        brief,
        critique: false,
        flavor: false,
        semanticsVersion,
      });
      return {
        ok: true,
        enforceable: result.report.enforceable,
        report: result.report,
        cards: result.cards,
      };
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      return { ok: false, reason: error.message, unrecorded: looksUnrecorded(error.message) };
    }
  };
}
