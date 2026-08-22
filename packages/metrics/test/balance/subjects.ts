/**
 * Which sets the balance gate measures.
 *
 * The gate is a measurement of a card pool, and the pool used to be welded into
 * the harness: one hard-coded path meant `npm run test:balance` could say "the
 * committed 90-card set is healthy" and nothing at all about any other set. The
 * flagship epic's acceptance is "its balance gate is green with the numbers
 * reported", which a gate with one frozen subject cannot deliver.
 *
 * A subject is a set plus the baseline it is judged against. Every subject is
 * measured with the same bands (`DEFAULT_METRICS_CONFIG`), the same seed
 * (`BALANCE_RUN_SEED`) and the same volume, because the point of a second
 * subject is to compare two pools rather than two harnesses. A set that needs
 * different bands is a design argument to have in `src/config.ts`, in the open,
 * not a per-set override that quietly lowers a bar.
 *
 * **What CI runs.** The `balance` job runs `npm run test:balance` with no
 * environment of its own, so it measures exactly `DECLARED_SUBJECTS`: the one
 * committed fixture, at its pinned 10,035 games. A set that is not in the tree cannot be a CI gate: CI checks out the repository and nothing
 * else, so pointing the job at `out/slice/set/set.json` would gate on a file
 * the job would have to generate first, and gating on a generated set makes
 *
 * **Measuring a set before it lands.** `MTG_BALANCE_SET=<path>` appends one
 * more subject, judged with no waivers at all:
 *
 *   MTG_BALANCE_SET=out/slice/set/set.json npm run test:balance
 *
 * It appends rather than replaces, so no environment variable can stop the
 * declared sets from being measured, and a switch that silently swaps the subject
 * is a switch that silently turns the gate off. Pointing it at a set already in
 * the list is a no-op rather than a second identical sweep.
 *
 * The promise that the named set is the set that gets played is held by
 * `gate-wiring.test.ts`, which runs the gate in a child process against a set
 * that has to fail and reads back which pool it measured. Everything here is
 * pure and unit-tested in `subjects.test.ts`, so this list can be right while
 * the gate reads something else entirely.
 */
import { isAbsolute, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RecordedSpread, WaivedGate } from './baseline';
import { NO_WAIVERS, TIDEGLASS_REACH_WAIVERS } from './baseline';

export interface BalanceSubject {
  /** Names the subject in test output and in the report header. */
  readonly id: string;
  /** Absolute path to the DSL set file. */
  readonly setPath: string;
  /** The known-red baseline this subject is judged against. */
  readonly waivers: readonly WaivedGate[];
  /**
   * The `balance.spread` reading this subject's baseline was measured against,
   * asserted by `format-health.test.ts` so a move fails instead of aging.
   *
   * `null` for a subject with nothing to compare against, which is an env
   * subject and only an env subject: it is a set nobody has measured yet, so
   * there is no reading for it to have drifted from. Every declared subject
   * carries one, and `subjects.test.ts` holds that — the alternative reading of
   * `null`, "a declared subject that skipped its measurement", is exactly the
   * hole this field was added to close, so it must not be expressible.
   */
  readonly spread: RecordedSpread | null;
  /** `declared` blocks CI; `env` is one run by whoever set the variable. */
  readonly origin: 'declared' | 'env';
}

/**
 * The committed set, read straight out of `@mtg/setgen`'s fixture tree rather
 * than copied here, because that file is the deterministic replay of the one
 * recorded claude-cli generation and a copy of it has no provenance of its own.
 * The gate kept a prettier-reformatted duplicate until `mtg-bc2.86`; two
 * committed copies of one set is a regenerate-one-forget-the-other away from a
 * gate that asserts against a set the generator no longer emits, and the copies
 * were byte-different already. Regenerate the source with either of:
 *
 *   npm run slice                       # replays fixtures, writes out/slice/set/set.json
 *   npx tsx packages/setgen/src/cli.ts --brief packages/setgen/briefs/tideglass-reach.json --out <dir>
 *
 * Both replay `packages/setgen/fixtures/llm/` and produce the setgen fixture's
 * exact bytes (verified by md5 on 2026-08-09). A genuinely new set needs a live
 * run — `npm run slice -- --provider claude-cli` or the CLI's `--record` — and
 * re-recorded LLM fixtures alongside it. Copy the resulting `set.json` over the
 * setgen fixture and re-measure its waiver list in the same change; a fixture
 * swap without a re-measurement is how a waiver silently starts describing a
 * different set. Reading the source directly is what makes that loud: the gate
 * moves the moment the set does, instead of staying green on a stale copy.
 */
export const COMMITTED_SET_PATH: string = fileURLToPath(
  new URL('../../../setgen/fixtures/sets/tideglass-reach.set.json', import.meta.url),
);

/**
 * The recorded readings are written here, beside the pool path each was measured
 * on, rather than as named constants in `baseline.ts` next to the waiver lists.
 * That is a constraint rather than a preference: the value import from
 * `./baseline` is an exact-match anchor in `@mtg/slice`'s public-export edits, so
 * a fourth name on it breaks the export. Inline keeps the anchor intact and the
 * reading next to the thing it describes; `RecordedSpread` and `spreadDrift` are
 * still in `baseline.ts`, because the shape and the check are shared and only
 * the two measurements are per-subject.
 */
export const COMMITTED_SUBJECT: BalanceSubject = {
  id: 'tideglass-reach',
  setPath: COMMITTED_SET_PATH,
  waivers: TIDEGLASS_REACH_WAIVERS,
  spread: {
    measured: 0.1614,
    when: '2026-08-16',
    why:
      'the prototype pool is the control the flagship was read against. Its fixture has not been ' +
      'edited since `round-robin.ts` recorded it on 2026-08-14, and over six seeds on this tree it ' +
      'reads mean 0.1445 sd 0.0190 against the mean 0.146 sd 0.017 recorded then — a reproduction, ' +
      'not a coincidence. That is what makes the flagship moving 0.117 to 0.179 over the same two ' +
      'days a fact about the flagship rather than about the engine: the sim and kernel commits in ' +
      'between move this pool nowhere. Re-pinning this one without a fixture edit means an engine ' +
      'change stopped being balance-neutral, which is a bigger finding than the number.',
  },
  origin: 'declared',
};

/** The sets CI gates on. Adding one here is what makes it blocking. */
export const DECLARED_SUBJECTS: readonly BalanceSubject[] = [COMMITTED_SUBJECT];

export const SET_ENV_VAR = 'MTG_BALANCE_SET';

/** Prefixed so an ad-hoc subject can never collide with a declared id. */
export function envSubjectId(path: string): string {
  return `env:${basename(path).replace(/\.set\.json$|\.json$/, '')}`;
}

export function balanceSubjects(env: NodeJS.ProcessEnv = process.env): readonly BalanceSubject[] {
  const raw = env[SET_ENV_VAR];
  if (raw === undefined) return DECLARED_SUBJECTS;
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new Error(`${SET_ENV_VAR} is set but empty: give it a path to a set file, or unset it`);
  }
  const setPath = isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed);
  if (DECLARED_SUBJECTS.some((subject) => subject.setPath === setPath)) return DECLARED_SUBJECTS;
  return [
    ...DECLARED_SUBJECTS,
    { id: envSubjectId(setPath), setPath, waivers: NO_WAIVERS, spread: null, origin: 'env' },
  ];
}
