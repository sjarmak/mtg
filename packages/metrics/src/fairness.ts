/**
 * Twenty-five gate rows, read as an answer to the question somebody asked.
 *
 * ## What "fair" means here, in the terms the gates already use
 *
 * "Is the set fair" is not a statistic and there is deliberately no composite
 * score for it — `./health` explains why a weighted 0-100 cannot fail a CI job
 * usefully, and the same argument says it cannot answer a designer either. But
 * the opposite failure is the one a person actually meets: `evaluateGates`
 * returns a flat list of twenty-five verdicts with no structure over it, and a
 * flat list of twenty-five is a thing to audit rather than a thing to read.
 *
 * So fair is defined as four questions, each one a group of gates that were
 * already about the same thing, and the set is fair when all four are answered
 * yes **on evidence**:
 *
 *  - **balance** — does any color pair beat the others? (`balance.*`)
 *  - **luck** — do the dice decide the game? (`onPlay.*`, `mana.*`: the
 *    play/draw coin flip and the shuffle)
 *  - **shape** — do games end by being played? (`length.*`, `decisiveness.*`)
 *  - **cards** — do the cards get used? (`abilities.*`)
 *
 * The grouping is the whole of the judgment in this file, and it is a claim
 * about the gates rather than about any set: nothing here reads a card, a set
 * code or a color. Everything past the grouping is arithmetic over numbers the
 * gates already carry.
 *
 * ## Three verdicts, and the third is why this is not a boolean
 *
 * `unjudged` is not `fair`. A reading whose gates all cleared their bands but
 * whose sample never cleared its floor has not shown the set is fair; it has
 * shown that this run cannot say. That is `./gates`' rule about `underSampled`
 * carried one level up, and it is the rule most likely to be quietly lost when
 * somebody folds statuses into a percentage.
 *
 * A gate no reading claims is the same failure in a different direction, so
 * `unattributed` is a field rather than a silent drop, and a run holding one
 * cannot be called fair. A new gate family added upstream turns the answer to
 * "unjudged, and here is the id nobody read" instead of "fair" over a set
 * nobody finished measuring.
 *
 * ## Findings carry numbers, never adjectives
 *
 * Borrowed outright from `@mtg/cube`'s `validate.ts`, which settled this for
 * the same reason: "this set is unbalanced" tells a designer nothing they can
 * act on, and "the win-rate spread is 0.121 against a limit of 0.300, 0.179
 * inside it" tells them where they stand. Every finding carries `measured`,
 * the edge it missed, and the distance between them in the gate's own units.
 * A finding exists exactly when a gate failed; everything else is silence, and
 * the census is printed either way.
 *
 * ## The dice get a say, and it is stated rather than assumed
 *
 * A win rate measured over one seed is a draw from a distribution, and the
 * balance suite measured that distribution rather than guessing at it (see
 * `test/balance/round-robin.ts`): across eight seeds at the pinned volume, the
 * win-rate spread moved with a standard deviation of 0.008 to 0.017 depending
 * on the subject, and a single color pair's win rate with a standard deviation
 * of about 0.01. So a spread that missed its band by 0.01 missed it by less
 * than the dice move it, and reporting that as a finding about the *set* is
 * reporting the seed.
 *
 * `./seed-noise` names that number for the two statistics it has been measured
 * for, and `null` for every other gate — measured, never guessed, the same
 * rule `@mtg/cube` applies to a criterion nobody stated. Those deviations were
 * measured at one volume and are reported at another: the study ran the pinned
 * 10,035-game sweep, `npm run analyze` defaults to 2,700, and a rate over a
 * quarter of the games moves twice as far on the same dice. So a finding's
 * `noise` is `scaledSeedDeviation`, the pinned number widened by the square
 * root of the shortfall.
 *
 * **The noise is enforced, and it is enforced one module down.** It used to be
 * printed beside a finding and nothing else, so a run could say in one line
 * that a pair missed the 40% floor by 0.007 and in the next that the statistic
 * moves 0.055 on the dice at this volume, and still call the first sentence a
 * fact about the set (`mtg-qt1f`). `./gates`' `abstainWithinNoise` now
 * re-reads the list against the run volume before anything here sees it, and a
 * miss smaller than the dice comes through as the `withinNoise` status. This
 * module's part is the consequence: that status is unjudged, so it is never a
 * `FairnessFinding` — a finding is a fail — and a reading holding one cannot
 * come back `fair`.
 */
import type { GateResult, GateStatus } from './gates';
import { gateMargin, seedNoiseAbstention } from './gates';
import type { FormatHealth } from './health';
import { scaledSeedDeviation } from './seed-noise';

export { DEVIATION_MEASURED_AT_GAMES, scaledSeedDeviation, seedDeviation } from './seed-noise';

export const FAIRNESS_QUESTIONS = ['balance', 'luck', 'shape', 'cards'] as const;
export type FairnessQuestion = (typeof FAIRNESS_QUESTIONS)[number];

/**
 * `unjudged` sits between the other two rather than beside them: it is what a
 * run reports when nothing failed and something could not be judged.
 */
export type FairnessVerdict = 'fair' | 'unfair' | 'unjudged';

/** The question each reading asks, in the words a person would ask it. */
export const FAIRNESS_ASKS: Readonly<Record<FairnessQuestion, string>> = {
  balance: 'Does any color pair beat the others?',
  luck: 'Do the dice decide the game?',
  shape: 'Do games end by being played?',
  cards: 'Do the cards get used?',
};

/**
 * Which question a gate id answers.
 *
 * Matched on the id prefix, which is the grouping `evaluateGates` already
 * emits in — `length.*`, `onPlay.*`, `mana.*`, `decisiveness.*`, `balance.*`,
 * `abilities.*`. A prefix nobody claims returns `null` rather than a default
 * bucket, which is what makes an unattributed gate visible instead of tidy.
 */
const PREFIXES: readonly (readonly [string, FairnessQuestion])[] = [
  ['balance.', 'balance'],
  ['onPlay.', 'luck'],
  ['mana.', 'luck'],
  ['length.', 'shape'],
  ['decisiveness.', 'shape'],
  ['abilities.', 'cards'],
];

export function questionOf(gateId: string): FairnessQuestion | null {
  const match = PREFIXES.find(([prefix]) => gateId.startsWith(prefix));
  return match === undefined ? null : match[1];
}

/**
 * One way the set missed a band, with both sides of the comparison as numbers.
 *
 * `required` is the edge that was missed, so it always answers "what would it
 * have to be" with one number rather than making the reader pick an end of a
 * range. `distance` is how far away it is, in the gate's own units — rounds
 * stay rounds, rates stay rates, nothing is normalized.
 */
export interface FairnessFinding {
  readonly gate: string;
  readonly question: FairnessQuestion;
  readonly label: string;
  readonly measured: number;
  readonly required: number;
  readonly distance: number;
  /**
   * The seed deviation of this statistic **at this run's volume**, or `null`
   * where none has been measured. Scaled from the pinned study by
   * `scaledSeedDeviation`, so a small sweep reports the wider band it earns.
   */
  readonly noise: number | null;
  /**
   * `true` when the miss is smaller than the dice move the statistic.
   *
   * Over a gate list that went through `abstainWithinNoise` — which is every
   * list `formatHealth` produces — this is always `false`, because such a gate
   * is no longer a `fail` and a finding is only made for a fail. It stays
   * because `fairness` is a pure function of whatever gates it is handed, and
   * a caller that assembled its own list without the re-classification still
   * gets an honest flag rather than a silent one.
   */
  readonly withinNoise: boolean;
  readonly detail: string;
}

/** A gate that returned neither a pass nor a fail, and why. */
export interface UnjudgedGate {
  readonly gate: string;
  readonly label: string;
  readonly status: Extract<GateStatus, 'underSampled' | 'notApplicable' | 'withinNoise'>;
  readonly reason: string;
}

export interface FairnessReading {
  readonly question: FairnessQuestion;
  readonly asks: string;
  readonly verdict: FairnessVerdict;
  /**
   * Gate ids, in the order `evaluateGates` emitted them. Ids rather than whole
   * gates: a document carrying this beside its own `gates` list would
   * otherwise hold every gate twice and give two places for one to be edited.
   */
  readonly gates: readonly string[];
  readonly passed: number;
  readonly findings: readonly FairnessFinding[];
  readonly unjudged: readonly UnjudgedGate[];
}

export interface Fairness {
  readonly label: string;
  readonly games: number;
  readonly distinctGames: number;
  readonly verdict: FairnessVerdict;
  /** One per question, in `FAIRNESS_QUESTIONS` order, always all four. */
  readonly readings: readonly FairnessReading[];
  /** Every reading's findings, worst miss first. */
  readonly findings: readonly FairnessFinding[];
  /**
   * Gate ids no question claimed. Empty in every configuration this repository
   * ships; non-empty forces the verdict to `unjudged` rather than being tidied
   * away, so a gate family added upstream cannot be answered over.
   */
  readonly unattributed: readonly string[];
}

function findingFor(gate: GateResult, question: FairnessQuestion, games: number): FairnessFinding | null {
  const margin = gateMargin(gate);
  if (margin === null) return null;
  const noise = scaledSeedDeviation(gate.id, games);
  return {
    gate: gate.id,
    question,
    label: gate.label,
    measured: margin.observed,
    required: margin.edge,
    distance: margin.distance,
    noise,
    // The same comparison the re-classifier makes, made in one place rather
    // than subtracted a second time here.
    withinNoise: seedNoiseAbstention(gate, games) !== null,
    detail: gate.detail,
  };
}

/**
 * The three ways a gate can decline to answer, and none of them is a pass.
 *
 * They are kept apart because they are three different instructions to the
 * reader: buy more games, accept that this subject has nothing to measure, or
 * accept that at this volume the miss and the dice are the same size. The
 * third is the one that has a lever attached — a bigger sweep narrows the
 * deviation and the band comes back — so its sentence names the volume.
 */
function unjudgedFor(gate: GateResult): UnjudgedGate | null {
  if (gate.status === 'withinNoise') {
    return {
      gate: gate.id,
      label: gate.label,
      status: 'withinNoise',
      reason: `the miss is inside the dice at this volume, so this run cannot judge it: ${gate.detail}`,
    };
  }
  if (gate.status === 'underSampled') {
    return {
      gate: gate.id,
      label: gate.label,
      status: 'underSampled',
      reason: `this run did not buy enough evidence to judge it: ${gate.detail}`,
    };
  }
  if (gate.status === 'notApplicable') {
    return {
      gate: gate.id,
      label: gate.label,
      status: 'notApplicable',
      reason: `there is nothing in this set for it to measure: ${gate.detail}`,
    };
  }
  return null;
}

/**
 * A reading is fair only when something passed and nothing else happened.
 *
 * The `passed === 0` arm is the one worth reading twice, because it covers two
 * different silences and both of them must not read as green. A question whose
 * every gate abstained has neither passed nor failed. And a question with *no
 * gates at all* was never asked: `evaluateGates` omits `abilities.*` entirely
 * unless the caller supplied the pool, so a run measured from logs alone
 * cannot say whether the cards get used, and a dashboard calling that set fair
 * would be answering a question nobody put to it.
 */
function verdictOf(passed: number, findings: number, unjudged: number): FairnessVerdict {
  if (findings > 0) return 'unfair';
  if (unjudged > 0 || passed === 0) return 'unjudged';
  return 'fair';
}

/** Why a reading came back `unjudged` with nothing in it to point at. */
export const NOT_ASKED = 'this run measured no gate for it';

function readingFor(
  question: FairnessQuestion,
  gates: readonly GateResult[],
  games: number,
): FairnessReading {
  const mine = gates.filter((gate) => questionOf(gate.id) === question);
  const findings = mine
    .filter((gate) => gate.status === 'fail')
    .flatMap((gate) => {
      const finding = findingFor(gate, question, games);
      return finding === null ? [] : [finding];
    });
  const unjudged = mine.flatMap((gate) => {
    const entry = unjudgedFor(gate);
    return entry === null ? [] : [entry];
  });
  const passed = mine.filter((gate) => gate.status === 'pass').length;
  return {
    question,
    asks: FAIRNESS_ASKS[question],
    verdict: verdictOf(passed, findings.length, unjudged.length),
    gates: mine.map((gate) => gate.id),
    passed,
    findings,
    unjudged,
  };
}

/**
 * The answer, over one measured run.
 *
 * A pure function of the health object: no IO, no clock, no model. The
 * judgment half of "is the set fair" — what a failing band means for the set
 * and what to change about it — is deliberately not here, because that is a
 * semantic question and this project sends those to a model (`CLAUDE.md`,
 * ZFC). What is here is the half a model should never be asked for: which
 * gates were held to which numbers, and by how much each one missed.
 */
export function fairness(health: FormatHealth): Fairness {
  const readings = FAIRNESS_QUESTIONS.map((question) => readingFor(question, health.gates, health.games));
  const unattributed = health.gates.filter((gate) => questionOf(gate.id) === null).map((gate) => gate.id);
  const findings = readings
    .flatMap((reading) => reading.findings)
    .toSorted((left, right) => right.distance - left.distance);
  const verdicts = readings.map((reading) => reading.verdict);
  const verdict: FairnessVerdict = verdicts.includes('unfair')
    ? 'unfair'
    : verdicts.includes('unjudged') || unattributed.length > 0
      ? 'unjudged'
      : 'fair';
  return {
    label: health.label,
    games: health.games,
    distinctGames: health.distinctGames,
    verdict,
    readings,
    findings,
    unattributed,
  };
}

/** Display label for a verdict; shared by the report and the lab. */
export function fairnessVerdictLabel(verdict: FairnessVerdict): string {
  switch (verdict) {
    case 'fair':
      return 'fair';
    case 'unfair':
      return 'not fair';
    case 'unjudged':
      return 'not judged';
  }
}

/**
 * The finding as a sentence, assembled from the same numbers it carries.
 *
 * Written here rather than at each call site for `@mtg/cube`'s reason: a
 * sentence composed independently of the numbers beside it drifts from them,
 * and then two things on one screen disagree.
 */
export function findingLine(finding: FairnessFinding): string {
  const noise =
    finding.withinNoise && finding.noise !== null
      ? ` — inside the ${finding.noise.toFixed(3)} this statistic moves on the seed alone, so another seed could put it either side`
      : '';
  return (
    `${finding.gate}: measured ${finding.measured.toFixed(3)} against ${finding.required.toFixed(3)}, ` +
    `missing it by ${finding.distance.toFixed(3)}${noise}`
  );
}

/**
 * The whole answer as prose, for a terminal.
 *
 * Every reading is printed, including the ones nothing failed on, because
 * leaving a passing question out would hide the shape of the answer behind the
 * subset that happened to go wrong — the same rule `@mtg/cube`'s report states.
 */
export function formatFairness(result: Fairness): string {
  const lines: string[] = [
    `Is the set fair? ${fairnessVerdictLabel(result.verdict).toUpperCase()} ` +
      `— over ${result.games} games (${result.distinctGames} distinct trajectories).`,
    '',
  ];
  for (const reading of result.readings) {
    const census =
      reading.gates.length === 0 ? NOT_ASKED : `${reading.passed} of ${reading.gates.length} gates passed`;
    lines.push(`${reading.asks} ${fairnessVerdictLabel(reading.verdict)} (${census})`);
    for (const finding of reading.findings) lines.push(`  - ${findingLine(finding)}`);
    for (const entry of reading.unjudged) lines.push(`  - ${entry.gate}: ${entry.reason}`);
  }
  if (result.unattributed.length > 0) {
    lines.push(
      '',
      `Gates no question reads, so this run cannot be called fair: ${result.unattributed.join(', ')}`,
    );
  }
  return `${lines.join('\n')}\n`;
}
