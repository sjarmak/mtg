/**
 * Building one analysis document, in one place.
 *
 * The pieces of this used to live inside
 * `test/analysis/fixtures/make-fixtures.ts`, which is a script that produces
 * four committed fixtures over a frozen set. That was the only producer of an
 * `AnalysisRun` that has ever existed, so the dashboard reading them had never
 * been pointed at a set anybody was working on. Split out here, the same
 * function serves both: the fixture script keeps its four pinned specs, and
 * `analyze.ts` points it at whatever set the launcher resolves.
 *
 * The output is typed as `AnalysisRun` — the reader's own model, imported from
 * `src/` — rather than as `unknown` serialized into a file. That is the whole
 * of the seam's protection on this side: a field the reader requires and the
 * producer stopped writing fails `tsc` here rather than fails a fetch in a
 * browser. `readAnalysisRun` still validates the file on the way in, because
 * the file on disk may be older than either side.
 */
import type { Card, Color } from '@mtg/dsl';
import type { DeckList } from '@mtg/kernel';
import type { RoundRobinRun, SimGameLog } from '@mtg/sim';
import { roundRobinSpecs } from '@mtg/sim';
import type { AbilityPool, FormatHealth, MetricsConfig } from '@mtg/metrics';
import {
  abilityPool,
  fairness,
  formatHealth,
  gameFingerprint,
  intervalHalfWidth,
  wilsonInterval,
} from '@mtg/metrics';
import type { SkeletonLiteProfile, SliceRarity } from '@mtg/design-data';
import { cardColorIdentity } from '../src/card/identity';
import type {
  CardPerformance,
  CardPerformanceBlock,
  NumericBand,
  PreconMatchupBlock,
  PreconMatchupCell,
  RunFairness,
  RunSetRef,
  SkeletonTargets,
} from '../src/routes/analysis/model';

/**
 * The document as it is written, which is a superset of what is read back.
 *
 * `health` is `@mtg/metrics`' `FormatHealth` **verbatim** — the reader's
 * `RunHealth` is a narrowing of it (it drops the mana, on-play, matchup,
 * dominance and ability blocks the charts do not draw, and lifts a few bands
 * out of `config`), so the two types are deliberately not the same type and
 * this one cannot be stated as `AnalysisRun`. Writing the whole object is the
 * cheap direction: a chart added later needs no new producer.
 *
 * The other three fields *are* the reader's own types, so a producer that
 * stopped writing a field the reader requires fails `tsc` here. What holds the
 * `health` half honest is `test/analysis/round-trip.test.ts`, which pushes a
 * document this function built through `readAnalysisRun`.
 */
export interface AnalysisDocument {
  readonly id: string;
  readonly label: string;
  readonly seed: string;
  readonly set: RunSetRef;
  readonly producedBy: string;
  readonly health: FormatHealth;
  readonly fairness: RunFairness;
  readonly targets: SkeletonTargets;
  readonly cards: CardPerformanceBlock;
  readonly precons: PreconMatchupBlock | null;
}

export interface PreconAnalysisDeck extends DeckList {
  readonly id: string;
  readonly plan: string;
  readonly payoff: string;
  readonly contentHash: string;
}

export interface PreconMatchupOptions {
  readonly band?: NumericBand;
  readonly maxIntervalHalfWidth?: number;
}

export interface PreconSeatOrderRun {
  readonly decks: readonly PreconAnalysisDeck[];
  readonly run: RoundRobinRun;
  readonly runSeed: string;
}

const DEFAULT_PRECON_BAND: NumericBand = { min: 0.42, max: 0.58 };
const DEFAULT_PRECON_HALF_WIDTH = 0.03;

/**
 * Preserve the round-robin schedule as the pairing authority.
 *
 * Deck names may contain hyphens, so recovering them from `aggregate.runSeed`
 * is ambiguous. The exported schedule is zipped to the runs positionally and
 * every seed is checked only as an integrity assertion, never parsed.
 */
export function preconMatchups(
  decks: readonly PreconAnalysisDeck[],
  seatRuns: readonly PreconSeatOrderRun[],
  options: PreconMatchupOptions = {},
): PreconMatchupBlock {
  if (seatRuns.length === 0) throw new Error('precon matchups need at least one seat order');
  const ids = new Set(decks.map((deck) => deck.id));
  const names = new Set(decks.map((deck) => deck.name));
  if (ids.size !== decks.length) throw new Error('precon matchup decks need unique ids');
  if (names.size !== decks.length) throw new Error('precon matchup decks need unique names');

  const byName = new Map(decks.map((deck) => [deck.name, deck]));
  const band = options.band ?? DEFAULT_PRECON_BAND;
  const maxIntervalHalfWidth = options.maxIntervalHalfWidth ?? DEFAULT_PRECON_HALF_WIDTH;
  const gamesPerMatchup = seatRuns[0]?.run.gamesPerMatchup ?? 0;
  const tallies = new Map<string, { games: number; wins: number; losses: number; draws: number }>();
  for (const seatRun of seatRuns) {
    if (seatRun.run.gamesPerMatchup !== gamesPerMatchup) {
      throw new Error('precon seat-order runs disagree on games per matchup');
    }
    const runIds = new Set(seatRun.decks.map((deck) => deck.id));
    if (runIds.size !== ids.size || [...ids].some((id) => !runIds.has(id))) {
      throw new Error('precon seat-order run does not contain the same decks');
    }
    const specs = roundRobinSpecs(seatRun.decks, {
      runSeed: seatRun.runSeed,
      gamesPerMatchup: seatRun.run.gamesPerMatchup,
    });
    if (specs.length !== seatRun.run.runs.length) {
      throw new Error(
        `precon matchup schedule has ${String(specs.length)} pairings but the run has ${String(seatRun.run.runs.length)}`,
      );
    }
    for (const [index, spec] of specs.entries()) {
      const measured = seatRun.run.runs[index];
      if (measured === undefined) throw new Error(`precon matchup run ${String(index)} is missing`);
      if (measured.aggregate.runSeed !== spec.runSeed) {
        throw new Error(
          `precon matchup run ${String(index)} has seed ${measured.aggregate.runSeed}; expected ${spec.runSeed}`,
        );
      }
      const first = byName.get(spec.decks[0].name);
      const second = byName.get(spec.decks[1].name);
      if (first === undefined || second === undefined) {
        throw new Error('precon matchup schedule names an unknown deck');
      }
      for (const seat of [0, 1] as const) {
        const deck = seat === 0 ? first : second;
        const opponent = seat === 0 ? second : first;
        const key = `${deck.id}\u0000${opponent.id}`;
        const found = tallies.get(key) ?? { games: 0, wins: 0, losses: 0, draws: 0 };
        found.games += measured.aggregate.games;
        found.wins += measured.aggregate.wins[seat];
        found.losses += measured.aggregate.wins[seat === 0 ? 1 : 0];
        found.draws += measured.aggregate.draws;
        tallies.set(key, found);
      }
    }
  }

  const cells: PreconMatchupCell[] = [];
  for (let first = 0; first < decks.length; first += 1) {
    for (let second = first + 1; second < decks.length; second += 1) {
      const pair = [decks[first], decks[second]];
      for (const seat of [0, 1] as const) {
        const deck = pair[seat];
        const opponent = pair[seat === 0 ? 1 : 0];
        if (deck === undefined || opponent === undefined) throw new Error('precon matchup deck is missing');
        const tally = tallies.get(`${deck.id}\u0000${opponent.id}`);
        if (tally === undefined)
          throw new Error(`precon matchup is missing ${deck.id} against ${opponent.id}`);
        const decided = tally.wins + tally.losses;
        const rawRate = decided === 0 ? 0 : tally.wins / decided;
        const rawInterval = decided === 0 ? { low: 0, high: 1 } : wilsonInterval(tally.wins, decided);
        const halfWidth = intervalHalfWidth(rawInterval);
        const judged = decided > 0 && halfWidth <= maxIntervalHalfWidth;
        cells.push({
          deckId: deck.id,
          opponentId: opponent.id,
          ...tally,
          winRate: judged ? rawRate : null,
          interval: judged ? rawInterval : null,
          intervalHalfWidth: halfWidth,
          status: judged
            ? rawRate >= band.min && rawRate <= band.max
              ? 'healthy'
              : 'outside'
            : 'underSampled',
        });
      }
    }
  }

  return {
    decks: decks.map(({ id, name, plan, payoff, contentHash }) => ({ id, name, plan, payoff, contentHash })),
    planExecution: {
      status: 'unavailable',
      reason:
        'The artifact carries authored plan and payoff statements, but this matchup run does not measure whether those plans executed.',
    },
    seatOrders: seatRuns.length,
    games: seatRuns.reduce((sum, entry) => sum + entry.run.games, 0),
    gamesPerMatchup,
    band,
    maxIntervalHalfWidth,
    cells,
  };
}

/** Cards below this many distinct trajectories get a `null` rate, as 17lands does. */
export const CARD_FLOOR = 200;

const RARITIES: readonly SliceRarity[] = ['common', 'uncommon'];
const COLOR_TO_IDENTITY: Readonly<Record<Color, 'w' | 'u' | 'b' | 'r' | 'g'>> = {
  W: 'w',
  U: 'u',
  B: 'b',
  R: 'r',
  G: 'g',
};

/** The design intent the set was generated against, flattened for the charts. */
export function skeletonTargets(profile: SkeletonLiteProfile): SkeletonTargets {
  const curve = new Map<string, { mvMin: number; mvMax: number; cards: number }>();
  let creatures = 0;
  const plans = [
    ...Object.values(profile.colors).flatMap((byRarity) => RARITIES.map((rarity) => byRarity[rarity])),
    ...RARITIES.map((rarity) => profile.colorless[rarity]),
  ];
  for (const plan of plans) {
    creatures += plan.creatures;
    for (const bucket of plan.creatureCurve) {
      const key = `${bucket.mvMin}-${bucket.mvMax}`;
      const found = curve.get(key);
      if (found === undefined)
        curve.set(key, { mvMin: bucket.mvMin, mvMax: bucket.mvMax, cards: bucket.count });
      else found.cards += bucket.count;
    }
  }

  return {
    profile: `${profile.profile} v${profile.version}`,
    setSize: profile.setSize,
    creatureShare: creatures / profile.setSize,
    rarities: RARITIES.map((rarity) => ({ rarity, cards: profile.rarityTotals[rarity] })),
    colors: [
      ...Object.entries(profile.colors).map(([color, byRarity]) => ({
        identity: COLOR_TO_IDENTITY[color as Color],
        cards: RARITIES.reduce((sum, rarity) => sum + byRarity[rarity].cards, 0),
      })),
      {
        identity: 'c' as const,
        cards: RARITIES.reduce((sum, rarity) => sum + profile.colorless[rarity].cards, 0),
      },
    ],
    curve: [...curve.values()]
      .sort((left, right) => left.mvMin - right.mvMin || left.mvMax - right.mvMax)
      .map((bucket) => ({
        label: bucket.mvMin === bucket.mvMax ? String(bucket.mvMin) : `${bucket.mvMin}-${bucket.mvMax}`,
        mvMin: bucket.mvMin,
        mvMax: bucket.mvMax,
        cards: bucket.cards,
      })),
  };
}

interface CardTally {
  readonly card: Card;
  readonly fingerprints: Set<string>;
  games: number;
  wins: number;
}

/**
 * The per-card block, measured from the same logs.
 *
 * This is 17lands' *games-played* win rate, not games-in-hand: the replay
 * schema records per-turn aggregates rather than card instances, so which
 * cards were drawn is not recoverable from a log. Saying so in `statistic` and
 * `definition` is the honest move — the view prints whatever it is told the
 * statistic is, so when the card-instance columns land only these two strings
 * change.
 */
export function cardPerformance(
  logs: readonly SimGameLog[],
  decks: readonly DeckList[],
): CardPerformanceBlock {
  const byDeck = new Map(decks.map((deck) => [deck.name, deck.cards]));
  const tallies = new Map<string, CardTally>();

  for (const log of logs) {
    if (log.extras.sim_winner === null) continue;
    const fingerprint = gameFingerprint(log);
    for (const side of ['user', 'oppo'] as const) {
      const deckName = side === 'user' ? log.extras.sim_user_deck : log.extras.sim_oppo_deck;
      const deck = byDeck.get(deckName);
      if (deck === undefined) throw new Error(`log names deck ${deckName}, which was not in the sweep`);
      const won = log.extras.sim_winner === (side === 'user' ? 0 : 1);
      for (const card of new Set(deck)) {
        const tally = tallies.get(card.id) ?? { card, fingerprints: new Set<string>(), games: 0, wins: 0 };
        tally.games += 1;
        if (won) tally.wins += 1;
        tally.fingerprints.add(`${fingerprint}#${side}`);
        tallies.set(card.id, tally);
      }
    }
  }

  const entries: readonly CardPerformance[] = [...tallies.values()]
    .map((tally) => {
      const distinctGames = tally.fingerprints.size;
      return {
        cardId: tally.card.id,
        name: tally.card.name,
        rarity: tally.card.rarity,
        identity: cardColorIdentity(tally.card),
        games: tally.games,
        distinctGames,
        wins: tally.wins,
        winRate: distinctGames < CARD_FLOOR ? null : tally.wins / tally.games,
      };
    })
    .sort((left, right) => left.cardId.localeCompare(right.cardId));

  return {
    statistic: 'GP WR (self-play)',
    definition:
      'Win rate over decided side-games in which the card was in the played deck. 17lands’ GIH WR ' +
      'needs card-instance columns the sim replay schema does not record, so this is its coarsest ' +
      'honest stand-in: games played, not games in hand.',
    floor: CARD_FLOOR,
    entries,
  };
}

/**
 * The fairness block, as it travels.
 *
 * `label`, `games` and `distinctGames` are dropped on the way in because the
 * health block beside it already carries all three, and two copies of a game
 * count in one document is one copy that can disagree with the other.
 */
function fairnessBlock(health: FormatHealth): RunFairness {
  const result = fairness(health);
  return {
    verdict: result.verdict,
    readings: result.readings,
    findings: result.findings,
    unattributed: result.unattributed,
  };
}

export interface AnalysisRunInput {
  /** Stable across revisions of the same run; the diff view keys on it. */
  readonly id: string;
  readonly label: string;
  readonly seed: string;
  readonly set: { readonly code: string; readonly name: string };
  /** The command that produced it, shown in the header. */
  readonly producedBy: string;
  /** The cards the sweep was played on, for the ability pool and nothing else. */
  readonly pool: readonly Card[];
  readonly decks: readonly DeckList[];
  readonly logs: readonly SimGameLog[];
  readonly targets: SkeletonTargets;
  readonly config?: MetricsConfig;
  readonly healthLabel: string;
  readonly precons?:
    | {
        readonly decks: readonly PreconAnalysisDeck[];
        readonly seatRuns: readonly PreconSeatOrderRun[];
      }
    | undefined;
}

/**
 * One measured run, as a document.
 *
 * The ability pool is derived from the set's own cards and passed to
 * `formatHealth`, which is the one input a caller holding logs alone cannot
 * supply — and without it the two `abilities.*` gates are not emitted at all,
 * so the fairness reading for "do the cards get used?" comes back not-asked.
 * The slice's verdict stage has exactly that hole; this producer does not,
 * because it is standing next to the set.
 */
export function buildAnalysisRun(input: AnalysisRunInput): AnalysisDocument {
  const pool: AbilityPool = abilityPool(input.pool);
  const health = formatHealth(input.logs, {
    label: input.healthLabel,
    pool,
    ...(input.config === undefined ? {} : { config: input.config }),
  });
  return {
    id: input.id,
    label: input.label,
    seed: input.seed,
    set: input.set,
    producedBy: input.producedBy,
    health,
    fairness: fairnessBlock(health),
    targets: input.targets,
    cards: cardPerformance(input.logs, input.decks),
    precons: input.precons === undefined ? null : preconMatchups(input.precons.decks, input.precons.seatRuns),
  };
}
