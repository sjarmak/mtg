/**
 * The document reader: untrusted JSON in, `AnalysisRun` out or an error naming
 * the field.
 *
 * Same discipline as the replay reader — every field is looked up by name and
 * typechecked, and a missing or wrongly-typed one raises rather than defaulting.
 * A silent zero in a balance dashboard is a wrong number wearing the costume of
 * a right one, and the whole point of this surface is to be trusted at a glance.
 *
 * `null` is a *value* here, not an absence: `winRate: null` means the producer
 * withheld an under-sampled statistic, and reading it as missing would erase the
 * one distinction the route exists to preserve.
 */
import { parseCards } from '@mtg/dsl';
import { COLOR_IDENTITIES } from '../../styles/tokens';
import type { ColorIdentity } from '../../styles/tokens';
import type {
  AnalysisRun,
  CardPerformance,
  CardPerformanceBlock,
  ColorPairRecord,
  ColorPairReport,
  ColorTarget,
  CurveTarget,
  Decisiveness,
  GameLength,
  GateBand,
  GateStatus,
  HealthBands,
  LengthSummary,
  NumericBand,
  PreconMatchupBlock,
  PreconMatchupCell,
  PreconMatchupDeck,
  PreconMatchupStatus,
  RarityTarget,
  RunFairness,
  RunFairnessReading,
  RunFinding,
  RunGate,
  RunHealth,
  RunUnjudged,
  SampledValue,
  SetDocument,
  SkeletonTargets,
  WinRateInterval,
} from './model';
import { FAIRNESS_QUESTIONS, FAIRNESS_VERDICTS, GATE_STATUSES } from './model';

export class AnalysisDataError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`analysis document ${path}: ${message}`);
    this.name = 'AnalysisDataError';
    this.path = path;
  }
}

type Raw = Readonly<Record<string, unknown>>;

function record(value: unknown, path: string): Raw {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AnalysisDataError(path, 'expected an object');
  }
  return value as Raw;
}

function field(source: Raw, key: string, path: string): unknown {
  if (!(key in source)) throw new AnalysisDataError(`${path}.${key}`, 'missing');
  return source[key];
}

function num(source: Raw, key: string, path: string): number {
  const value = field(source, key, path);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AnalysisDataError(`${path}.${key}`, 'expected a finite number');
  }
  return value;
}

/** A number that may legitimately be `null` because it was withheld. */
function maybeNum(source: Raw, key: string, path: string): number | null {
  const value = field(source, key, path);
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AnalysisDataError(`${path}.${key}`, 'expected a finite number or null');
  }
  return value;
}

function str(source: Raw, key: string, path: string): string {
  const value = field(source, key, path);
  if (typeof value !== 'string') throw new AnalysisDataError(`${path}.${key}`, 'expected a string');
  return value;
}

function bool(source: Raw, key: string, path: string): boolean {
  const value = field(source, key, path);
  if (typeof value !== 'boolean') throw new AnalysisDataError(`${path}.${key}`, 'expected a boolean');
  return value;
}

function list(source: Raw, key: string, path: string): readonly unknown[] {
  const value = field(source, key, path);
  if (!Array.isArray(value)) throw new AnalysisDataError(`${path}.${key}`, 'expected an array');
  return value;
}

function strings(source: Raw, key: string, path: string): readonly string[] {
  return list(source, key, path).map((entry, index) => {
    if (typeof entry !== 'string')
      throw new AnalysisDataError(`${path}.${key}[${index}]`, 'expected a string');
    return entry;
  });
}

function numbers(source: Raw, key: string, path: string): readonly number[] {
  return list(source, key, path).map((entry, index) => {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      throw new AnalysisDataError(`${path}.${key}[${index}]`, 'expected a finite number');
    }
    return entry;
  });
}

function nested(source: Raw, key: string, path: string): { raw: Raw; path: string } {
  const at = `${path}.${key}`;
  return { raw: record(field(source, key, path), at), path: at };
}

function identity(source: Raw, key: string, path: string): ColorIdentity {
  const value = str(source, key, path);
  const match = COLOR_IDENTITIES.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new AnalysisDataError(`${path}.${key}`, `unknown color identity ${JSON.stringify(value)}`);
  }
  return match;
}

function band(source: Raw, key: string, path: string): NumericBand {
  const { raw, path: at } = nested(source, key, path);
  return { min: num(raw, 'min', at), max: num(raw, 'max', at) };
}

function sampledValue<T>(
  source: Raw,
  key: string,
  path: string,
  readValue: (value: unknown, path: string) => T,
): SampledValue<T> {
  const { raw, path: at } = nested(source, key, path);
  const inner = field(raw, 'value', at);
  return {
    value: inner === null ? null : readValue(inner, `${at}.value`),
    samples: num(raw, 'samples', at),
    distinctSamples: num(raw, 'distinctSamples', at),
    floor: num(raw, 'floor', at),
    underSampled: bool(raw, 'underSampled', at),
  };
}

function readNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AnalysisDataError(path, 'expected a finite number');
  }
  return value;
}

function readInterval(value: unknown, path: string): WinRateInterval {
  const raw = record(value, path);
  return { low: num(raw, 'low', path), high: num(raw, 'high', path) };
}

function readSummary(raw: Raw, path: string): LengthSummary {
  return {
    count: num(raw, 'count', path),
    mean: num(raw, 'mean', path),
    median: num(raw, 'median', path),
    p10: num(raw, 'p10', path),
    p25: num(raw, 'p25', path),
    p75: num(raw, 'p75', path),
    p90: num(raw, 'p90', path),
    iqr: num(raw, 'iqr', path),
    min: num(raw, 'min', path),
    max: num(raw, 'max', path),
  };
}

function readGameLength(value: unknown, path: string): GameLength {
  const raw = record(value, path);
  const rounds = nested(raw, 'rounds', path);
  return {
    rounds: readSummary(rounds.raw, rounds.path),
    roundHistogram: numbers(raw, 'roundHistogram', path),
    finishedByRound: numbers(raw, 'finishedByRound', path),
    modalRound: num(raw, 'modalRound', path),
    longGameShare: num(raw, 'longGameShare', path),
    blowoutShare: num(raw, 'blowoutShare', path),
  };
}

function readDecisiveness(value: unknown, path: string): Decisiveness {
  const raw = record(value, path);
  return {
    stallRate: num(raw, 'stallRate', path),
    deckOutRate: num(raw, 'deckOutRate', path),
    drawRate: num(raw, 'drawRate', path),
    decidedByRound: num(raw, 'decidedByRound', path),
    decisiveRound: num(raw, 'decisiveRound', path),
    inertTurnRate: num(raw, 'inertTurnRate', path),
    inertTurnsPerGame: num(raw, 'inertTurnsPerGame', path),
  };
}

/** A band whose sides are numbers or, for an open side, `null`. */
function gateBand(source: Raw, key: string, path: string): GateBand {
  const { raw, path: at } = nested(source, key, path);
  return { min: maybeNum(raw, 'min', at), max: maybeNum(raw, 'max', at) };
}

function readGate(value: unknown, path: string): RunGate {
  const raw = record(value, path);
  const status = str(raw, 'status', path);
  const known = GATE_STATUSES.find((candidate) => candidate === status);
  if (known === undefined) {
    throw new AnalysisDataError(`${path}.status`, `unknown gate status ${JSON.stringify(status)}`);
  }
  return {
    id: str(raw, 'id', path),
    label: str(raw, 'label', path),
    status: known satisfies GateStatus,
    observed: maybeNum(raw, 'observed', path),
    bound: str(raw, 'bound', path),
    band: gateBand(raw, 'band', path),
    detail: str(raw, 'detail', path),
    source: str(raw, 'source', path),
  };
}

function readFinding(value: unknown, path: string): RunFinding {
  const raw = record(value, path);
  const question = str(raw, 'question', path);
  const known = FAIRNESS_QUESTIONS.find((candidate) => candidate === question);
  if (known === undefined) {
    throw new AnalysisDataError(`${path}.question`, `unknown fairness question ${JSON.stringify(question)}`);
  }
  return {
    gate: str(raw, 'gate', path),
    question: known,
    label: str(raw, 'label', path),
    measured: num(raw, 'measured', path),
    required: num(raw, 'required', path),
    distance: num(raw, 'distance', path),
    noise: maybeNum(raw, 'noise', path),
    withinNoise: bool(raw, 'withinNoise', path),
    detail: str(raw, 'detail', path),
  };
}

function readUnjudged(value: unknown, path: string): RunUnjudged {
  const raw = record(value, path);
  const status = str(raw, 'status', path);
  if (status !== 'underSampled' && status !== 'notApplicable' && status !== 'withinNoise') {
    throw new AnalysisDataError(
      `${path}.status`,
      `an unjudged gate is under-sampled, not applicable, or inside the seed noise, ` +
        `not ${JSON.stringify(status)}`,
    );
  }
  return {
    gate: str(raw, 'gate', path),
    label: str(raw, 'label', path),
    status,
    reason: str(raw, 'reason', path),
  };
}

function readReading(value: unknown, path: string): RunFairnessReading {
  const raw = record(value, path);
  const question = str(raw, 'question', path);
  const known = FAIRNESS_QUESTIONS.find((candidate) => candidate === question);
  if (known === undefined) {
    throw new AnalysisDataError(`${path}.question`, `unknown fairness question ${JSON.stringify(question)}`);
  }
  const verdict = str(raw, 'verdict', path);
  const knownVerdict = FAIRNESS_VERDICTS.find((candidate) => candidate === verdict);
  if (knownVerdict === undefined) {
    throw new AnalysisDataError(`${path}.verdict`, `unknown fairness verdict ${JSON.stringify(verdict)}`);
  }
  return {
    question: known,
    asks: str(raw, 'asks', path),
    verdict: knownVerdict,
    gates: strings(raw, 'gates', path),
    passed: num(raw, 'passed', path),
    findings: list(raw, 'findings', path).map((entry, index) =>
      readFinding(entry, `${path}.findings[${index}]`),
    ),
    unjudged: list(raw, 'unjudged', path).map((entry, index) =>
      readUnjudged(entry, `${path}.unjudged[${index}]`),
    ),
  };
}

/**
 * The fairness block.
 *
 * A document is required to carry all four readings, in order. A producer that
 * dropped one would otherwise hand the route a verdict over three questions
 * while the page drew four headings, and the missing one would read as absent
 * rather than as unasked.
 */
function readFairness(raw: Raw, path: string): RunFairness {
  const at = `${path}.fairness`;
  const fair = record(field(raw, 'fairness', path), at);
  const verdict = str(fair, 'verdict', at);
  const known = FAIRNESS_VERDICTS.find((candidate) => candidate === verdict);
  if (known === undefined) {
    throw new AnalysisDataError(`${at}.verdict`, `unknown fairness verdict ${JSON.stringify(verdict)}`);
  }
  const readings = list(fair, 'readings', at).map((entry, index) =>
    readReading(entry, `${at}.readings[${index}]`),
  );
  const asked = readings.map((reading) => reading.question);
  if (asked.length !== FAIRNESS_QUESTIONS.length || FAIRNESS_QUESTIONS.some((q, i) => asked[i] !== q)) {
    throw new AnalysisDataError(
      `${at}.readings`,
      `expected the four questions in order (${FAIRNESS_QUESTIONS.join(', ')}), got ${asked.join(', ')}`,
    );
  }
  return {
    verdict: known,
    readings,
    findings: list(fair, 'findings', at).map((entry, index) =>
      readFinding(entry, `${at}.findings[${index}]`),
    ),
    unattributed: strings(fair, 'unattributed', at),
  };
}

function readColorPairRecord(value: unknown, path: string): ColorPairRecord {
  const raw = record(value, path);
  return {
    pair: str(raw, 'pair', path),
    games: num(raw, 'games', path),
    wins: num(raw, 'wins', path),
    losses: num(raw, 'losses', path),
    draws: num(raw, 'draws', path),
    winRate: sampledValue(raw, 'winRate', path, readNumber),
    interval: sampledValue(raw, 'interval', path, readInterval),
    medianRounds: maybeNum(raw, 'medianRounds', path),
    medianWinRounds: maybeNum(raw, 'medianWinRounds', path),
    fastWinShare: maybeNum(raw, 'fastWinShare', path),
  };
}

function readColorPairs(raw: Raw, path: string): ColorPairReport {
  const inner = nested(raw, 'colorPairs', path);
  return {
    records: list(inner.raw, 'records', inner.path).map((entry, index) =>
      readColorPairRecord(entry, `${inner.path}.records[${index}]`),
    ),
    mirrorGames: num(inner.raw, 'mirrorGames', inner.path),
    spread: maybeNum(inner.raw, 'spread', inner.path),
  };
}

function readBands(raw: Raw, path: string): HealthBands {
  const config = nested(raw, 'config', path);
  const length = nested(config.raw, 'length', config.path);
  const balance = nested(config.raw, 'balance', config.path);
  const decisive = nested(config.raw, 'decisiveness', config.path);
  return {
    length: {
      medianRounds: band(length.raw, 'medianRounds', length.path),
      longGameRound: num(length.raw, 'longGameRound', length.path),
      maxLongGameShare: num(length.raw, 'maxLongGameShare', length.path),
      maxIqrRounds: num(length.raw, 'maxIqrRounds', length.path),
    },
    balance: {
      colorPairWinRate: band(balance.raw, 'colorPairWinRate', balance.path),
      maxWinRateSpread: num(balance.raw, 'maxWinRateSpread', balance.path),
    },
    decisiveness: {
      maxStallRate: num(decisive.raw, 'maxStallRate', decisive.path),
      maxDeckOutRate: num(decisive.raw, 'maxDeckOutRate', decisive.path),
      decisiveRound: num(decisive.raw, 'decisiveRound', decisive.path),
      minDecidedByRound: num(decisive.raw, 'minDecidedByRound', decisive.path),
      maxInertTurnRate: num(decisive.raw, 'maxInertTurnRate', decisive.path),
    },
  };
}

function readHealth(raw: Raw, path: string): RunHealth {
  const health = nested(raw, 'health', path);
  return {
    label: str(health.raw, 'label', health.path),
    games: num(health.raw, 'games', health.path),
    distinctGames: num(health.raw, 'distinctGames', health.path),
    duplicateShare: num(health.raw, 'duplicateShare', health.path),
    gameLength: sampledValue(health.raw, 'gameLength', health.path, readGameLength),
    decisiveness: sampledValue(health.raw, 'decisiveness', health.path, readDecisiveness),
    colorPairs: readColorPairs(health.raw, health.path),
    gates: list(health.raw, 'gates', health.path).map((entry, index) =>
      readGate(entry, `${health.path}.gates[${index}]`),
    ),
    bands: readBands(health.raw, health.path),
  };
}

function readCurveTarget(value: unknown, path: string): CurveTarget {
  const raw = record(value, path);
  return {
    label: str(raw, 'label', path),
    mvMin: num(raw, 'mvMin', path),
    mvMax: maybeNum(raw, 'mvMax', path),
    cards: num(raw, 'cards', path),
  };
}

function readTargets(raw: Raw, path: string): SkeletonTargets {
  const targets = nested(raw, 'targets', path);
  const rarities: readonly RarityTarget[] = list(targets.raw, 'rarities', targets.path).map(
    (entry, index) => {
      const at = `${targets.path}.rarities[${index}]`;
      const row = record(entry, at);
      return { rarity: str(row, 'rarity', at), cards: num(row, 'cards', at) };
    },
  );
  const colors: readonly ColorTarget[] = list(targets.raw, 'colors', targets.path).map((entry, index) => {
    const at = `${targets.path}.colors[${index}]`;
    const row = record(entry, at);
    return { identity: identity(row, 'identity', at), cards: num(row, 'cards', at) };
  });
  return {
    profile: str(targets.raw, 'profile', targets.path),
    setSize: num(targets.raw, 'setSize', targets.path),
    creatureShare: num(targets.raw, 'creatureShare', targets.path),
    rarities,
    colors,
    curve: list(targets.raw, 'curve', targets.path).map((entry, index) =>
      readCurveTarget(entry, `${targets.path}.curve[${index}]`),
    ),
  };
}

function readCardPerformance(value: unknown, path: string): CardPerformance {
  const raw = record(value, path);
  return {
    cardId: str(raw, 'cardId', path),
    name: str(raw, 'name', path),
    rarity: str(raw, 'rarity', path),
    identity: identity(raw, 'identity', path),
    games: num(raw, 'games', path),
    distinctGames: num(raw, 'distinctGames', path),
    wins: num(raw, 'wins', path),
    winRate: maybeNum(raw, 'winRate', path),
  };
}

function readCards(raw: Raw, path: string): CardPerformanceBlock {
  const cards = nested(raw, 'cards', path);
  return {
    statistic: str(cards.raw, 'statistic', cards.path),
    definition: str(cards.raw, 'definition', cards.path),
    floor: num(cards.raw, 'floor', cards.path),
    entries: list(cards.raw, 'entries', cards.path).map((entry, index) =>
      readCardPerformance(entry, `${cards.path}.entries[${index}]`),
    ),
  };
}

function readPreconDeck(value: unknown, path: string): PreconMatchupDeck {
  const raw = record(value, path);
  return {
    id: str(raw, 'id', path),
    name: str(raw, 'name', path),
    plan: str(raw, 'plan', path),
    payoff: str(raw, 'payoff', path),
    contentHash: str(raw, 'contentHash', path),
  };
}

function readPreconCell(value: unknown, path: string): PreconMatchupCell {
  const raw = record(value, path);
  const status = str(raw, 'status', path);
  const known = (['healthy', 'outside', 'underSampled'] as const).find((entry) => entry === status);
  if (known === undefined) {
    throw new AnalysisDataError(`${path}.status`, `unknown precon matchup status ${JSON.stringify(status)}`);
  }
  const rawInterval = field(raw, 'interval', path);
  return {
    deckId: str(raw, 'deckId', path),
    opponentId: str(raw, 'opponentId', path),
    games: num(raw, 'games', path),
    wins: num(raw, 'wins', path),
    losses: num(raw, 'losses', path),
    draws: num(raw, 'draws', path),
    winRate: maybeNum(raw, 'winRate', path),
    interval: rawInterval === null ? null : readInterval(rawInterval, `${path}.interval`),
    intervalHalfWidth: num(raw, 'intervalHalfWidth', path),
    status: known satisfies PreconMatchupStatus,
  };
}

function readPrecons(raw: Raw, path: string): PreconMatchupBlock | null {
  if (!('precons' in raw) || raw['precons'] === null) return null;
  const at = `${path}.precons`;
  const precons = record(raw['precons'], at);
  const planExecutionRaw = record(field(precons, 'planExecution', at), `${at}.planExecution`);
  const planExecutionStatus = str(planExecutionRaw, 'status', `${at}.planExecution`);
  const planExecution: PreconMatchupBlock['planExecution'] =
    planExecutionStatus === 'measured'
      ? (() => {
          const samples = num(planExecutionRaw, 'samples', `${at}.planExecution`);
          if (samples <= 0) {
            throw new AnalysisDataError(
              `${at}.planExecution.samples`,
              'measured evidence needs positive samples',
            );
          }
          return {
            status: 'measured' as const,
            samples,
            evidence: str(planExecutionRaw, 'evidence', `${at}.planExecution`),
          };
        })()
      : planExecutionStatus === 'unavailable'
        ? {
            status: 'unavailable',
            reason: str(planExecutionRaw, 'reason', `${at}.planExecution`),
          }
        : (() => {
            throw new AnalysisDataError(
              `${at}.planExecution.status`,
              `unknown plan-execution status ${JSON.stringify(planExecutionStatus)}`,
            );
          })();
  const decks = list(precons, 'decks', at).map((entry, index) =>
    readPreconDeck(entry, `${at}.decks[${index}]`),
  );
  const cells = list(precons, 'cells', at).map((entry, index) =>
    readPreconCell(entry, `${at}.cells[${index}]`),
  );
  const deckIds = new Set(decks.map((deck) => deck.id));
  if (deckIds.size !== decks.length) throw new AnalysisDataError(`${at}.decks`, 'deck ids must be unique');
  for (const [index, cell] of cells.entries()) {
    if (!deckIds.has(cell.deckId) || !deckIds.has(cell.opponentId)) {
      throw new AnalysisDataError(`${at}.cells[${index}]`, 'names a deck id outside the matrix');
    }
    if ((cell.winRate === null) !== (cell.interval === null)) {
      throw new AnalysisDataError(`${at}.cells[${index}]`, 'winRate and interval must be withheld together');
    }
  }
  return {
    decks,
    planExecution,
    seatOrders: num(precons, 'seatOrders', at),
    games: num(precons, 'games', at),
    gamesPerMatchup: num(precons, 'gamesPerMatchup', at),
    band: band(precons, 'band', at),
    maxIntervalHalfWidth: num(precons, 'maxIntervalHalfWidth', at),
    cells,
  };
}

/** Parses one analysis document. Throws `AnalysisDataError` naming the field. */
export function readAnalysisRun(value: unknown, path = 'run'): AnalysisRun {
  const raw = record(value, path);
  const set = nested(raw, 'set', path);
  return {
    id: str(raw, 'id', path),
    label: str(raw, 'label', path),
    seed: str(raw, 'seed', path),
    set: { code: str(set.raw, 'code', set.path), name: str(set.raw, 'name', set.path) },
    producedBy: str(raw, 'producedBy', path),
    health: readHealth(raw, path),
    fairness: readFairness(raw, path),
    targets: readTargets(raw, path),
    cards: readCards(raw, path),
    precons: readPrecons(raw, path),
  };
}

/** Parses a JSON text holding one analysis document. */
export function parseAnalysisRun(text: string, path = 'run'): AnalysisRun {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new AnalysisDataError(path, `not valid JSON (${String(cause)})`);
  }
  return readAnalysisRun(value, path);
}

/**
 * Parses a `@mtg/setgen` set file into DSL cards.
 *
 * The cards go through `parseCards`, so a set the engine could not run cannot
 * reach a composition chart; the chart then measures what the engine measures.
 */
export function readSetDocument(value: unknown, path = 'set'): SetDocument {
  const raw = record(value, path);
  const set = nested(raw, 'set', path);
  return {
    code: str(set.raw, 'code', set.path),
    name: str(set.raw, 'name', set.path),
    cards: parseCards(list(raw, 'cards', path)),
  };
}

/** Parses a JSON text holding one `@mtg/setgen` set file. */
export function parseSetDocument(text: string, path = 'set'): SetDocument {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new AnalysisDataError(path, `not valid JSON (${String(cause)})`);
  }
  return readSetDocument(value, path);
}
