/**
 * Zod schemas for a set-skeleton profile.
 *
 * The profile is canon transcribed from published design articles, so the
 * schema is deliberately stricter than the JSON needs to be: it pins the
 * keyword vocabulary, requires every color, and refuses ranges that run
 * backwards. Bad transcription should fail at load, not at generation time.
 */
import { z } from 'zod';
import { KEYWORDS } from '@mtg/dsl';
import { CitationSchema, CitedDocumentHeaderSchema } from './citations';

/**
 * Skeleton keywords are a superset of the pinned slice vocabulary: published
 * skeletons budget keywords the slice engine cannot run yet. `deriveSkeletonLite`
 * drops the extras rather than pretending they exist.
 */
export const SKELETON_ONLY_KEYWORDS = ['doubleStrike', 'ward', 'defender', 'flash'] as const;
export const SKELETON_KEYWORDS = [...KEYWORDS, ...SKELETON_ONLY_KEYWORDS] as const;
export type SkeletonKeyword = (typeof SKELETON_KEYWORDS)[number];

const skeletonKeywordSet: ReadonlySet<string> = new Set(SKELETON_KEYWORDS);

export function isSkeletonKeyword(name: string): name is SkeletonKeyword {
  return skeletonKeywordSet.has(name);
}

const colorRecord = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({ W: schema, U: schema, B: schema, R: schema, G: schema });

/**
 * A curve bucket's floor is 1, and that is the whole of the generator's
 * free-spell rule.
 *
 * Every slot window a generation stamps comes from one of five places, and four
 * of them are constants that already start at 1 or above: `SPELL_CURVE`,
 * `COLORLESS_PERMANENT_MV`, `BOMB_COLORLESS_PERMANENT_MV` and the roles table's
 * `manaValue` ranges. The fifth is a skeleton's creature curve, which is
 * authored data, and it was the one place a 0 could be written down. A brief's
 * `manaValue` pin cannot open a window — `accepts` only offers a slot whose
 * window already covers the number and `pin` then narrows it, and
 * `required-demand`'s `moveBody` checks `covers` before it grows a bucket — so
 * with this floor no path reaches a slot that would take a free card, and
 * `checkSlotConformance` fails any card outside its slot's window.
 *
 * `@mtg/dsl` used to carry the same rule as `MANA_COST_ZERO`, stated as a
 * property of the DSL. It is not one: the kernel offers, pays and resolves a {0}
 * spell from a board with no mana at all (`kernel/test/free-spell.test.ts`,
 * `mtg-nhyv.79`), so the rule moved to the layer whose policy it is.
 */
export const CurveBucketSchema = z
  .object({
    mvMin: z.int().min(1).max(20),
    mvMax: z.int().min(1).max(20),
    count: z.int().min(0).max(100),
  })
  .refine((bucket) => bucket.mvMax >= bucket.mvMin, {
    message: 'curve bucket mvMax must be >= mvMin',
  });
export type CurveBucket = z.infer<typeof CurveBucketSchema>;

/** Keyword budgets are fractional on purpose: they encode rotating slots. */
export const KeywordBudgetSchema = z
  .record(z.string().min(1), z.number().min(0).max(20))
  .refine((budget) => Object.keys(budget).every(isSkeletonKeyword), {
    message: `keyword budget keys must be one of: ${SKELETON_KEYWORDS.join(', ')}`,
  });

export const CreatureShareSchema = z.object({
  stated: z.number().min(0).max(1),
  statedNumerator: z.int().min(0),
  statedDenominator: z.int().min(1),
  previousStated: z.number().min(0).max(1),
  previousNumerator: z.int().min(0),
  previousDenominator: z.int().min(1),
});

export const CommonColorProfileSchema = z.object({
  creatures: z.int().min(0),
  creatureCurve: z.array(CurveBucketSchema).min(1),
  creatureShare: CreatureShareSchema,
  avgPower: z.object({ current: z.number().min(0), previous: z.number().min(0) }),
  keywords: KeywordBudgetSchema,
  spellSlots: z.array(z.string().min(1)),
});

export const UncommonColorProfileSchema = z
  .object({
    creaturesMin: z.int().min(0),
    creaturesMax: z.int().min(0),
    noncreaturesMin: z.int().min(0),
    noncreaturesMax: z.int().min(0),
  })
  .refine((p) => p.creaturesMax >= p.creaturesMin && p.noncreaturesMax >= p.noncreaturesMin, {
    message: 'uncommon ranges must not run backwards',
  });

export const ColorProfileSchema = z.object({
  common: CommonColorProfileSchema,
  uncommon: UncommonColorProfileSchema,
});

export const ColorlessProfileSchema = z.object({
  common: z.object({
    creatures: z.int().min(0),
    creatureCurve: z.array(CurveBucketSchema).min(1),
    spells: z.int().min(0),
    spellSlots: z.array(z.string().min(1)),
  }),
  uncommon: z
    .object({
      creatures: z.int().min(0),
      noncreaturesMin: z.int().min(0),
      noncreaturesMax: z.int().min(0),
      landsMin: z.int().min(0),
      landsMax: z.int().min(0),
    })
    .refine((p) => p.noncreaturesMax >= p.noncreaturesMin && p.landsMax >= p.landsMin, {
      message: 'colorless uncommon ranges must not run backwards',
    }),
});

export const SkeletonDataSchema = z.object({
  setSize: z.object({
    common: z.int().min(1),
    uncommon: z.int().min(1),
    rare: z.int().min(1),
    mythic: z.int().min(0),
    total: z.int().min(1),
  }),
  booster: z.object({
    land: z.int().min(0),
    common: z.int().min(1),
    uncommon: z.int().min(0),
    rareOrMythic: z.int().min(0),
    mythicOneInN: z.int().min(1),
  }),
  colors: colorRecord(ColorProfileSchema),
  colorless: ColorlessProfileSchema,
  multicolorUncommon: z.object({
    total: z.int().min(0),
    perPair: z.int().min(0),
    roles: z.array(z.string().min(1)),
  }),
  archetypes: z.object({
    pairs: z.array(z.string().regex(/^[WUBRG]{2}$/)).length(10),
    speedMix: z.object({
      fast: z.int().min(0),
      medium: z.int().min(0),
      slow: z.int().min(0),
      flex: z.int().min(0),
    }),
    noveltyMix: z.object({
      novel: z.int().min(0),
      twist: z.int().min(0),
      traditional: z.int().min(0),
    }),
  }),
  mechanics: z.object({ min: z.int().min(1), max: z.int().min(1) }),
  complexity: z.object({ nwoRedFlagBudget: z.number().min(0).max(1) }),
  asFanTargets: z.object({
    removal: z.number().min(0),
    removalShareOfPack: z.number().min(0).max(1),
    mainMechanicMin: z.number().min(0),
    goldInMulticolorSet: z.number().min(0),
  }),
  rarityRules: z.object({
    bombsMinRarity: z.enum(['common', 'uncommon', 'rare']),
    maxComplexityRarity: z.enum(['common', 'uncommon', 'rare']),
    rareCyclesMin: z.int().min(0),
    uncommonDesignSpaceShareSmallSet: z.number().min(0).max(1),
    uncommonDesignSpaceShareLargeSet: z.number().min(0).max(1),
  }),
});
export type SkeletonData = z.infer<typeof SkeletonDataSchema>;

export const SkeletonProfileDocumentSchema = CitedDocumentHeaderSchema.extend({
  profile: z.string().min(1),
  era: z.string().min(1),
  data: SkeletonDataSchema,
  citations: z.record(z.string().min(1), CitationSchema),
}).refine(
  (doc) => {
    const { common, uncommon, rare, mythic, total } = doc.data.setSize;
    return common + uncommon + rare + mythic === total;
  },
  { message: 'setSize rarities must sum to setSize.total' },
);

export type SkeletonProfileDocument = z.infer<typeof SkeletonProfileDocumentSchema>;
export type ColorProfile = z.infer<typeof ColorProfileSchema>;
export type CommonColorProfile = z.infer<typeof CommonColorProfileSchema>;
export type UncommonColorProfile = z.infer<typeof UncommonColorProfileSchema>;
export type ColorlessProfile = z.infer<typeof ColorlessProfileSchema>;
