/**
 * What each trigger condition and each activated ability is actually worth,
 * measured off the gate's own sweep.
 *
 * `@mtg/deckbuild`'s `DEFAULT_TRIGGER_FIRE_COUNT` is the multiplier
 * `evaluateCard` puts on a triggered ability's effects: how many times the
 * ability fires over the life of the permanent, given it resolved. Every row of
 * it was a guess, and a guess in that table is not cosmetic — `buildDeckForPair`
 * ranks on the score, so a condition priced too low is a card the builder never
 * picks, a card the sweep never plays, and a format the gate calls fair with
 * its engine cards removed. This is the measurement that replaces the guess.
 *
 * The three **activation** weights ride the same sweep, and they ride it
 * because the cost here is the retained event stream and both censuses read the
 * same one. A second tool would buy 30,105 more games to count events this run
 * already has in hand. `activationUseCount`'s own note named this instrument
 * before it counted anything: "the sweep that priced the trigger table is the
 * instrument that would settle it".
 *
 * The arms are exclusive because the scorer does not stack them.
 * `activationUseCount` prices a plain paid ability, `activationTapFactor`
 * multiplies it when the cost carries the tap symbol, and `equipHostCount`
 * replaces both for an equip. So the tap factor is read as a *ratio* of the two
 * measured arms rather than as a count of anything, and the equip arm reports
 * distinct hosts rather than payments, because hosts is what that weight counts.
 *
 *   npx tsx packages/metrics/tools/ability-weight-census.ts <set.json> [more.json ...]
 *   MTG_BALANCE_GAMES=3 npx tsx packages/metrics/tools/ability-weight-census.ts <set.json>
 *
 * The set is an argument and has no default, for the reason `seed-variance.ts`
 * beside it takes one: the instrument measures whichever pool it is handed, and
 * a tool that names a particular committed fixture is a tool that has an
 * opinion about which pool matters. It asserts nothing and exits 0, and it
 * replays the gate's sweep through `test/balance/round-robin.ts` rather than
 * through a second copy of its settings.
 *
 * ## The denominator is the arrival, not the game
 *
 * Fires per game would fold in how often the card was drawn and how many copies
 * the deck ran, neither of which the scorer is asking about. `@mtg/sim`'s
 * census counts one *instance* per `permanentEntered` per printed triggered
 * ability on the arriving object, so the ratio below is fires per resolved
 * permanent and is independent of the sweep's size. `selfEnters` fires once per
 * arrival by construction, so its measured 1.000 is the instrument checking
 * itself; a run that prints anything else there has an instrument bug and not
 * an interesting set.
 *
 * ## The measurement is circular, and the circle is reported and then probed
 *
 * The decks the sweep plays were built by the scorer this table feeds, so a
 * condition on cards the builder ranks out has no sample at all. Three columns
 * say so: how many cards in the *pool* print the condition, how many card slots
 * across the ten *decks* carry it, and how many arrivals the sweep produced. A
 * row with zero arrivals prints `unmeasured` rather than 0.000, because zero
 * fires out of zero chances is not a measurement of anything.
 *
 * Three passes, and each one answers a different question:
 *
 *  1. **shipped** — the gate's own decks under the shipped table. This is the
 *     format as it is actually played, and it is the pass a measured row is
 *     taken from.
 *  2. **derived** — the same sweep with pass 1's measured rows installed in the
 *     builder's weights, *both* tables at once, because both feed the one
 *     scorer and a check that installs half the table checks half the
 *     circularity. This is that check: it says whether reading the numbers back
 *     into the builder moves them. It is *not* iterated to a fixed point, and it
 *     must not be — a table iterated against the builder that reads it converges
 *     on whatever the builder already liked.
 *  3. **probe** — the shipped table with every row that passes 1 and 2 both
 *     failed to measure raised to `PROBE_FIRE_COUNT`, until the builder plays
 *     the cards carrying it. This is the only way to get a sample for a
 *     condition the current scorer prices out of every deck, and the decks it
 *     builds are deliberately not the decks the gate plays. A row measured here
 *     is measured on a deck nobody would draft, which is a much better
 *     denominator than no denominator, and worse than pass 1's. Rows are
 *     labeled with the pass they came from for exactly that reason.
 *
 * A condition printed on no card in the pool is unmeasurable on that pool by
 * any pass, and the probe cannot conjure one; it stays a guess and says so.
 */
import { resolve } from 'node:path';
import type { Card, TriggerCondition } from '@mtg/dsl';
import { TRIGGER_CONDITIONS } from '@mtg/dsl';
import type { DeckBuildConfigInput } from '@mtg/deckbuild';
import { DEFAULT_SCORE_WEIGHTS, DEFAULT_TRIGGER_FIRE_COUNT } from '@mtg/deckbuild';
import type { ActivationArm, ActivationCensus, TriggerCensus } from '@mtg/sim';
import {
  ACTIVATION_ARMS,
  activationArm,
  firesPerInstance,
  hostsPerInstance,
  sumActivationCensus,
  sumTriggerCensus,
  tapFactor,
  usesPerInstance,
} from '@mtg/sim';
import type { DeckList } from '@mtg/kernel';
import { BALANCE_RUN_SEED, decksFor, gamesPerMatchup, runRoundRobin } from '../test/balance/round-robin';
import { loadSet } from '../test/balance/set';

/**
 * What the probe pass prices an unmeasured condition at.
 *
 * Large enough that a card carrying one outranks the vanilla bodies competing
 * for the same slot — the flagship's median card scores 1.6 and a trigger's
 * effects are worth on the order of one point, so a multiplier in single digits
 * decides the slot. It is a lever on the builder and never a candidate value
 * for the shipped table.
 */
const PROBE_FIRE_COUNT = 8;

/** Cards in a pool printing each condition; multiplicity is the caller's. */
function conditionCounts(cards: readonly Card[]): Readonly<Record<TriggerCondition, number>> {
  const counts = {} as Record<TriggerCondition, number>;
  for (const condition of TRIGGER_CONDITIONS) counts[condition] = 0;
  for (const card of cards) {
    for (const ability of card.abilities) {
      if (ability.kind === 'triggered') counts[ability.condition] += 1;
    }
  }
  return counts;
}

/** Abilities in a pool printing each arm; multiplicity is the caller's. */
function armCounts(cards: readonly Card[]): Readonly<Record<ActivationArm, number>> {
  const counts = {} as Record<ActivationArm, number>;
  for (const arm of ACTIVATION_ARMS) counts[arm] = 0;
  for (const card of cards) {
    for (const ability of card.abilities) {
      const arm = activationArm(ability);
      if (arm !== null) counts[arm] += 1;
    }
  }
  return counts;
}

function deckCards(decks: readonly DeckList[]): readonly Card[] {
  return decks.flatMap((deck) => deck.cards);
}

interface Pass {
  readonly label: string;
  readonly decks: readonly DeckList[];
  readonly census: TriggerCensus;
  readonly activations: ActivationCensus;
  readonly gamesPerSecond: number;
}

async function runPass(
  label: string,
  pool: readonly Card[],
  setLabel: string,
  games: number,
  input: DeckBuildConfigInput,
): Promise<Pass> {
  const decks = decksFor(pool, setLabel, input);
  // No replay logs: this instrument reads the census and nothing else, and a
  // sweep that builds 10,035 logs it will not open is a sweep paying for them.
  const run = await runRoundRobin(decks, games, BALANCE_RUN_SEED, {
    collectLogs: false,
    censusAbilities: true,
  });
  const outcomes = run.runs.flatMap((match) => match.outcomes);
  const censuses = outcomes.flatMap((outcome) =>
    outcome.triggerCensus === null ? [] : [outcome.triggerCensus],
  );
  const activations = outcomes.flatMap((outcome) =>
    outcome.activationCensus === null ? [] : [outcome.activationCensus],
  );
  if (censuses.length !== run.games || activations.length !== run.games) {
    throw new Error(
      `ability census: ${String(censuses.length)} trigger and ${String(activations.length)} activation ` +
        `censuses over ${String(run.games)} games`,
    );
  }
  return {
    label,
    decks,
    census: sumTriggerCensus(censuses),
    activations: sumActivationCensus(activations),
    gamesPerSecond: run.gamesPerSecond,
  };
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function padStart(text: string, width: number): string {
  return text.length >= width ? text : ' '.repeat(width - text.length) + text;
}

function show(measured: number | null): string {
  return measured === null ? 'unmeasured' : measured.toFixed(3);
}

/** Which weight each arm feeds, so a column of numbers names its own target. */
const ARM_LABEL: Readonly<Record<ActivationArm, string>> = {
  paid: 'paid       activationUseCount',
  tapped: 'tapped     x activationTapFactor',
  equip: 'equip      equipHostCount',
};

/**
 * What the shipped table already pays an ability on each arm.
 *
 * The tapped row multiplies rather than replaces, which is why its shipped
 * figure is a product and its measured figure below is a per-instance count of
 * the same kind: the two are comparable, and the ratio between the arms is what
 * `activationTapFactor` itself is read from.
 */
const SHIPPED_PER_INSTANCE: Readonly<Record<ActivationArm, number>> = {
  paid: DEFAULT_SCORE_WEIGHTS.activationUseCount,
  tapped: DEFAULT_SCORE_WEIGHTS.activationUseCount * DEFAULT_SCORE_WEIGHTS.activationTapFactor,
  equip: DEFAULT_SCORE_WEIGHTS.equipHostCount,
};

/** The per-instance reading an arm's weight is taken from. */
function armMeasurement(census: ActivationCensus, arm: ActivationArm): number | null {
  return arm === 'equip' ? hostsPerInstance(census) : usesPerInstance(census, arm);
}

function reportActivationPass(pass: Pass, pool: readonly Card[]): void {
  const poolCounts = armCounts(pool);
  const deckCounts = armCounts(deckCards(pass.decks));
  console.log(
    `${String(pass.activations.unresolvedArrivals)} unresolved arrivals  ` +
      `${String(pass.activations.unresolvedActivations)} unresolved activations`,
  );
  console.log(
    `${pad('arm', 38)}${padStart('pool', 5)}${padStart('deck', 6)}${padStart('arrivals', 10)}` +
      `${padStart('uses', 9)}${padStart('hosts', 8)}${padStart('measured', 11)}${padStart('shipped', 9)}`,
  );
  for (const arm of ACTIVATION_ARMS) {
    const row = pass.activations.arms[arm];
    console.log(
      pad(ARM_LABEL[arm], 38) +
        padStart(String(poolCounts[arm]), 5) +
        padStart(String(deckCounts[arm]), 6) +
        padStart(String(row.instances), 10) +
        padStart(String(row.activations), 9) +
        padStart(arm === 'equip' ? String(row.hosts) : '-', 8) +
        padStart(show(armMeasurement(pass.activations, arm)), 11) +
        padStart(SHIPPED_PER_INSTANCE[arm].toFixed(2), 9),
    );
  }
}

function reportPass(pass: Pass, pool: readonly Card[], games: number): void {
  const poolCounts = conditionCounts(pool);
  const deckCounts = conditionCounts(deckCards(pass.decks));
  console.log(
    `\n${pass.label}  ${String(games)} games/matchup  ${pass.gamesPerSecond.toFixed(0)} games/s  ` +
      `${String(pass.census.unresolvedArrivals)} unresolved arrivals`,
  );
  console.log(
    `${pad('condition', 38)}${padStart('pool', 5)}${padStart('deck', 6)}${padStart('arrivals', 10)}` +
      `${padStart('fires', 9)}${padStart('games', 8)}${padStart('measured', 11)}${padStart('shipped', 9)}`,
  );
  for (const condition of TRIGGER_CONDITIONS) {
    const row = pass.census.conditions[condition];
    console.log(
      pad(condition, 38) +
        padStart(String(poolCounts[condition]), 5) +
        padStart(String(deckCounts[condition]), 6) +
        padStart(String(row.instances), 10) +
        padStart(String(row.fires), 9) +
        padStart(String(row.games), 8) +
        padStart(show(firesPerInstance(pass.census, condition)), 11) +
        padStart(DEFAULT_TRIGGER_FIRE_COUNT[condition].toFixed(2), 9),
    );
  }
}

/** The three readings side by side, and where each row's number would come from. */
function reportDerivation(passes: readonly [Pass, Pass, Pass], pool: readonly Card[]): void {
  const poolCounts = conditionCounts(pool);
  const [shipped, derived, probe] = passes;
  console.log('\nderivation');
  console.log(
    `${pad('condition', 38)}${padStart('pass1', 11)}${padStart('pass2', 11)}${padStart('probe', 11)}` +
      `${padStart('shipped', 9)}${padStart('take', 11)}  source`,
  );
  for (const condition of TRIGGER_CONDITIONS) {
    const first = firesPerInstance(shipped.census, condition);
    const second = firesPerInstance(derived.census, condition);
    const third = firesPerInstance(probe.census, condition);
    const take = first ?? third;
    const source =
      first !== null
        ? `pass 1, n=${String(shipped.census.conditions[condition].instances)} arrivals`
        : third !== null
          ? `probe, n=${String(probe.census.conditions[condition].instances)} arrivals`
          : poolCounts[condition] === 0
            ? 'guess kept: no card in the pool prints it'
            : 'guess kept: printed in the pool, never reached a battlefield';
    console.log(
      pad(condition, 38) +
        padStart(show(first), 11) +
        padStart(show(second), 11) +
        padStart(show(third), 11) +
        padStart(DEFAULT_TRIGGER_FIRE_COUNT[condition].toFixed(2), 9) +
        padStart(show(take), 11) +
        `  ${source}`,
    );
  }
}

/**
 * The three activation weights side by side, and where each one would come from.
 *
 * **The probe column is absent on purpose.** Pass 3 raises `triggerFireCount`
 * rows until the builder plays the cards printing them; the equivalent lever for
 * an arm is `activationUseCount`, and raising it moves the paid arm and the
 * tapped arm together, which is exactly the ratio `activationTapFactor` is read
 * from. A probe that distorts the quantity being measured is not a probe. So an
 * arm the shipped format never reaches keeps its guess and says so, and the
 * probe pass's activation numbers are reported for the record but taken from a
 * builder distorted for somebody else's reason.
 */
function reportActivationDerivation(passes: readonly [Pass, Pass, Pass]): void {
  const [shipped, derived] = passes;
  console.log('\nactivation derivation');
  console.log(
    `${pad('weight', 38)}${padStart('pass1', 11)}${padStart('pass2', 11)}` +
      `${padStart('shipped', 9)}${padStart('take', 11)}  source`,
  );
  const paidInstances = shipped.activations.arms.paid.instances;
  const tappedInstances = shipped.activations.arms.tapped.instances;
  const equipInstances = shipped.activations.arms.equip.instances;
  const rows: readonly {
    readonly name: string;
    readonly first: number | null;
    readonly second: number | null;
    readonly current: number;
    readonly denominator: number;
  }[] = [
    {
      name: 'activationUseCount',
      first: usesPerInstance(shipped.activations, 'paid'),
      second: usesPerInstance(derived.activations, 'paid'),
      current: DEFAULT_SCORE_WEIGHTS.activationUseCount,
      denominator: paidInstances,
    },
    {
      name: 'activationTapFactor',
      first: tapFactor(shipped.activations),
      second: tapFactor(derived.activations),
      current: DEFAULT_SCORE_WEIGHTS.activationTapFactor,
      denominator: Math.min(paidInstances, tappedInstances),
    },
    {
      name: 'equipHostCount',
      first: hostsPerInstance(shipped.activations),
      second: hostsPerInstance(derived.activations),
      current: DEFAULT_SCORE_WEIGHTS.equipHostCount,
      denominator: equipInstances,
    },
  ];
  for (const row of rows) {
    const source =
      row.first !== null
        ? `pass 1, n=${String(row.denominator)} arrivals`
        : 'guess kept: the shipped format never put one on a battlefield';
    console.log(
      pad(row.name, 38) +
        padStart(show(row.first), 11) +
        padStart(show(row.second), 11) +
        padStart(row.current.toFixed(2), 9) +
        padStart(show(row.first), 11) +
        `  ${source}`,
    );
  }
}

/**
 * A pass's measured rows, as the weight override a builder reads.
 *
 * An unmeasured weight is left out rather than passed as a null, so the
 * builder's own default stands: `resolveConfig` reads an absent key as "keep
 * what shipped", and that is the right reading of a row with no sample.
 */
function weightsFrom(
  pass: Pass,
  unmeasured: (condition: TriggerCondition) => number | null,
): DeckBuildConfigInput {
  const overrides: Partial<Record<TriggerCondition, number>> = {};
  for (const condition of TRIGGER_CONDITIONS) {
    const measured = firesPerInstance(pass.census, condition);
    const value = measured ?? unmeasured(condition);
    if (value !== null) overrides[condition] = value;
  }
  const paid = usesPerInstance(pass.activations, 'paid');
  const tap = tapFactor(pass.activations);
  const hosts = hostsPerInstance(pass.activations);
  return {
    weights: {
      triggerFireCount: overrides,
      ...(paid === null ? {} : { activationUseCount: paid }),
      ...(tap === null ? {} : { activationTapFactor: tap }),
      ...(hosts === null ? {} : { equipHostCount: hosts }),
    },
  };
}

async function measure(pool: readonly Card[], setLabel: string, games: number): Promise<void> {
  const shipped = await runPass('pass 1: shipped weights', pool, setLabel, games, {});
  reportPass(shipped, pool, games);
  reportActivationPass(shipped, pool);

  const derived = await runPass(
    'pass 2: pass-1 measurements installed in the builder',
    pool,
    setLabel,
    games,
    weightsFrom(shipped, () => null),
  );
  reportPass(derived, pool, games);
  reportActivationPass(derived, pool);

  // Everything neither pass reached, boosted until the builder plays it.
  const stillDark = (condition: TriggerCondition): number | null =>
    firesPerInstance(shipped.census, condition) === null &&
    firesPerInstance(derived.census, condition) === null
      ? PROBE_FIRE_COUNT
      : null;
  const probe = await runPass(
    `pass 3: probe, unmeasured rows raised to ${String(PROBE_FIRE_COUNT)}`,
    pool,
    setLabel,
    games,
    { weights: { triggerFireCount: probeOverrides(stillDark) } },
  );
  reportPass(probe, pool, games);
  reportActivationPass(probe, pool);
  reportDerivation([shipped, derived, probe], pool);
  reportActivationDerivation([shipped, derived, probe]);
}

function probeOverrides(
  boost: (condition: TriggerCondition) => number | null,
): Partial<Record<TriggerCondition, number>> {
  const overrides: Partial<Record<TriggerCondition, number>> = {};
  for (const condition of TRIGGER_CONDITIONS) {
    const value = boost(condition);
    if (value !== null) overrides[condition] = value;
  }
  return overrides;
}

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    throw new Error('ability-weight-census: give it at least one path to a DSL set file');
  }
  const subjects = paths.map((path) => loadSet(resolve(path)));
  const games = gamesPerMatchup();
  for (const subject of subjects) {
    console.log(`\n=== ${subject.label}  seed ${BALANCE_RUN_SEED} ===`);
    await measure(subject.pool, subject.label, games);
  }
}

await main();
