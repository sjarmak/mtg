/**
 * Archetype viability: can each of the ten color pairs actually be built and
 * played?
 *
 * The floors below are the Limited construction norms from
 * `prior-art-set-design.md` §6.2-6.3, applied per color pair rather than per
 * set, which is the lesson the Tesla playtest logs record: "answer density is
 * per-color-pair, not global" (§11). A set can hit every global target and still
 * contain two archetypes nobody can play.
 *
 * The one floor that is ours rather than canon's is the inert budget. It exists
 * because of the co-design invariant: DSL v0 has no activated, triggered or
 * static abilities, so a counterspell, a mill spell or a raw cantrip resolves
 * without ever touching the battlefield and there is no payoff in the set for it
 * to feed. Printing those at density gives an archetype cards it cannot convert
 * into board presence, which is the mechanism behind bead mtg-bc2.36 — the TGR
 * fixture put five of them in blue, and the two pairs that had to play them
 * (UR at 30.7%, WU at 39.9%) were the two that fell out of the 40-70% band.
 *
 * Every floor here is a number about a *deck*, and a pair's counts are numbers
 * about a *pool*. Holding one against the other directly is what let the
 * 249-card flagship report ten of ten pairs viable with an identical playables
 * figure on every row: the pool clears a 23-card floor by nearly five times
 * whatever is in it, and with no gold cards in the set every pair's pool is the
 * same two mono-color piles and the same colorless pile. So the answer reading
 * goes through `inDeck` first — the pool is read as the deck it deals, which is
 * scale-free — and a pair with no card of its own says so outright instead of
 * presenting a shared pile as evidence about one archetype. Blue-green's three
 * colorless artifacts are the case that motivated both: three cards clear a
 * floor of two, and they are one answer in the deck they have to answer with.
 *
 * The signpost reading goes the same way and for the same reason. The flagship
 * named one per pair and all ten were mono-colored, which is a card four
 * archetypes take on equal terms and none of them can read a pair off. So the
 * report names a signpost only when no rival pair can play it, and a set that
 * produced none says so with the reserved slot and its rival count — a picker
 * that always returns something returns a lie on a set that holds nothing that
 * qualifies.
 *
 * The floors that *fail* a set stay on the raw pool on purpose, and it is not a
 * half-measure. `reserveAnswers` buys exactly `floors.removal` answer roles for
 * the pool that has to hold them, so an error floor read off the deck would
 * demand answers the color pie lets no slot in blue or green print — a finding
 * the retry loop could never clear, which is the trap `pairs.ts` records the
 * signposts falling into once already. And an error names slots, so its text is
 * the correction the model is handed on retry: every recorded fixture of a run
 * that tripped `ARCHETYPE_INERT_GLUT` is keyed on that sentence, and rewording
 * it re-keys them.
 */
import type { CurveBucket, CurveHistogram } from '@mtg/deckbuild';
import {
  COLOR_PAIRS,
  colorPairKey,
  curveBucket,
  CURVE_BUCKETS,
  DEFAULT_DECK_BUILD_CONFIG,
  spellCount,
} from '@mtg/deckbuild';
import type { SkeletonLiteProfile } from '@mtg/design-data';
import type { ArchetypePlan } from './pairs';
import type { Contribution } from './contribution';
import { exclusiveTo, playableIn } from './contribution';

export interface ArchetypeFloors {
  /** Playables a pair needs to fill a deck at all: `deckSize - landCount`. */
  readonly playables: number;
  /**
   * Creature playables a pair needs, in the units `inDeck` projects: bodies in a
   * `playables`-spell deck, not cards in the pool.
   *
   * This was 14 held against the raw pool, which is the comparison the `inDeck`
   * docblock below calls uninformative the moment the set is big. Measured on
   * 2026-08-20 it was exactly that: the 368-card flagship gives each pair 85-91
   * creature playables, clearing 14 six times over whatever those cards say, so
   * the gate cannot fail at that size.
   *
   * Rescaling 14 into deck units does not repair it, it inverts it. Projected,
   * the three balance subjects read 11-12 (the 79-card control), 12-13 (the
   * 368-card flagship) and 14-17 (the prototype), so a deck-unit floor of 14
   * fails every pair of both flagship set pools -- both of which sweep fair,
   * at spreads of 0.1729 and 0.1420 over 10,035 seeded games each (the control's
   * reading is 0.1395 as of 2026-08-21, which only widens the gap the sentence
   * is making; `packages/metrics/test/balance/subjects.ts` holds the current
   * numbers and the reason each moved). A floor that
   * fails a format the sweep passes is measuring the floor, not the format.
   *
   * So the number was re-derived from play rather than rescaled, which is what
   * `mtg-a1cs` asked for, and two measurements settle it.
   *
   * First, creature count does not predict a pair's win rate anywhere in the
   * range the builder actually produces. Across all thirty decks the sweep
   * builds, spanning 12 to 18 creatures, the correlation with win rate is
   * -0.121; the three subjects disagree even in sign (-0.631, +0.097, +0.318);
   * and the eight decks holding under 14 creatures win 49.8% against the
   * twenty-two at or above 14 winning 50.1%. No count in that band is worth
   * requiring, so the floor cannot be derived upward from play.
   *
   * Second, the projection errs in the direction that makes a low floor safe.
   * `buildDeckForPair` prices creatures with `creaturePremium` and so takes them
   * above pool density out of a creature-poor pool: it delivered 1 to 4 more
   * bodies than projected on both flagship set pools (mean +2.3 and +1.7) and
   * matched the projection on the creature-rich prototype (mean +0.0). All
   * thirty decks reached `minCreatures`, the builder's own 12.
   *
   * 11 is therefore the thinnest projection this codebase has evidence is
   * playable: the reading five pairs of the 79-card control take while that set
   * sweeps fair. It is a floor of evidence rather than of canon, and it asserts
   * nothing about 12 being better than 11 -- the first measurement is precisely
   * that no such claim is available. The margin is one card: the control's
   * thinnest pairs project 10.56 and round up, so a pool one creature poorer
   * than the thinnest fair set on record trips this. Deriving a floor from the
   * thinnest thing that works is what puts it one card away, and a reader who
   * later measures a thinner pool that plays should expect to move it again.
   */
  readonly creatures: number;
  /**
   * Answers a pair must have to be buildable at all.
   *
   * Canon's band is 4-6 with under 3 a weakness, but the mechanical color pie
   * places `destroyPermanent` and `dealDamage` off-pie in *both* blue and green,
   * so a UG deck in DSL v0 can only ever play the colorless answers the
   * skeleton allocates. Two is what the slice can guarantee; the canon number
   * below is reported against separately rather than being quietly dropped.
   */
  readonly removal: number;
  /** Canon's "under this is a weakness" number, reported as a warning. */
  readonly removalCanon: number;
  /** Playables that cannot touch the battlefield, per pair. */
  readonly inertBudget: number;
  /** Signpost uncommons reserved to the pair (N&B #16 prints two; the slice can afford one). */
  readonly signposts: number;
  /** Curve the deck builder tries to fill; a bucket it cannot fill at all is fatal. */
  readonly curve: CurveHistogram;
  /** Buckets at or below this must not be empty: the deck is unbuildable without them. */
  readonly criticalBucket: CurveBucket;
}

export const DEFAULT_ARCHETYPE_FLOORS: ArchetypeFloors = {
  playables: spellCount(DEFAULT_DECK_BUILD_CONFIG),
  creatures: 11,
  removal: 2,
  removalCanon: 3,
  inertBudget: 2,
  signposts: 1,
  curve: DEFAULT_DECK_BUILD_CONFIG.targetCurve,
  criticalBucket: 4,
};

/**
 * The playables one pair could have if every card in its two colors and the
 * colorless pool were printed: the set's own ceiling on archetype depth.
 *
 * Below `floors.playables` no pair can fill a deck, and both sides of the mirror
 * stand down rather than pretend: `checkArchetypeViability` abstains with
 * `ARCHETYPE_UNDERSIZED` instead of failing ten pairs, and the allocator makes
 * no per-pair reservation it knows nothing will ever read.
 */
export function pairCapacity(profile: SkeletonLiteProfile): number {
  const perColor = profile.perColorCards.common + profile.perColorCards.uncommon;
  const colorless = profile.colorless.common.cards + profile.colorless.uncommon.cards;
  return perColor * 2 + colorless;
}

/**
 * What a `deck`-spell deck drafted proportionally out of this pool would hold.
 *
 * Every floor in `ArchetypeFloors` is a number about a 40-card Limited deck,
 * and a pair's counts are numbers about a pool the whole table drafts from. Held
 * against each other directly the comparison stops carrying information the
 * moment the set is big: a 249-card set gives each pair around 112 playables and
 * clears a floor of 23 by nearly five times whatever those cards are, so the
 * gate cannot fail at that size. Reading the pool as the deck it deals is the
 * same arithmetic in the unit the floors are written in, and it is scale-free —
 * a density reads the same at 90 cards and at 249.
 *
 * Rounding is deliberate: a deck holds whole cards, and the question is how many
 * of them this pool is expected to supply.
 */
export function inDeck(count: number, pool: number, deck: number): number {
  return pool === 0 ? 0 : Math.round((deck * count) / pool);
}

export type ShortfallKind =
  | 'depth'
  | 'undifferentiated'
  | 'creatures'
  | 'removal'
  | 'removalThin'
  | 'inert'
  | 'signpost'
  | 'signpostShared'
  | 'signpostPayoff'
  | 'curveEmpty'
  | 'curveGap';

/**
 * Shortfalls that report rather than fail. None of the four is something
 * regenerating a card can repair: a partial curve gap reflects the skeleton the
 * profile derived, thin answers in blue-green are a consequence of the
 * mechanical color pie, and a pair with no card of its own — and, for the same
 * reason, no signpost of its own — is a set that prints no gold. A mono-color
 * slot cannot be regenerated into a two-color card, so an error there would be a
 * gate the retry loop can never clear.
 */
export const WARNING_SHORTFALLS: ReadonlySet<ShortfallKind> = new Set([
  'curveGap',
  'removalThin',
  'undifferentiated',
  'signpostShared',
]);

export interface ViabilityShortfall {
  readonly kind: ShortfallKind;
  readonly wanted: number;
  readonly found: number;
  /** Set on curve shortfalls: the bucket that came up short. */
  readonly bucket?: CurveBucket;
  readonly detail: string;
}

export interface PairViability {
  readonly pair: string;
  readonly playables: number;
  /** Playables no other pair can play: what this archetype has that its rivals do not. */
  readonly own: number;
  readonly creatures: number;
  /** Bodies a `floors.playables`-spell deck drafted from this pool would hold. */
  readonly creaturesInDeck: number;
  readonly removal: number;
  /** Answers a `floors.playables`-spell deck drafted from this pool would hold. */
  readonly answersInDeck: number;
  readonly inert: number;
  readonly inertSlotIds: readonly string[];
  /**
   * Cards that advertise this pair and no other: a signpost the report can name
   * as one. Empty on a set that prints no gold, which is not the same fact as
   * the allocator having reserved nothing — see `reservedSignpostSlotIds`.
   */
  readonly signpostSlotIds: readonly string[];
  /**
   * Slots the allocator reserved to advertise this pair, whatever color the set
   * printed them. This is the list a finding blames, because the vocabulary ask
   * is one a regenerated card can meet; the color is not.
   */
  readonly reservedSignpostSlotIds: readonly string[];
  /** Cards fillable per curve bucket, greedily, against the deck's target curve. */
  readonly curveFilled: Readonly<Record<CurveBucket, number>>;
  readonly shortfalls: readonly ViabilityShortfall[];
  readonly ok: boolean;
}

/**
 * How much of the deck's target curve the pair can actually fill.
 *
 * Slots carry a mana-value *window*, so a naive per-value histogram would report
 * a gap at MV 1 while three slots that may print at MV 1 sit unassigned. This is
 * the standard earliest-deadline-first fill: cheapest ceiling first, one card
 * per slot, ascending buckets.
 */
function fillCurve(playables: readonly Contribution[], target: CurveHistogram): Record<CurveBucket, number> {
  const ordered = [...playables].sort(
    (a, b) => a.manaValueMax - b.manaValueMax || a.manaValueMin - b.manaValueMin,
  );
  const used = new Set<string>();
  const filled = {} as Record<CurveBucket, number>;
  for (const bucket of CURVE_BUCKETS) {
    let got = 0;
    for (const item of ordered) {
      if (got >= target[bucket]) break;
      if (used.has(item.slotId)) continue;
      if (curveBucket(item.manaValueMin) > bucket || curveBucket(item.manaValueMax) < bucket) continue;
      used.add(item.slotId);
      got += 1;
    }
    filled[bucket] = got;
  }
  return filled;
}

function shortfall(
  kind: ShortfallKind,
  wanted: number,
  found: number,
  detail: string,
  bucket?: CurveBucket,
): ViabilityShortfall {
  return { kind, wanted, found, detail, ...(bucket === undefined ? {} : { bucket }) };
}

/**
 * How many of the other nine archetypes take this card on the same terms.
 *
 * A signpost's entire job is to be the card one pair wants first and the other
 * nine do not, so this is the size of the failure rather than decoration: nine
 * for a colorless card, three for a mono-colored one, zero for the gold card
 * that would have done the job.
 */
function rivalPairs(contribution: Contribution, pair: string): number {
  return COLOR_PAIRS.filter((other) => colorPairKey(other) !== pair && playableIn(contribution, other))
    .length;
}

function carriesPayoff(contribution: Contribution, plan: ArchetypePlan): boolean {
  const payoff: readonly string[] = [...plan.payoffKeywords, ...plan.payoffEffects];
  if (payoff.length === 0) return true;
  return contribution.subjects.some((subject) => payoff.includes(subject));
}

function curveShortfalls(
  filled: Readonly<Record<CurveBucket, number>>,
  floors: ArchetypeFloors,
): ViabilityShortfall[] {
  return CURVE_BUCKETS.flatMap((bucket): ViabilityShortfall[] => {
    const wanted = floors.curve[bucket];
    const found = filled[bucket];
    if (wanted === 0 || found >= wanted) return [];
    const fatal = found === 0 && bucket <= floors.criticalBucket;
    return [
      shortfall(
        fatal ? 'curveEmpty' : 'curveGap',
        wanted,
        found,
        `mana value ${bucket === 6 ? '6+' : bucket}: ${found} playable(s) for ${wanted} deck slot(s)`,
        bucket,
      ),
    ];
  });
}

/** One pair's structural report. `contributions` is the whole set, not the pair. */
export function assessPair(
  contributions: readonly Contribution[],
  plan: ArchetypePlan,
  floors: ArchetypeFloors = DEFAULT_ARCHETYPE_FLOORS,
): PairViability {
  const playables = contributions.filter((item) => playableIn(item, plan.colors));
  const own = playables.filter((item) => exclusiveTo(item, plan.colors));
  const creatures = playables.filter((item) => item.creature);
  const removal = playables.filter((item) => item.removal);
  const inert = playables.filter((item) => item.inert);
  const answersInDeck = inDeck(removal.length, playables.length, floors.playables);
  const creaturesInDeck = inDeck(creatures.length, playables.length, floors.playables);

  // Two different questions, and the flagship answered the second one with the
  // first. `reserved` is what the allocator pointed at this pair; `signposts` is
  // what a drafter could actually read a pair off, which needs the card to be
  // unplayable in the other nine archetypes.
  const reserved = contributions.filter((item) => item.signpost && item.archetypes.includes(plan.pair));
  const signposts = reserved.filter((item) => exclusiveTo(item, plan.colors));
  const withPayoff = reserved.filter((item) => carriesPayoff(item, plan));
  const filled = fillCurve(playables, floors.curve);

  const shortfalls: ViabilityShortfall[] = [];
  if (playables.length < floors.playables) {
    shortfalls.push(
      shortfall(
        'depth',
        floors.playables,
        playables.length,
        `${playables.length} playables cannot fill a ${floors.playables}-spell deck`,
      ),
    );
  }
  if (own.length === 0) {
    shortfalls.push(
      shortfall(
        'undifferentiated',
        1,
        0,
        `${playables.length} playables and no card of its own: every one of them is a mono-color or ` +
          `colorless card three or nine other pairs count too, so the depth reading is the set's color ` +
          `balance rather than anything about ${plan.pair}`,
      ),
    );
  }
  // Unlike the inert glut below, this message is free to change: `blameFor`
  // returns no slot for a `creatures` shortfall, and `feedbackForSlot` filters
  // on `slotIds`, so the sentence cannot reach a retry prompt and cannot key a
  // recorded fixture. `mtg-l91h`'s change-thresholds-not-messages rule is about
  // findings that name a slot; this one never has.
  if (creaturesInDeck < floors.creatures) {
    shortfalls.push(
      shortfall(
        'creatures',
        floors.creatures,
        creaturesInDeck,
        `${creatures.length} creature playables in a ${playables.length}-card pool, which is ` +
          `${creaturesInDeck} in a ${floors.playables}-spell deck; under ${floors.creatures} the pool ` +
          `cannot be relied on to fill one`,
      ),
    );
  }
  if (removal.length < floors.removal) {
    shortfalls.push(
      shortfall(
        'removal',
        floors.removal,
        removal.length,
        `${removal.length} way(s) to answer a creature; a deck needs at least ${floors.removal}`,
      ),
    );
  } else if (answersInDeck < floors.removalCanon) {
    shortfalls.push(
      shortfall(
        'removalThin',
        floors.removalCanon,
        answersInDeck,
        `${removal.length} way(s) to answer a creature in a ${playables.length}-card pool, which is ` +
          `${answersInDeck} in a ${floors.playables}-spell deck; Limited canon calls under ` +
          `${floors.removalCanon} a weakness`,
      ),
    );
  }
  // Held against the raw pool, and the message it carries is fixed. Both are
  // load-bearing: `ARCHETYPE_INERT_GLUT` is an error that names slots, so its
  // text is the correction the retry loop hands the model, and every recorded
  // fixture of a run that ever tripped it is keyed on that prompt.
  if (inert.length > floors.inertBudget) {
    shortfalls.push(
      shortfall(
        'inert',
        floors.inertBudget,
        inert.length,
        `${inert.length} playables resolve without touching the battlefield (${inert
          .map((item) => item.slotId)
          .join(', ')}); DSL v0 gives this archetype nothing to convert them into`,
      ),
    );
  }
  if (reserved.length < floors.signposts) {
    shortfalls.push(
      shortfall(
        'signpost',
        floors.signposts,
        reserved.length,
        `no signpost uncommon advertises the ${plan.pair} plan`,
      ),
    );
  } else {
    if (withPayoff.length < floors.signposts) {
      shortfalls.push(
        shortfall(
          'signpostPayoff',
          floors.signposts,
          withPayoff.length,
          `the ${plan.pair} signpost carries none of its payoff vocabulary (${[
            ...plan.payoffKeywords,
            ...plan.payoffEffects,
          ].join(', ')})`,
        ),
      );
    }
    // Stated as an absence, and deliberately not as a weaker signpost. A
    // best-effort pick here is the report telling a reader that a card points at
    // an archetype when it points at four, and nothing downstream can tell the
    // two apart once the id is in the list.
    if (signposts.length < floors.signposts) {
      const shared = reserved
        .filter((item) => !exclusiveTo(item, plan.colors))
        .map((item) => `${item.slotId}, which ${rivalPairs(item, plan.pair)} other pairs play alike`);
      shortfalls.push(
        shortfall(
          'signpostShared',
          floors.signposts,
          signposts.length,
          `the set could produce no ${plan.pair} signpost — a card only a ${plan.pair} drafter can ` +
            `play: ${shared.join('; ')}`,
        ),
      );
    }
  }
  shortfalls.push(...curveShortfalls(filled, floors));

  return {
    pair: plan.pair,
    playables: playables.length,
    own: own.length,
    creatures: creatures.length,
    creaturesInDeck,
    removal: removal.length,
    answersInDeck,
    inert: inert.length,
    inertSlotIds: inert.map((item) => item.slotId),
    signpostSlotIds: signposts.map((item) => item.slotId),
    reservedSignpostSlotIds: reserved.map((item) => item.slotId),
    curveFilled: filled,
    shortfalls,
    ok: shortfalls.every((item) => WARNING_SHORTFALLS.has(item.kind)),
  };
}

export function assessArchetypes(
  contributions: readonly Contribution[],
  plans: readonly ArchetypePlan[],
  floors: ArchetypeFloors = DEFAULT_ARCHETYPE_FLOORS,
): readonly PairViability[] {
  return plans.map((plan) => assessPair(contributions, plan, floors));
}

export function formatViability(report: PairViability): string {
  const shortfalls =
    report.shortfalls.length === 0 ? 'ok' : report.shortfalls.map((item) => item.detail).join('; ');
  return `${report.pair}: ${report.playables} playables (${report.own} of its own), ${report.creatures} creatures (${report.creaturesInDeck} per deck), ${report.removal} removal (${report.answersInDeck} per deck), ${report.inert} inert — ${shortfalls}`;
}
