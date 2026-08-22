/** Deterministic static profiles over complete reference-set collector populations. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { InvalidInputError } from '../errors';
import type { ReferenceCard, ReferenceCorpus, ReferenceSet } from './schemas';

export const REFERENCE_PROFILE_VERSION = 'reference-static-v1' as const;
export const TARGET_BAND_POLICY_VERSION = 'primary-core-static-tolerance-v1' as const;
export const REFERENCE_PROFILE_PATH = fileURLToPath(
  new URL('../../data/reference-profiles-v1.json', import.meta.url),
);

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
const COLOR_PAIRS = ['WU', 'WB', 'WR', 'WG', 'UB', 'UR', 'UG', 'BR', 'BG', 'RG'] as const;
const CURVE_BUCKETS = ['0', '1', '2', '3', '4', '5', '6', '7+'] as const;
const COMBAT_KEYWORDS = new Set([
  'deathtouch',
  'double strike',
  'first strike',
  'flying',
  'haste',
  'lifelink',
  'menace',
  'reach',
  'trample',
  'vigilance',
]);

export interface MetricPopulation {
  readonly id: string;
  readonly count: number;
  readonly description: string;
}

export interface RateMetric {
  readonly numerator: number;
  readonly denominator: MetricPopulation;
  readonly share: number;
  readonly methodology: string;
}

export interface DistributionMetric {
  readonly denominator: MetricPopulation;
  readonly counts: Readonly<Record<string, number>>;
  readonly shares: Readonly<Record<string, number>>;
}

export type ProfileRole = 'primary-core' | 'secondary-core' | 'expansion' | 'stress-only' | 'subject';
export type ScalarUnit = 'share' | 'mana-value' | 'words-per-card' | 'lines-per-card' | 'stats-per-mana';

export interface ComparableScalar {
  readonly id: string;
  readonly value: number;
  readonly unit: ScalarUnit;
  readonly populationId: string;
  readonly decision: string;
}

export interface StaticProfileCard {
  readonly id: string;
  readonly name: string;
  readonly rarity: string;
  readonly colors: readonly string[];
  readonly colorIdentity?: readonly string[];
  readonly types: readonly string[];
  readonly keywords: readonly string[];
  readonly text?: string;
  readonly manaValue?: number;
  readonly power?: string | number;
  readonly toughness?: string | number;
}

export interface StaticSetProfile {
  readonly profileVersion: typeof REFERENCE_PROFILE_VERSION;
  readonly set: {
    readonly code: string;
    readonly name: string;
    readonly mainSetSize: number;
    readonly cardFaceRecords: number;
  };
  readonly role: ProfileRole;
  readonly provenance: {
    readonly provider: string;
    readonly sourceVersion: string;
    readonly builtDate: string;
    readonly sourceUrl: string;
    readonly sourceSha256: string;
    readonly oracleSemantics: 'current';
    readonly populationRule: string;
  };
  readonly evidence: {
    readonly kind: 'static-proxy';
    readonly claimsGameplay: false;
    readonly claimsHumanEvidence: false;
    readonly caveat: string;
  };
  readonly populations: {
    readonly mainCards: MetricPopulation;
    readonly nonlandCards: MetricPopulation;
    readonly creatures: MetricPopulation;
    readonly manaValuedNonlands: MetricPopulation;
    readonly numericCreatures: MetricPopulation;
    readonly rareMythicNonlands: MetricPopulation;
    readonly commonUncommonNonlands: MetricPopulation;
  };
  readonly raritySkeleton: DistributionMetric;
  readonly colorSkeleton: DistributionMetric;
  readonly manaCurve: DistributionMetric & { readonly mean: number };
  readonly creatureRate: RateMetric;
  readonly statEfficiency: {
    readonly denominator: MetricPopulation;
    readonly meanStatsPerMana: number;
    readonly byManaValue: readonly {
      readonly manaValue: string;
      readonly cards: number;
      readonly mean: number;
    }[];
    readonly methodology: string;
  };
  readonly removalDensity: RateMetric;
  readonly interactionDensity: RateMetric;
  readonly fixingDensity: RateMetric;
  readonly combatKeywords: {
    readonly denominator: MetricPopulation;
    readonly counts: Readonly<Record<string, number>>;
    readonly cardsWithKeyword: number;
    readonly share: number;
  };
  readonly complexity: {
    readonly denominator: MetricPopulation;
    readonly meanOracleWords: number;
    readonly meanAbilityLines: number;
    readonly keywordOccurrencesPerCard: number;
    readonly decisionMarkersPerCard: number;
    readonly methodology: string;
  };
  readonly mechanicAsFan:
    | {
        readonly status: 'available';
        readonly denominator: {
          readonly kind: 'expected-draft-booster-cards';
          readonly expectedCardsPerBooster: number;
          readonly boosterVariants: number;
          readonly description: string;
        };
        readonly mechanics: readonly {
          readonly mechanic: string;
          readonly expectedCardsPerBooster: number;
          readonly shareOfBooster: number;
        }[];
        readonly methodology: string;
      }
    | { readonly status: 'unavailable'; readonly reason: string };
  readonly archetypeSupport: {
    readonly denominator: MetricPopulation;
    readonly pairs: readonly {
      readonly pair: string;
      readonly exactMulticolorCards: number;
      readonly firstColorCards: number;
      readonly secondColorCards: number;
      readonly fixingCards: number;
      readonly supportShare: number;
    }[];
    readonly methodology: string;
  };
  readonly riskProxies: {
    readonly bombRisk: RateMetric;
    readonly unplayableRisk: RateMetric;
    readonly methodology: string;
  };
  readonly comparableScalars: readonly ComparableScalar[];
}

export interface TargetBandTolerance {
  readonly shareHalfWidth: number;
  readonly meanRelativeHalfWidth: number;
  readonly meanMinimumHalfWidth: number;
}

export interface PrimaryCoreEnvelopeMetric {
  readonly id: string;
  readonly unit: ScalarUnit;
  readonly anchors: readonly {
    readonly setCode: 'M11' | 'M13';
    readonly exactValue: number;
    readonly band: { readonly lower: number; readonly upper: number };
    readonly populationId: string;
  }[];
  readonly target: { readonly lower: number; readonly upper: number };
  readonly resolution: 'intersection' | 'precedence';
  readonly selectedSet?: 'M11' | 'M13' | undefined;
  readonly rationale: string;
}

export interface PrimaryCoreEnvelope {
  readonly policyVersion: typeof TARGET_BAND_POLICY_VERSION;
  readonly anchorCodes: readonly ['M11', 'M13'];
  readonly precedence: 'M11' | 'M13';
  readonly tolerance: TargetBandTolerance;
  readonly caveat: string;
  readonly excluded: {
    readonly secondaryCore: readonly ['M15', 'M20', 'ORI'];
    readonly expansions: readonly ['ISD', 'RTR', 'RAV', 'ROE', 'SOM', 'KTK'];
    readonly stressOnly: readonly ['MH2'];
  };
  readonly metrics: readonly PrimaryCoreEnvelopeMetric[];
}

export interface ReferenceProfileArtifact {
  readonly schemaVersion: 1;
  readonly profileVersion: typeof REFERENCE_PROFILE_VERSION;
  readonly sourceCorpus: {
    readonly schemaVersion: 1;
    readonly provider: 'MTGJSON';
    readonly version: string;
    readonly builtDate: string;
  };
  readonly profiles: readonly StaticSetProfile[];
  readonly primaryCore: PrimaryCoreEnvelope;
}

const PopulationSchema = z.object({
  id: z.string(),
  count: z.number().nonnegative(),
  description: z.string(),
});
const ScalarSchema = z.object({
  id: z.string(),
  value: z.number(),
  unit: z.enum(['share', 'mana-value', 'words-per-card', 'lines-per-card', 'stats-per-mana']),
  populationId: z.string(),
  decision: z.string(),
});
const RateSchema = z.object({
  numerator: z.number().int().nonnegative(),
  denominator: PopulationSchema,
  share: z.number().min(0).max(1),
  methodology: z.string(),
});
const DistributionSchema = z.object({
  denominator: PopulationSchema,
  counts: z.record(z.string(), z.number().int().nonnegative()),
  shares: z.record(z.string(), z.number().min(0).max(1)),
});
const MechanicAsFanSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    denominator: z.object({
      kind: z.literal('expected-draft-booster-cards'),
      expectedCardsPerBooster: z.number().positive(),
      boosterVariants: z.number().int().positive(),
      description: z.string(),
    }),
    mechanics: z.array(
      z.object({
        mechanic: z.string(),
        expectedCardsPerBooster: z.number().nonnegative(),
        shareOfBooster: z.number().min(0).max(1),
      }),
    ),
    methodology: z.string(),
  }),
  z.object({ status: z.literal('unavailable'), reason: z.string() }),
]);
const ProfileBoundarySchema = z.object({
  profileVersion: z.literal(REFERENCE_PROFILE_VERSION),
  set: z.object({
    code: z.string(),
    name: z.string(),
    mainSetSize: z.number().int().nonnegative(),
    cardFaceRecords: z.number().int().nonnegative(),
  }),
  role: z.enum(['primary-core', 'secondary-core', 'expansion', 'stress-only', 'subject']),
  provenance: z.object({
    provider: z.string(),
    sourceVersion: z.string(),
    builtDate: z.string(),
    sourceUrl: z.string(),
    sourceSha256: z.string(),
    oracleSemantics: z.literal('current'),
    populationRule: z.string(),
  }),
  evidence: z.object({
    kind: z.literal('static-proxy'),
    claimsGameplay: z.literal(false),
    claimsHumanEvidence: z.literal(false),
    caveat: z.string(),
  }),
  populations: z.object({
    mainCards: PopulationSchema,
    nonlandCards: PopulationSchema,
    creatures: PopulationSchema,
    manaValuedNonlands: PopulationSchema,
    numericCreatures: PopulationSchema,
    rareMythicNonlands: PopulationSchema,
    commonUncommonNonlands: PopulationSchema,
  }),
  raritySkeleton: DistributionSchema,
  colorSkeleton: DistributionSchema,
  manaCurve: DistributionSchema.extend({ mean: z.number().nonnegative() }),
  creatureRate: RateSchema,
  statEfficiency: z.object({
    denominator: PopulationSchema,
    meanStatsPerMana: z.number().nonnegative(),
    byManaValue: z.array(
      z.object({
        manaValue: z.string(),
        cards: z.number().int().nonnegative(),
        mean: z.number().nonnegative(),
      }),
    ),
    methodology: z.string(),
  }),
  removalDensity: RateSchema,
  interactionDensity: RateSchema,
  fixingDensity: RateSchema,
  combatKeywords: z.object({
    denominator: PopulationSchema,
    counts: z.record(z.string(), z.number().int().nonnegative()),
    cardsWithKeyword: z.number().int().nonnegative(),
    share: z.number().min(0).max(1),
  }),
  complexity: z.object({
    denominator: PopulationSchema,
    meanOracleWords: z.number().nonnegative(),
    meanAbilityLines: z.number().nonnegative(),
    keywordOccurrencesPerCard: z.number().nonnegative(),
    decisionMarkersPerCard: z.number().nonnegative(),
    methodology: z.string(),
  }),
  mechanicAsFan: MechanicAsFanSchema,
  archetypeSupport: z.object({
    denominator: PopulationSchema,
    pairs: z.array(
      z.object({
        pair: z.string(),
        exactMulticolorCards: z.number().int().nonnegative(),
        firstColorCards: z.number().int().nonnegative(),
        secondColorCards: z.number().int().nonnegative(),
        fixingCards: z.number().int().nonnegative(),
        supportShare: z.number().min(0).max(1),
      }),
    ),
    methodology: z.string(),
  }),
  riskProxies: z.object({ bombRisk: RateSchema, unplayableRisk: RateSchema, methodology: z.string() }),
  comparableScalars: z.array(ScalarSchema),
});
const BandSchema = z.object({ lower: z.number().nonnegative(), upper: z.number().nonnegative() });
const ArtifactBoundarySchema = z.object({
  schemaVersion: z.literal(1),
  profileVersion: z.literal(REFERENCE_PROFILE_VERSION),
  sourceCorpus: z.object({
    schemaVersion: z.literal(1),
    provider: z.literal('MTGJSON'),
    version: z.string(),
    builtDate: z.string(),
  }),
  profiles: z.array(ProfileBoundarySchema).length(12),
  primaryCore: z.object({
    policyVersion: z.literal(TARGET_BAND_POLICY_VERSION),
    anchorCodes: z.tuple([z.literal('M11'), z.literal('M13')]),
    precedence: z.enum(['M11', 'M13']),
    tolerance: z.object({
      shareHalfWidth: z.number().nonnegative(),
      meanRelativeHalfWidth: z.number().nonnegative(),
      meanMinimumHalfWidth: z.number().nonnegative(),
    }),
    caveat: z.string(),
    excluded: z.object({
      secondaryCore: z.tuple([z.literal('M15'), z.literal('M20'), z.literal('ORI')]),
      expansions: z.tuple([
        z.literal('ISD'),
        z.literal('RTR'),
        z.literal('RAV'),
        z.literal('ROE'),
        z.literal('SOM'),
        z.literal('KTK'),
      ]),
      stressOnly: z.tuple([z.literal('MH2')]),
    }),
    metrics: z.array(
      z.object({
        id: z.string(),
        unit: z.enum(['share', 'mana-value', 'words-per-card', 'lines-per-card', 'stats-per-mana']),
        anchors: z.array(
          z.object({
            setCode: z.enum(['M11', 'M13']),
            exactValue: z.number(),
            band: BandSchema,
            populationId: z.string(),
          }),
        ),
        target: BandSchema,
        resolution: z.enum(['intersection', 'precedence']),
        selectedSet: z.enum(['M11', 'M13']).optional(),
        rationale: z.string(),
      }),
    ),
  }),
});

function population(id: string, count: number, description: string): MetricPopulation {
  return { id, count, description };
}

function rate(numerator: number, denominator: MetricPopulation, methodology: string): RateMetric {
  return {
    numerator,
    denominator,
    share: denominator.count === 0 ? 0 : numerator / denominator.count,
    methodology,
  };
}

function distribution(
  denominator: MetricPopulation,
  keys: readonly string[],
  values: readonly string[],
): DistributionMetric {
  const counts = Object.fromEntries(keys.map((key) => [key, values.filter((value) => value === key).length]));
  const shares = Object.fromEntries(
    keys.map((key) => [key, denominator.count === 0 ? 0 : (counts[key] ?? 0) / denominator.count]),
  );
  return { denominator, counts, shares };
}

function normalizedRarity(rarity: string): string {
  const value = rarity.toLowerCase();
  return value === 'mythic rare' ? 'mythic' : value;
}

function hasType(card: StaticProfileCard, type: string): boolean {
  return card.types.some((candidate) => candidate.toLowerCase() === type.toLowerCase());
}

function oracleWords(text: string | undefined): number {
  return text?.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
}

function abilityLines(text: string | undefined): number {
  return text?.split('\n').filter((line) => line.trim() !== '').length ?? 0;
}

function decisionMarkers(text: string | undefined): number {
  return text?.match(/\b(?:choose|unless|may|target|up to|for each|if|whenever|when)\b/gi)?.length ?? 0;
}

function isRemoval(card: StaticProfileCard): boolean {
  const text = card.text ?? '';
  return /\b(?:destroy|exile) target (?:creature|permanent)|target creature gets -\d+\/-\d+|deals? \d+ damage to target (?:creature|any target)|counter target spell|return target (?:creature|permanent) to its owner's hand/i.test(
    text,
  );
}

function isInteraction(card: StaticProfileCard): boolean {
  const text = card.text ?? '';
  return (
    isRemoval(card) ||
    /\btarget (?:creature|permanent)|\bfight\b|\btap target\b|\bcan't block\b|\bprevent .* damage\b/i.test(
      text,
    )
  );
}

function isFixing(card: StaticProfileCard): boolean {
  const text = card.text ?? '';
  const identity = card.colorIdentity ?? card.colors;
  return (
    (hasType(card, 'Land') && identity.length > 1) ||
    /add (?:one mana of )?any color|add [^{\n]*(?:\{[WUBRG]\}.*){2}|search your library for (?:a|an) .*land|create .*treasure/i.test(
      text,
    )
  );
}

function numericStat(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return undefined;
  return Number(value);
}

function statEfficiency(card: StaticProfileCard): number | undefined {
  const power = numericStat(card.power);
  const toughness = numericStat(card.toughness);
  if (power === undefined || toughness === undefined || card.manaValue === undefined) return undefined;
  return (power + toughness) / Math.max(1, card.manaValue);
}

function impactSignals(card: StaticProfileCard): number {
  const text = card.text ?? '';
  const patterns = [
    /draw (?:a|two|three|\d+) cards?/i,
    /destroy|exile|counter target spell/i,
    /return .* from your graveyard/i,
    /create (?:two|three|\d+) .*tokens?/i,
    /each opponent|all creatures|each creature/i,
    /extra turn|win the game/i,
  ];
  const textual = patterns.filter((pattern) => pattern.test(text)).length;
  const keyword = card.keywords.some((entry) =>
    ['flying', 'lifelink', 'deathtouch', 'double strike'].includes(entry.toLowerCase()),
  )
    ? 1
    : 0;
  return textual + keyword;
}

function mechanicLabels(card: StaticProfileCard): readonly string[] {
  const labels = new Set(card.keywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean));
  for (const match of (card.text ?? '').matchAll(/(?:^|\n)([A-Z][A-Za-z ]{1,32}) —/g)) {
    const label = match[1]?.trim().toLowerCase();
    if (label !== undefined) labels.add(label);
  }
  return [...labels].sort();
}

function colorBucket(card: StaticProfileCard): string {
  const colors = card.colors.filter((color) => COLORS.includes(color as (typeof COLORS)[number]));
  return colors.length === 0 ? 'C' : colors.length === 1 ? (colors[0] ?? 'C') : 'M';
}

function curveBucket(card: StaticProfileCard): string {
  const manaValue = card.manaValue ?? 0;
  return manaValue >= 7 ? '7+' : String(Math.floor(manaValue));
}

function referenceCards(set: ReferenceSet): StaticProfileCard[] {
  return set.cards
    .filter((card) => card.roles.includes('main-set') && card.side !== 'b')
    .map((card) => ({
      id: card.uuid,
      name: card.name,
      rarity: card.rarity,
      colors: card.colors,
      colorIdentity: card.colorIdentity,
      types: card.types,
      keywords: card.keywords,
      ...(card.text === undefined ? {} : { text: card.text }),
      ...(card.manaValue === undefined ? {} : { manaValue: card.manaValue }),
      ...(card.power === undefined ? {} : { power: card.power }),
      ...(card.toughness === undefined ? {} : { toughness: card.toughness }),
    }));
}

function roleFor(code: string): ProfileRole {
  if (code === 'M11' || code === 'M13') return 'primary-core';
  if (code === 'M15' || code === 'M20' || code === 'ORI') return 'secondary-core';
  if (code === 'MH2') return 'stress-only';
  return 'expansion';
}

interface BoosterInput {
  readonly set: ReferenceSet;
  readonly cardsById: ReadonlyMap<string, StaticProfileCard>;
}

function mechanicAsFan(input: BoosterInput): StaticSetProfile['mechanicAsFan'] {
  const { draftBooster } = input.set;
  const variantWeight = draftBooster.boostersTotalWeight;
  let expectedCardsPerBooster = 0;
  const expected = new Map<string, number>();
  for (const booster of draftBooster.boosters) {
    const boosterShare = booster.weight / variantWeight;
    for (const [sheetName, slots] of Object.entries(booster.contents)) {
      expectedCardsPerBooster += boosterShare * slots;
      const sheet = draftBooster.sheets[sheetName];
      if (sheet === undefined) continue;
      for (const [uuid, weight] of Object.entries(sheet.cards)) {
        const card = input.cardsById.get(uuid);
        if (card === undefined) continue;
        const cardExposure = boosterShare * slots * (weight / sheet.totalWeight);
        for (const label of mechanicLabels(card))
          expected.set(label, (expected.get(label) ?? 0) + cardExposure);
      }
    }
  }
  return {
    status: 'available',
    denominator: {
      kind: 'expected-draft-booster-cards',
      expectedCardsPerBooster,
      boosterVariants: draftBooster.boosters.length,
      description:
        'Expected physical card slots in one weighted Draft Booster from the pinned collation recipe.',
    },
    mechanics: [...expected]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([mechanic, value]) => ({
        mechanic,
        expectedCardsPerBooster: value,
        shareOfBooster: expectedCardsPerBooster === 0 ? 0 : value / expectedCardsPerBooster,
      })),
    methodology:
      'For each booster variant, sheet slot count is multiplied by variant weight and each card UUID sheet weight; a card contributes once to every printed keyword or ability-word label it carries.',
  };
}

interface DeriveInput {
  readonly code: string;
  readonly name: string;
  readonly cards: readonly StaticProfileCard[];
  readonly cardFaceRecords?: number;
  readonly role: ProfileRole;
  readonly provenance: StaticSetProfile['provenance'];
  readonly booster?: BoosterInput;
}

function deriveProfile(input: DeriveInput): StaticSetProfile {
  const cards = [...input.cards];
  const nonlands = cards.filter((card) => !hasType(card, 'Land'));
  const creatures = cards.filter((card) => hasType(card, 'Creature'));
  const manaValued = nonlands.filter((card) => card.manaValue !== undefined);
  const numericCreatures = creatures.filter((card) => statEfficiency(card) !== undefined);
  const rareMythic = nonlands.filter((card) => ['rare', 'mythic'].includes(normalizedRarity(card.rarity)));
  const commonUncommon = nonlands.filter((card) =>
    ['common', 'uncommon'].includes(normalizedRarity(card.rarity)),
  );

  const populations = {
    mainCards: population(
      'main-collector-positions',
      cards.length,
      'Main-set collector positions, with double-faced back faces excluded so one physical card is one observation.',
    ),
    nonlandCards: population(
      'nonland-main-collector-positions',
      nonlands.length,
      'Main-set collector positions whose type line is not a land; basic and nonbasic lands are excluded.',
    ),
    creatures: population(
      'creature-main-collector-positions',
      creatures.length,
      'Main-set collector positions whose type line includes Creature, including artifact and multicolor creatures.',
    ),
    manaValuedNonlands: population(
      'mana-valued-nonland-main-collector-positions',
      manaValued.length,
      'Nonland main-set collector positions carrying a numeric current mana value in the pinned source.',
    ),
    numericCreatures: population(
      'numeric-stat-creature-main-collector-positions',
      numericCreatures.length,
      'Creature collector positions with integer printed power and toughness and a numeric current mana value.',
    ),
    rareMythicNonlands: population(
      'rare-mythic-nonland-main-collector-positions',
      rareMythic.length,
      'Rare or mythic nonland main-set collector positions eligible for the static bomb-risk warning proxy.',
    ),
    commonUncommonNonlands: population(
      'common-uncommon-nonland-main-collector-positions',
      commonUncommon.length,
      'Common or uncommon nonland main-set collector positions eligible for the static weak-card warning proxy.',
    ),
  };

  const raritySkeleton = distribution(
    populations.mainCards,
    ['common', 'uncommon', 'rare', 'mythic', 'basic land', 'special'],
    cards.map((card) => {
      const rarity = normalizedRarity(card.rarity);
      return ['common', 'uncommon', 'rare', 'mythic', 'basic land'].includes(rarity) ? rarity : 'special';
    }),
  );
  const colorSkeleton = distribution(
    populations.mainCards,
    ['W', 'U', 'B', 'R', 'G', 'M', 'C'],
    cards.map(colorBucket),
  );
  const manaCurveBase = distribution(
    populations.manaValuedNonlands,
    CURVE_BUCKETS,
    manaValued.map(curveBucket),
  );
  const manaCurve = {
    ...manaCurveBase,
    mean:
      manaValued.length === 0
        ? 0
        : manaValued.reduce((sum, card) => sum + (card.manaValue ?? 0), 0) / manaValued.length,
  };
  const efficiencies = numericCreatures.map((card) => statEfficiency(card) ?? 0);
  const byManaValue = CURVE_BUCKETS.map((manaValue) => {
    const selected = numericCreatures
      .filter((card) => curveBucket(card) === manaValue)
      .map((card) => statEfficiency(card) ?? 0);
    return {
      manaValue,
      cards: selected.length,
      mean: selected.length === 0 ? 0 : selected.reduce((sum, value) => sum + value, 0) / selected.length,
    };
  });
  const removal = nonlands.filter(isRemoval);
  const interaction = nonlands.filter(isInteraction);
  const fixing = cards.filter(isFixing);
  const combatCounts = Object.fromEntries(
    [...COMBAT_KEYWORDS]
      .sort()
      .map((keyword) => [
        keyword,
        creatures.filter((card) => card.keywords.some((entry) => entry.toLowerCase() === keyword)).length,
      ]),
  );
  const cardsWithCombatKeyword = creatures.filter((card) =>
    card.keywords.some((keyword) => COMBAT_KEYWORDS.has(keyword.toLowerCase())),
  ).length;
  const bombCards = rareMythic.filter((card) => {
    const efficiency = statEfficiency(card) ?? 0;
    return (
      impactSignals(card) >= 2 ||
      (efficiency >= 1.5 && (card.manaValue ?? 0) >= 4 && impactSignals(card) >= 1)
    );
  });
  const unplayableCards = commonUncommon.filter((card) => {
    if (!hasType(card, 'Creature') && (card.text ?? '').trim() === '' && card.keywords.length === 0) {
      return true;
    }
    const efficiency = statEfficiency(card);
    if (efficiency !== undefined)
      return (card.manaValue ?? 0) >= 4 && efficiency < 1 && impactSignals(card) === 0;
    return (card.manaValue ?? 0) >= 5 && !isInteraction(card) && !isFixing(card) && impactSignals(card) === 0;
  });
  const fixingRate = rate(
    fixing.length,
    populations.mainCards,
    'A card is fixing when its current Oracle text produces multiple colors, any color, searches for a land, or creates Treasure; multicolor-producing lands also qualify.',
  );

  const pairSupport = COLOR_PAIRS.map((pair) => {
    const [first = '', second = ''] = pair;
    const exactMulticolorCards = nonlands.filter((card) => {
      const identity = [...(card.colorIdentity ?? card.colors)].sort().join('');
      return identity === [first, second].sort().join('');
    }).length;
    const firstColorCards = nonlands.filter(
      (card) => card.colors.length === 1 && card.colors[0] === first,
    ).length;
    const secondColorCards = nonlands.filter(
      (card) => card.colors.length === 1 && card.colors[0] === second,
    ).length;
    return {
      pair,
      exactMulticolorCards,
      firstColorCards,
      secondColorCards,
      fixingCards: fixing.length,
      supportShare:
        populations.nonlandCards.count === 0
          ? 0
          : (exactMulticolorCards + firstColorCards + secondColorCards) / populations.nonlandCards.count,
    };
  });

  const complexity = {
    denominator: populations.nonlandCards,
    meanOracleWords:
      nonlands.length === 0
        ? 0
        : nonlands.reduce((sum, card) => sum + oracleWords(card.text), 0) / nonlands.length,
    meanAbilityLines:
      nonlands.length === 0
        ? 0
        : nonlands.reduce((sum, card) => sum + abilityLines(card.text), 0) / nonlands.length,
    keywordOccurrencesPerCard:
      nonlands.length === 0
        ? 0
        : nonlands.reduce((sum, card) => sum + card.keywords.length, 0) / nonlands.length,
    decisionMarkersPerCard:
      nonlands.length === 0
        ? 0
        : nonlands.reduce((sum, card) => sum + decisionMarkers(card.text), 0) / nonlands.length,
    methodology:
      'Current Oracle word count, nonempty rules-text lines, explicit keyword occurrences, and decision-marker terms are separate static workload proxies; none measures actual board-state complexity.',
  };
  const creatureRate = rate(
    creatures.length,
    populations.nonlandCards,
    'Creature collector positions divided by all nonland main-set collector positions.',
  );
  const removalDensity = rate(
    removal.length,
    populations.nonlandCards,
    'Current Oracle text matched by the versioned direct removal, damage, bounce, or counterspell patterns divided by nonland positions.',
  );
  const interactionDensity = rate(
    interaction.length,
    populations.nonlandCards,
    'Direct removal plus target, fight, tap, blocking restriction, and prevention patterns divided by nonland positions.',
  );
  const bombRisk = rate(
    bombCards.length,
    populations.rareMythicNonlands,
    'Rare and mythic nonlands crossing the versioned multi-axis impact or efficient evasive-impact warning rule.',
  );
  const unplayableRisk = rate(
    unplayableCards.length,
    populations.commonUncommonNonlands,
    'Common and uncommon nonlands crossing the versioned no rules text or keywords, expensive-low-impact, or low-stat-efficiency warning rule.',
  );
  const meanEfficiency =
    efficiencies.length === 0 ? 0 : efficiencies.reduce((sum, value) => sum + value, 0) / efficiencies.length;

  const scalar = (
    id: string,
    value: number,
    unit: ScalarUnit,
    populationId: string,
    decision: string,
  ): ComparableScalar => ({
    id,
    value,
    unit,
    populationId,
    decision,
  });
  const comparableScalars = [
    scalar(
      'creature-rate',
      creatureRate.share,
      'share',
      creatureRate.denominator.id,
      'Set skeleton creature density.',
    ),
    scalar(
      'removal-density',
      removalDensity.share,
      'share',
      removalDensity.denominator.id,
      'Minimum direct-answer density.',
    ),
    scalar(
      'interaction-density',
      interactionDensity.share,
      'share',
      interactionDensity.denominator.id,
      'Total interactive card density.',
    ),
    scalar(
      'fixing-density',
      fixingRate.share,
      'share',
      fixingRate.denominator.id,
      'Color-access and splashing support.',
    ),
    scalar(
      'mean-mana-value',
      manaCurve.mean,
      'mana-value',
      manaCurve.denominator.id,
      'Overall castable curve height.',
    ),
    scalar(
      'mean-stat-efficiency',
      meanEfficiency,
      'stats-per-mana',
      populations.numericCreatures.id,
      'Creature body efficiency.',
    ),
    scalar(
      'mean-oracle-words',
      complexity.meanOracleWords,
      'words-per-card',
      complexity.denominator.id,
      'Reading workload proxy.',
    ),
    scalar(
      'mean-ability-lines',
      complexity.meanAbilityLines,
      'lines-per-card',
      complexity.denominator.id,
      'Rules-block segmentation proxy.',
    ),
    scalar(
      'keyword-density',
      complexity.keywordOccurrencesPerCard,
      'lines-per-card',
      complexity.denominator.id,
      'Keyword vocabulary load proxy.',
    ),
    scalar(
      'decision-marker-density',
      complexity.decisionMarkersPerCard,
      'words-per-card',
      complexity.denominator.id,
      'Choice and targeting workload proxy.',
    ),
    scalar(
      'combat-keyword-share',
      creatures.length === 0 ? 0 : cardsWithCombatKeyword / creatures.length,
      'share',
      populations.creatures.id,
      'Combat texture density.',
    ),
    scalar(
      'bomb-risk-proxy',
      bombRisk.share,
      'share',
      bombRisk.denominator.id,
      'Static rare upper-tail warning rate.',
    ),
    scalar(
      'unplayable-risk-proxy',
      unplayableRisk.share,
      'share',
      unplayableRisk.denominator.id,
      'Static common/uncommon weak-card warning rate.',
    ),
    ...CURVE_BUCKETS.map((bucket) =>
      scalar(
        `mana-curve-${bucket}`,
        manaCurve.shares[bucket] ?? 0,
        'share',
        manaCurve.denominator.id,
        `Share of the castable curve at mana value ${bucket}.`,
      ),
    ),
  ];

  return {
    profileVersion: REFERENCE_PROFILE_VERSION,
    set: {
      code: input.code,
      name: input.name,
      mainSetSize: cards.length,
      cardFaceRecords: input.cardFaceRecords ?? cards.length,
    },
    role: input.role,
    provenance: input.provenance,
    evidence: {
      kind: 'static-proxy',
      claimsGameplay: false,
      claimsHumanEvidence: false,
      caveat:
        'These are exact censuses and deterministic text/stat proxies over printed cards. They do not establish gameplay strength, draft pick quality, archetype viability, fun, or human outcomes.',
    },
    populations,
    raritySkeleton,
    colorSkeleton,
    manaCurve,
    creatureRate,
    statEfficiency: {
      denominator: populations.numericCreatures,
      meanStatsPerMana: meanEfficiency,
      byManaValue,
      methodology:
        '(Printed power + printed toughness) / max(1, current mana value), only for integer-stat creatures.',
    },
    removalDensity,
    interactionDensity,
    fixingDensity: fixingRate,
    combatKeywords: {
      denominator: populations.creatures,
      counts: combatCounts,
      cardsWithKeyword: cardsWithCombatKeyword,
      share: creatures.length === 0 ? 0 : cardsWithCombatKeyword / creatures.length,
    },
    complexity,
    mechanicAsFan:
      input.booster === undefined
        ? {
            status: 'unavailable',
            reason: 'No checked booster collation was supplied; uniform-card as-fan is not substituted.',
          }
        : mechanicAsFan(input.booster),
    archetypeSupport: {
      denominator: populations.nonlandCards,
      pairs: pairSupport,
      methodology:
        'For each two-color pair, counts exact two-color cards and monocolor cards in either color. This is a card-supply proxy, not evidence that the cards form a coherent or winning archetype.',
    },
    riskProxies: {
      bombRisk,
      unplayableRisk,
      methodology:
        'Versioned warning heuristics use current text features and printed stats. They deliberately label risk for later native simulation and human review; they never label a card proven bomb or unplayable.',
    },
    comparableScalars,
  };
}

export function deriveReferenceSetProfile(corpus: ReferenceCorpus, set: ReferenceSet): StaticSetProfile {
  const cards = referenceCards(set);
  const byId = new Map<string, StaticProfileCard>();
  for (const card of set.cards) {
    byId.set(card.uuid, {
      id: card.uuid,
      name: card.name,
      rarity: card.rarity,
      colors: card.colors,
      colorIdentity: card.colorIdentity,
      types: card.types,
      keywords: card.keywords,
      ...(card.text === undefined ? {} : { text: card.text }),
      ...(card.manaValue === undefined ? {} : { manaValue: card.manaValue }),
      ...(card.power === undefined ? {} : { power: card.power }),
      ...(card.toughness === undefined ? {} : { toughness: card.toughness }),
    });
  }
  return deriveProfile({
    code: set.code,
    name: set.name,
    cards,
    cardFaceRecords: set.cards.length,
    role: roleFor(set.code),
    provenance: {
      provider: corpus.source.provider,
      sourceVersion: corpus.source.version,
      builtDate: corpus.source.builtDate,
      sourceUrl: set.sourceUrl,
      sourceSha256: set.sourceSha256,
      oracleSemantics: 'current',
      populationRule:
        "Cards tagged main-set are collector positions; a record with side 'b' is excluded because back faces share the front face's physical collector position.",
    },
    booster: { set, cardsById: byId },
  });
}

export function deriveCardSetProfile(input: {
  readonly code: string;
  readonly name: string;
  readonly cards: readonly StaticProfileCard[];
  readonly provenance: { readonly kind: string; readonly source: string };
}): StaticSetProfile {
  return deriveProfile({
    code: input.code,
    name: input.name,
    cards: input.cards,
    role: 'subject',
    provenance: {
      provider: input.provenance.kind,
      sourceVersion: REFERENCE_PROFILE_VERSION,
      builtDate: 'not-applicable',
      sourceUrl: input.provenance.source,
      sourceSha256: 'not-applicable',
      oracleSemantics: 'current',
      populationRule:
        'Every supplied executable card is one collector position; no implicit collation or duplicate weighting is inferred.',
    },
  });
}

const DEFAULT_TOLERANCE: TargetBandTolerance = {
  shareHalfWidth: 0.03,
  meanRelativeHalfWidth: 0.1,
  meanMinimumHalfWidth: 0.1,
};

function bandFor(metric: ComparableScalar, tolerance: TargetBandTolerance): { lower: number; upper: number } {
  const halfWidth =
    metric.unit === 'share'
      ? tolerance.shareHalfWidth
      : Math.max(Math.abs(metric.value) * tolerance.meanRelativeHalfWidth, tolerance.meanMinimumHalfWidth);
  const lower = Math.max(0, metric.value - halfWidth);
  const upper = metric.unit === 'share' ? Math.min(1, metric.value + halfWidth) : metric.value + halfWidth;
  return { lower, upper };
}

export function buildPrimaryCoreEnvelope(
  m11: StaticSetProfile,
  m13: StaticSetProfile,
  options: { readonly precedence?: 'M11' | 'M13'; readonly tolerance?: TargetBandTolerance } = {},
): PrimaryCoreEnvelope {
  if (m11.set.code !== 'M11' || m13.set.code !== 'M13')
    throw new Error('primary core envelope requires M11 then M13');
  const precedence = options.precedence ?? 'M13';
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const m13ById = new Map(m13.comparableScalars.map((metric) => [metric.id, metric]));
  const metrics = m11.comparableScalars.map((left): PrimaryCoreEnvelopeMetric => {
    const right = m13ById.get(left.id);
    if (right === undefined || right.unit !== left.unit)
      throw new Error(`M13 lacks comparable scalar ${left.id}`);
    const leftBand = bandFor(left, tolerance);
    const rightBand = bandFor(right, tolerance);
    const anchors = [
      { setCode: 'M11' as const, exactValue: left.value, band: leftBand, populationId: left.populationId },
      { setCode: 'M13' as const, exactValue: right.value, band: rightBand, populationId: right.populationId },
    ];
    const lower = Math.max(leftBand.lower, rightBand.lower);
    const upper = Math.min(leftBand.upper, rightBand.upper);
    if (lower <= upper) {
      return {
        id: left.id,
        unit: left.unit,
        anchors,
        target: { lower, upper },
        resolution: 'intersection',
        rationale:
          'The two separately versioned static policy target bands overlap, so their intersection is the narrow reversible target. This is a design tolerance, not a confidence interval.',
      };
    }
    const selected = precedence === 'M13' ? rightBand : leftBand;
    return {
      id: left.id,
      unit: left.unit,
      anchors,
      target: selected,
      resolution: 'precedence',
      selectedSet: precedence,
      rationale: `The static policy target bands do not overlap; configurable ${precedence} precedence selects that band while both exact census values and bands remain visible. This is not statistical uncertainty.`,
    };
  });
  return {
    policyVersion: TARGET_BAND_POLICY_VERSION,
    anchorCodes: ['M11', 'M13'],
    precedence,
    tolerance,
    caveat:
      'Bands are explicit design tolerances around exact static census values, not sampling uncertainty, confidence intervals, or native-play evidence.',
    excluded: {
      secondaryCore: ['M15', 'M20', 'ORI'],
      expansions: ['ISD', 'RTR', 'RAV', 'ROE', 'SOM', 'KTK'],
      stressOnly: ['MH2'],
    },
    metrics,
  };
}

export function buildReferenceProfileArtifact(corpus: ReferenceCorpus): ReferenceProfileArtifact {
  const profiles = corpus.sets.map((set) => deriveReferenceSetProfile(corpus, set));
  const m11 = profiles.find((profile) => profile.set.code === 'M11');
  const m13 = profiles.find((profile) => profile.set.code === 'M13');
  if (m11 === undefined || m13 === undefined) throw new Error('reference corpus lacks M11 or M13');
  return {
    schemaVersion: 1,
    profileVersion: REFERENCE_PROFILE_VERSION,
    sourceCorpus: {
      schemaVersion: corpus.schemaVersion,
      provider: corpus.source.provider,
      version: corpus.source.version,
      builtDate: corpus.source.builtDate,
    },
    profiles,
    primaryCore: buildPrimaryCoreEnvelope(m11, m13),
  };
}

export function loadReferenceProfileArtifact(
  path: string = REFERENCE_PROFILE_PATH,
): ReferenceProfileArtifact {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (cause) {
    throw new InvalidInputError(
      'reference profile artifact',
      cause instanceof Error ? `${path}: ${cause.message}` : `${path}: unreadable JSON`,
    );
  }
  const parsed = ArtifactBoundarySchema.safeParse(value);
  if (!parsed.success)
    throw new InvalidInputError('reference profile artifact', `${path}: ${parsed.error.message}`);
  return parsed.data;
}

export interface ProfileScalarDiff {
  readonly subject: { readonly code: string; readonly name: string };
  readonly references: readonly {
    readonly targetCode: string;
    readonly targetName: string;
    readonly role: ProfileRole;
    readonly metrics: readonly {
      readonly id: string;
      readonly subject: number;
      readonly target: number;
      readonly delta: number;
      readonly unit: ScalarUnit;
    }[];
  }[];
  readonly primaryCore: {
    readonly policyVersion: string;
    readonly metrics: readonly {
      readonly id: string;
      readonly value: number;
      readonly target: { readonly lower: number; readonly upper: number };
      readonly status: 'below' | 'inside' | 'above';
      readonly deltaToBand: number;
    }[];
  };
  readonly caveat: string;
}

export function profileScalarDiff(
  subject: StaticSetProfile,
  artifact: ReferenceProfileArtifact,
): ProfileScalarDiff {
  const subjectById = new Map(subject.comparableScalars.map((metric) => [metric.id, metric]));
  const references = artifact.profiles.map((target) => ({
    targetCode: target.set.code,
    targetName: target.set.name,
    role: target.role,
    metrics: target.comparableScalars.flatMap((metric) => {
      const value = subjectById.get(metric.id);
      return value === undefined
        ? []
        : [
            {
              id: metric.id,
              subject: value.value,
              target: metric.value,
              delta: value.value - metric.value,
              unit: metric.unit,
            },
          ];
    }),
  }));
  const metrics = artifact.primaryCore.metrics.flatMap((metric) => {
    const subjectMetric = subjectById.get(metric.id);
    if (subjectMetric === undefined) return [];
    const value = subjectMetric.value;
    const status = value < metric.target.lower ? 'below' : value > metric.target.upper ? 'above' : 'inside';
    const deltaToBand =
      status === 'below' ? value - metric.target.lower : status === 'above' ? value - metric.target.upper : 0;
    return [{ id: metric.id, value, target: metric.target, status, deltaToBand } as const];
  });
  return {
    subject: { code: subject.set.code, name: subject.set.name },
    references,
    primaryCore: { policyVersion: artifact.primaryCore.policyVersion, metrics },
    caveat:
      'This diff compares deterministic static proxies and policy targets. It does not establish gameplay balance, draft quality, human preference, or confidence-adjusted card strength.',
  };
}

/** Kept exported so consumers can validate generated or hand-edited profile documents. */
export const ReferenceProfileArtifactSchema = ArtifactBoundarySchema;

/** Kept for callers that need to normalize an imported reference record in their own checked adapters. */
export type { ReferenceCard };
