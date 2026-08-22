/**
 * The gate measures the set it was pointed at, and nothing else does.
 *
 * `broken-set.test.ts` proves that a bad pool measures as bad, but it measures
 * through a helper of its own, so it says nothing about `format-health.test.ts`,
 * the file `npm run test:balance` actually runs. That gap was real and it was
 * found by mutation: changing the gate's `loadSet(subject.setPath)` to
 * `loadSet(COMMITTED_SUBJECT.setPath)` left the whole balance project green,
 * including a full-volume run with `MTG_BALANCE_SET` pointed at a deliberately
 * broken set. The override was unpinned. The gate could stop measuring the set
 * a human handed it and report the fixture's numbers under the handed set's
 * name, which is worse than not measuring at all.
 *
 * A test inside the gate cannot catch that on its own: with one declared
 * subject, `subject.setPath` and `COMMITTED_SUBJECT.setPath` are the same
 * string, so the swap is invisible until a second subject exists. So this file
 * runs the gate from outside, as a child process, with an extra subject that
 * must fail, and reads what came back. Two things have to be true of the child:
 * every subject's provenance line names the path that subject was handed, and
 * the deformation shows up in the env subject's report and in neither declared
 * one.
 *
 * **What a declared subject is held to, and why it is not a clean report.** It
 * is held to `STRUCTURAL_GATES` below. A clean report at this volume is a claim
 * about the set's content that this volume cannot support: 30 games per matchup
 * is 270 games per color pair against the pinned sweep's 2,007, a sample 7.4
 * times thinner, and `scaledSeedDeviation` in `packages/metrics/src/fairness.ts`
 * puts a pair win rate's movement on the seed alone at 0.055 there. The Hidden
 * Kingdom's RG pair measures 41.7% in the pinned sweep, near enough the 40%
 * floor that 0.055 decides it. Measured on an unmodified tree:
 * `MTG_BALANCE_GAMES` of 40 and 60 put RG at 39.4% and 38.7% and turned this
 * file red, 50 put it at exactly 40.0% and failed Tideglass on WU at 39.4%
 * instead, and 30 clears the floor by two games. Requiring a clean report made
 * this file's verdict a coin flip on the volume knob, and it spent that red on
 * whichever diff happened to be running. The pinned sweep in
 * `format-health.test.ts` is where a set's health is judged, at 2,007 games a
 * pair and against a baseline measured there.
 *
 * The deformation cannot hide behind that margin. Six points of power and
 * toughness on every red creature measures as a 52.5% spread and four pairs
 * between 75.9% and 80.4%, each closing over 79% of its wins by round 7; a
 * per-pair band miss of 0.007 is not a smaller version of that shape. So the
 * gate that reads the format as a whole is what a declared subject is checked
 * against, read out of the printed report per subject, which is loud for a leak
 * in either direction and silent for a marginal pair. `STRUCTURAL_GATES` below
 * records which gate that is and why it is one rather than two.
 *
 * Cost: one nested vitest run of the gate file alone at 30 games per matchup,
 * 1,350 games per subject over three subjects — the two declared sets plus the
 * broken one. Measured on this hardware across four runs at two subjects: 5.1 s
 * to 11.4 s alone, and about 25 s when the box is also playing the pinned
 * sweep. Thirty games is the floor rather than a preference: at 15
 * each color pair plays 135 games, under the 200-distinct-game win-rate floor,
 * and every win-rate gate would abstain instead of judging.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBoostedSet } from './boosted-set';
import { COMMITTED_SUBJECT, DECLARED_SUBJECTS, SET_ENV_VAR, envSubjectId } from './subjects';

/** The repository root, so the child sees the same `vitest.config.ts` this run did. */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** The one file under test here: the gate, not the whole balance project. */
const GATE_FILE = 'packages/metrics/test/balance/format-health.test.ts';

const VITEST_BIN = join(dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');

/** See the header: 270 games per color pair, the lowest volume that judges. */
const GAMES_PER_MATCHUP = '30';

/**
 * Twenty times the 14 s a quiet box measures. The child is generous on purpose:
 * it runs beside the pinned 10,035-game sweep in the same project and brings its
 * own sim worker pool, so both are oversubscribed for as long as it lasts, and a
 * timeout here would report as a wiring failure rather than as load. It stays
 * well under the project's 600 s hook timeout.
 */
const CHILD_BUDGET_MS = 300_000;

interface ChildRun {
  readonly status: number | null;
  readonly output: string;
}

/** Runs the gate file in its own process with the given set handed to it. */
function runGate(setPath: string): ChildRun {
  const child = spawnSync(process.execPath, [VITEST_BIN, 'run', '--project', 'balance', GATE_FILE], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: CHILD_BUDGET_MS,
    env: {
      ...process.env,
      [SET_ENV_VAR]: setPath,
      MTG_BALANCE_GAMES: GAMES_PER_MATCHUP,
      // Color codes would land inside the strings the assertions below read.
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
  });
  if (child.error !== undefined) throw child.error;
  return { status: child.status, output: `${child.stdout}\n${child.stderr}` };
}

/** The vitest failure lines, one per failed test, each naming the subject it belongs to. */
function failedTests(output: string): readonly string[] {
  return output.split('\n').filter((line) => line.includes(`${GATE_FILE} > `));
}

/** The report rows for a failed gate, e.g. ``| `balance.spread` | FAIL | 0.504 | ...``. */
function failedGateRows(output: string): readonly string[] {
  return output.split('\n').filter((line) => /^\| `balance\.\S+` \| FAIL \|/.test(line));
}

/**
 * The gates a leaked pool cannot break quietly, and the whole of what a
 * declared subject is asserted about here.
 *
 * Both read the format rather than one matchup in it: a spread is an order
 * statistic over all ten pair win rates, and the dominance gate needs a pair
 * above 60% closing more than half its wins by round 7. A deformation big
 * enough to be worth planting moves both by margins the dice at this volume
 * cannot reach (the header has the numbers), which is what makes them the pair
 * that separates a leak from a sample.
 */
/**
 * The gates a *declared* subject must not fail in the child's thin run.
 *
 * One gate, and `balance.noDominantStrategy` was the second until 2026-08-17.
 * It came out for the reason the header gives for not requiring a clean report
 * at all: it is a per-pair threshold wearing an aggregate's name. Its trigger is
 * a pair above 60%, so it inherits the same 0.055 of seed movement at 30 games
 * per matchup that decides `balance.pair.*` here. That was harmless while the
 * flagship's best pair sat in the low fifties; the night's design passes put the
 * 253-card build's top pair at 57.4% in the pinned sweep, inside one seed
 * movement of the line, and the child duly drew WB at 60.7% and turned this file
 * red over a set whose own 10,035-game sweep passes all 25 gates. Requiring it
 * here would have made this file's verdict a coin flip on the volume knob again,
 * which is the exact failure the header records paying for once.
 *
 * Nothing is lost in the direction this file cares about. The gate is still
 * proven wired — on the deformed subject, where it fires on four pairs at once
 * and is asserted below rather than merely not-asserted. What it stops doing is
 * standing as a *negative* check on a healthy set at a volume that cannot judge
 * it. `balance.spread` can: the deformation reads 54.0% against a 30% ceiling
 * and against roughly 17% for either declared set, a margin no seed reaches.
 */
const STRUCTURAL_GATES: readonly string[] = ['balance.spread'];

/**
 * Which gates each subject's report marked FAIL, attributed by position.
 *
 * `format-health.test.ts` prints one report per subject, each opening with the
 * `<id>: <path>` provenance line, so a ``| `gate` | FAIL |`` row belongs to the
 * last header above it. A subject that printed a report is a key here even when
 * it failed nothing, which is what lets the caller tell "clean" from "never
 * ran" rather than passing on an absence.
 *
 * It reads the report rather than the child's test names for the reason the
 * deformation test below states: a gate id is data in `@mtg/metrics` and a test
 * name is prose, and prose can be reworded without anything here noticing it
 * had stopped asserting.
 */
function failedGatesBySubject(output: string): ReadonlyMap<string, readonly string[]> {
  const failed = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of output.split('\n')) {
    const subject = /^(\S+): \/.*\.json$/.exec(line)?.[1];
    if (subject !== undefined) {
      current = [];
      failed.set(subject, current);
      continue;
    }
    const gate = /^\| `([^`]+)` \| FAIL \|/.exec(line)?.[1];
    if (gate !== undefined) current?.push(gate);
  }
  return failed;
}

/**
 * What a failing assertion here needs to show: the child's verdict, not its
 * whole transcript. The transcript is three full reports and forty-eight test
 * names, and pasting it into every message buries the one line that matters.
 */
function digest(run: ChildRun): string {
  const provenance = run.output
    .split('\n')
    .filter((line) => line.includes('.set.json') && line.includes(': /'));
  return [
    `child exit ${String(run.status)}`,
    ...provenance,
    ...failedTests(run.output),
    ...failedGateRows(run.output),
  ].join('\n');
}

describe(`${SET_ENV_VAR} names the set the gate measures`, () => {
  let directory: string;
  let brokenPath: string;
  let brokenId: string;
  let boostedCards: number;
  let gate: ChildRun;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'mtg-gate-wiring-'));
    brokenPath = join(directory, 'boosted-red.set.json');
    boostedCards = writeBoostedSet(COMMITTED_SUBJECT.setPath, brokenPath);
    brokenId = envSubjectId(brokenPath);
    gate = runGate(brokenPath);
  }, CHILD_BUDGET_MS + 30_000);

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('deformed a meaningful number of cards, so the two pools really differ', () => {
    expect(boostedCards).toBeGreaterThanOrEqual(10);
  });

  it('ran the gate over every declared subject and the handed-in one', () => {
    // Without this, a child that died during collection would make every
    // assertion below pass by finding nothing.
    for (const subject of DECLARED_SUBJECTS) {
      expect(gate.output, digest(gate)).toContain(`${subject.id} (declared)`);
    }
    expect(gate.output, digest(gate)).toContain(`${brokenId} (env)`);
  });

  it('read the env subject from the path it was handed', () => {
    expect(gate.output, digest(gate)).toContain(`${brokenId}: ${brokenPath}`);
    // The literal signature of the swap: the env subject reporting under its
    // own name on a declared set's cards.
    for (const subject of DECLARED_SUBJECTS) {
      expect(gate.output).not.toContain(`${brokenId}: ${subject.setPath}`);
    }
  });

  it('failed, and the deformation stayed inside the set that was handed in', () => {
    // The env subject failing is the load-bearing half: a child that failed
    // only somewhere else would satisfy a bare "something was red" and say
    // nothing about which pool was played.
    const envFailures = failedTests(gate.output).filter((line) => line.includes(`${brokenId} (env)`));
    expect(envFailures.length, digest(gate)).toBeGreaterThan(0);
    const failed = failedGatesBySubject(gate.output);
    for (const subject of DECLARED_SUBJECTS) {
      // The declared half of the provenance claim, and the half that catches
      // the swap this file was written for: `loadSet(COMMITTED_SUBJECT.setPath)`
      // leaves the flagship subject reporting the prototype's path here, and
      // the prototype's numbers are clean, so nothing below would notice.
      expect(gate.output, digest(gate)).toContain(`${subject.id}: ${subject.setPath}`);
      // Guards the reader rather than the child: a `failedGatesBySubject` that
      // stopped matching would leave the filter below with nothing to find and
      // pass on the absence.
      expect(failed.has(subject.id), digest(gate)).toBe(true);
      const gates = failed.get(subject.id) ?? [];
      expect(
        STRUCTURAL_GATES.filter((id) => gates.includes(id)),
        digest(gate),
      ).toEqual([]);
    }
    expect(gate.status, digest(gate)).not.toBe(0);
  });

  it('failed it on the bands the deformation actually breaks', () => {
    // A red pool six points bigger than everything else blows the spread and
    // the per-pair band. Read off the printed report rather than off a test
    // name, and read the verdict rather than the gate id, because every gate id
    // appears in the report of a run that passed everything.
    expect(gate.output, digest(gate)).toContain('| `balance.spread` | FAIL |');
    // `balance.noDominantStrategy` is asserted here rather than against the
    // declared subjects, and this is the whole of its wiring check. On a pool
    // where every red creature is six points bigger it fires on four pairs at
    // once, each closing over 79% of its wins by round 7; that is a shape no
    // seed produces at this volume, unlike the marginal 60% crossing that took
    // it out of `STRUCTURAL_GATES`.
    expect(failedGatesBySubject(gate.output).get(brokenId) ?? [], digest(gate)).toContain(
      'balance.noDominantStrategy',
    );
    const pairs = failedGateRows(gate.output).filter((line) => line.startsWith('| `balance.pair.'));
    expect(pairs.length, digest(gate)).toBeGreaterThanOrEqual(3);
  });
});
