/**
 * The agent-runnable path to a live generation run.
 *
 * `packages/setgen/src/cli.ts` is the real entry point and this file adds no
 * behavior of its own: it imports that module's `main` and hands it the same
 * argv a person would type. The reason it exists is narrow and mechanical.
 * `tsx` cannot start under the agent sandbox — it opens an IPC pipe and gets
 * `listen EPERM: /tmp/claude-1000/tsx-1000/N.pipe` — so every `tsx` script in
 * this repo is unreachable from an agent session, while `vitest` runs fine.
 * A human with a normal shell should run the CLI directly and ignore this file.
 *
 * It is a vitest file so that vitest can run it, and it lives under `tools/`
 * rather than `test/` so that it is not a test. `vitest.config.ts`'s unit
 * project includes `packages/<pkg>/test/**`, so nothing here is picked up by
 * `npm test`; `tsconfig.json` includes `packages/<pkg>/tools/**`, so it is still
 * typechecked. Run it through `tools/vitest.live.config.ts`, which includes this
 * path and nothing else.
 *
 * **This spends the operator's model quota.** It is the one file in the repo
 * that reaches a live provider on purpose. Two things guard it: it is outside
 * the default suite, and it refuses to run without `MTG_LIVE_RUN=1`. Neither is
 * a substitute for meaning to run it.
 *
 * Recording is resumable (`createResumableRecorder`), so an interrupted run
 * replays what is already on disk and only new requests reach the model. Point
 * `MTG_LIVE_FIXTURES` at a gitignored directory for a throwaway pass: fixture
 * keys are `hash(system, prompt, schema)`, so a brief whose required cards move
 * invalidates most of them, and recording those into the repo's own fixture
 * directory commits files the next brief edit will strand.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

/** An hour. A 75-card brief is 8 fill batches plus a critique and its revisions. */
const LIVE_BUDGET_MS = 3_600_000;

function fromEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? fallback : value;
}

describe.skipIf(process.env.MTG_LIVE_RUN !== '1')('a live generation run', () => {
  it('fills the brief and writes a set the DSL accepts', { timeout: LIVE_BUDGET_MS }, async () => {
    const brief = resolve(
      REPO_ROOT,
      fromEnv('MTG_LIVE_BRIEF', 'packages/setgen/briefs/tideglass-reach.json'),
    );
    const out = resolve(REPO_ROOT, fromEnv('MTG_LIVE_OUT', 'out/TGR'));
    const fixtures = resolve(REPO_ROOT, fromEnv('MTG_LIVE_FIXTURES', 'out/xmp-fixtures'));

    const argv = ['--brief', brief, '--record', '--out', out, '--fixtures', fixtures];
    const maxUsd = process.env['MTG_LIVE_MAX_USD'];
    if (maxUsd !== undefined && maxUsd.length > 0) argv.push('--max-usd', maxUsd);

    // `main` returns the CLI's exit code: 0 when the report is enforceable,
    // 1 when the generated set has findings the DSL or the profile rejects.
    // A non-zero code is a real result rather than a crash, so the assertion
    // carries the report, which `main` has already printed above it.
    const code = await main(argv);
    expect(code, 'the generated set did not pass its own report; the report is printed above').toBe(0);
  });
});
