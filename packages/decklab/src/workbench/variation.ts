/**
 * A built deck, as the workbench keeps it: one variation on one question.
 *
 * The workbench is not a chat. A build takes minutes and costs model spend, so
 * the loop that fits it is state one, build it, look at it, change one thing,
 * build again — and the record of that loop is a shelf of variations, each
 * naming the one it came from. `parentId` is what makes "make it cheaper" a diff
 * against a named predecessor rather than a sentence in a transcript nobody can
 * re-run.
 *
 * # Why this is not `DeckArtifact`
 *
 * `../artifact.ts` is the document for a deck of *real printings*. Every
 * per-card field in it is read off a printing — the Scryfall art URL, the
 * artist, the price — and it keys a card by `name`, because a printing has no id
 * a page can resolve. A deck cut from a staged set has none of that: it was
 * never printed, its art lives in that set's own manifest, and its cards have
 * ids that are the whole basis of reopening it.
 *
 * So a variation keys cards by **DSL card id**, which is what
 * `@mtg/ui`'s `routes/deck/build.ts` already reopens a deck against, and carries
 * no art and no price at all. The page resolves each id against the staged set
 * it already has, and gets that set's own art for free. Writing an artifact here
 * instead would have meant inventing three fields and a format.
 *
 * The name rides beside the id for the reason `routes/deck/saved-decks.ts` gives:
 * the id is the only thing that can go stale and the name is the only thing a
 * refusal can say out loud. `xmp-skyborn-fledgling` is not a sentence anybody can
 * act on.
 *
 * # What it does carry that a saved deck does not
 *
 * The provenance. Every entry names the criterion ids it cited and the reason it
 * was chosen, because "every card traces to a stated criterion" is the deck
 * lab's second acceptance clause and a document that dropped it would make the
 * clause uncheckable on the surface where somebody actually looks at the deck.
 */
import { z } from 'zod';
import { COLORS } from '@mtg/dsl';
import { OpponentPopulationSchema } from '../criteria';

/**
 * Bumped when a field changes meaning or leaves. A stored variation at another
 * version fails the schema and is reported rather than half-read: a deck missing
 * three cards under the name of a sixty-card one is found out by losing a game.
 */
export const DECK_VARIATION_VERSION = 1;

/**
 * What a person stated, in the shape the workbench form collects it.
 *
 * A near-copy of `../criteria.ts`'s schema and deliberately not an import of it:
 * that module's `format` arm belongs to the card store, and the workbench builds
 * over staged sets only, so the pool here is `sets` and there is no format and
 * no dollar budget to state. Narrowing at the edge means the form cannot offer a
 * field the build would refuse.
 */
export const WorkbenchCriteriaSchema = z
  .object({
    /** The human's own words. Carried verbatim to the model, never parsed by code. */
    prompt: z.string().min(1),
    /** Set codes the pool is cut from. At least one: the pool is the whole point. */
    sets: z.array(z.string().min(1)).min(1),
    colors: z.array(z.enum(COLORS)).max(5).default([]),
    size: z.int().min(40).max(250).default(60),
    landCount: z.int().min(0).max(60).optional(),
    maxCopies: z.int().min(1).max(4).default(4),
    archetype: z.string().min(1).optional(),
    themes: z.array(z.string().min(1)).default([]),
    maxManaValue: z.number().min(0).max(20).optional(),
    powerBand: z.string().min(1).optional(),
    opponentPopulation: OpponentPopulationSchema.optional(),
  })
  .strict();

export type WorkbenchCriteria = z.infer<typeof WorkbenchCriteriaSchema>;
export type WorkbenchCriteriaInput = z.input<typeof WorkbenchCriteriaSchema>;

/** One chosen card: what it is, how many, and why it is here. */
export const VariationEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  count: z.int().min(1),
  manaCost: z.string().nullable(),
  manaValue: z.number(),
  typeLine: z.string(),
  /** Criterion ids this inclusion cited. Empty for a basic, which cites nothing. */
  criteria: z.array(z.string()).readonly(),
  /** The model's stated reason, or how a basic's count was arrived at. */
  reason: z.string(),
});

/**
 * Basics as a list rather than a record, so the document says exactly which
 * colors were counted out and in what order they were apportioned.
 */
export const VariationBasicSchema = z.object({
  color: z.enum(COLORS),
  count: z.int().min(0),
  /** The set's own basic for this color, so the page draws that set's Plains. */
  id: z.string().min(1),
});

export const VariationColorSchema = z.object({
  color: z.enum(COLORS),
  pipCount: z.number(),
  sources: z.number(),
  sourceFloor: z.number(),
  castability: z.number(),
  meetsTarget: z.boolean(),
});

export const VariationManaBaseSchema = z.object({
  totalLands: z.int().min(0),
  nonBasicLands: z.int().min(0),
  castabilityTarget: z.number(),
  heavyCastabilityTarget: z.number(),
  colors: z.array(VariationColorSchema).readonly(),
  /** Why the land count is what it is: the player said, or the model decided. */
  landReason: z.string(),
  landSource: z.enum(['stated', 'model']),
});

/** One criterion, restated, so the page can resolve an entry's cited ids. */
export const VariationCriterionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['structural', 'semantic']),
  statement: z.string().min(1),
});

/**
 * What the build cost, kept on the document that outlives the run.
 *
 * `mtg-yp33.7`. The dollars were measured on every round and thrown away with
 * the process, so a shelf could say a deck was finished and never say what it
 * cost to finish. On a surface whose whole safety story is a stated ceiling, the
 * one number nobody could read afterwards was dollars.
 *
 * `spentUsd` is the whole bill and `maxSpendUsd` is the ceiling that bounded the
 * selection loop, which is not quite the same span: the land-count call is made
 * before the loop and outside its meter. `../build.ts`'s `BuildSpend` carries
 * the bounded part separately for a reader who needs the two apart; a shelf
 * wants the bill and the ceiling it was authorized against.
 */
export const VariationBuildSchema = z.object({
  /** Rounds the selection loop ran, which is what the dollars were spent on. */
  rounds: z.int().min(0),
  spentUsd: z.number().min(0),
  maxSpendUsd: z.number().positive(),
});

/** Versioned construction context written by Decklab; optional on older shelf entries. */
export const VariationConstructionSchema = z.object({
  format: z.object({
    id: z.literal('decklab-constructed-format/v1'),
    source: z.union([
      z.object({ kind: z.literal('format'), format: z.string().min(1) }),
      z.object({ kind: z.literal('sets'), sets: z.array(z.string().min(1)).min(1).readonly() }),
      z.object({
        kind: z.literal('printed-format'),
        formatId: z.string().min(1),
        sourceCodes: z.array(z.string().min(1)).min(1).readonly(),
      }),
    ]),
    deckSize: z.int().positive(),
    landCount: z.int().min(0),
    spellCount: z.int().min(0),
    copyLimit: z.int().positive(),
    opponentPopulation: z
      .object({
        id: z.string().min(1),
        members: z
          .array(
            z.object({
              id: z.string().min(1),
              share: z.number().positive(),
              strategy: z.string().min(1),
            }),
          )
          .readonly(),
      })
      .nullable(),
  }),
  selection: z.object({
    id: z.literal('decklab-model-repair/v1'),
    provider: z.string().min(1),
    model: z.string().min(1),
    fallbackId: z.literal('decklab-verified-partial/v1'),
  }),
});

export const DeckVariationSchema = z.object({
  version: z.literal(DECK_VARIATION_VERSION),
  /** Stable across renames, which is why the name is not the key. */
  id: z.string().min(1),
  name: z.string().min(1),
  /** ISO 8601, written by the build. Shown so a shelf of five has an order. */
  builtAt: z.string().min(1),
  /**
   * The variation this one was built from, when the person rebuilt rather than
   * started over. `null` is a first build, and is not the same as a missing
   * parent: the shelf draws a lineage, and a broken link would draw a lie.
   */
  parentId: z.string().min(1).nullable(),
  criteria: WorkbenchCriteriaSchema,
  /** Every criterion an entry may cite, so the page resolves ids without guessing. */
  statedCriteria: z.array(VariationCriterionSchema).readonly(),
  /** The model's stated plan for the deck, in its own words. */
  plan: z.string(),
  spells: z.array(VariationEntrySchema).readonly(),
  lands: z.array(VariationEntrySchema).readonly(),
  basics: z.array(VariationBasicSchema).readonly(),
  manaBase: VariationManaBaseSchema,
  /** How many cards the pool held. Context for a deck that came up short. */
  universeSize: z.int().min(0),
  /**
   * What the build could not do, in the build's own words.
   *
   * Kept on the document rather than thrown away with the run, because a
   * variation that is 4 cards short is a real variation somebody may still want
   * to look at, and a shelf that drew it as complete would be lying about it.
   */
  shortfalls: z.array(z.string()).readonly(),
  /** Absent on variations written before selector attribution was recorded. */
  construction: VariationConstructionSchema.optional(),
  /**
   * What this build cost. Absent on every variation written before it was kept.
   *
   * Optional rather than a version bump, because the version is bumped when a
   * field changes meaning or leaves and an added field does neither. Dropping
   * the variations already on disk to gain a dollar figure would have made the
   * shelf worse than the hole this fixes, and a surface that says "not recorded"
   * about an older build is telling the truth about it.
   */
  build: VariationBuildSchema.optional(),
});

export type DeckVariation = z.infer<typeof DeckVariationSchema>;
export type VariationBuild = z.infer<typeof VariationBuildSchema>;
export type VariationConstruction = z.infer<typeof VariationConstructionSchema>;
export type VariationEntry = z.infer<typeof VariationEntrySchema>;
export type VariationBasic = z.infer<typeof VariationBasicSchema>;
export type VariationManaBase = z.infer<typeof VariationManaBaseSchema>;

/**
 * The row a shelf draws, without the deck.
 *
 * A shelf of thirty variations does not need thirty decklists to draw itself,
 * and sending them would make opening the tab proportional to how much work has
 * been done in it.
 */
export const VariationSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  builtAt: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  prompt: z.string(),
  sets: z.array(z.string()).readonly(),
  /**
   * The deck's color identity, in WUBRG order.
   *
   * Read off the mana base rather than off `criteria.colors`, because the two
   * are different claims: the criteria are what a person asked for and may be
   * empty ("leave every color off and the model chooses"), while this is what
   * the deck it produced actually casts. A shelf row saying "colorless" about a
   * mono-white deck is a false statement, and empty criteria is the ordinary way
   * to reach one.
   */
  colors: z.array(z.enum(COLORS)).readonly(),
  totalCards: z.int().min(0),
  shortfallCount: z.int().min(0),
  /**
   * What the build cost, or `null` for a variation built before it was kept.
   *
   * Null rather than zero. A build that cost nothing and a build whose cost was
   * never written are different facts, and only one of them is worth drawing a
   * dollar figure for.
   */
  spentUsd: z.number().nullable(),
  /** Rounds the selection loop ran, or `null` on a variation that never kept it. */
  rounds: z.int().nullable(),
});

export type VariationSummary = z.infer<typeof VariationSummarySchema>;

export function summarize(variation: DeckVariation): VariationSummary {
  const counted = [...variation.spells, ...variation.lands].reduce((sum, entry) => sum + entry.count, 0);
  const basics = variation.basics.reduce((sum, basic) => sum + basic.count, 0);
  return {
    id: variation.id,
    name: variation.name,
    builtAt: variation.builtAt,
    parentId: variation.parentId,
    prompt: variation.criteria.prompt,
    sets: variation.criteria.sets,
    // A color the deck spends mana on. The pip count is the mana base's own
    // reading of the chosen cards, so a splash the model added without being
    // asked shows up here and a color that was asked for and never used does
    // not.
    colors: variation.manaBase.colors.filter((entry) => entry.pipCount > 0).map((entry) => entry.color),
    totalCards: counted + basics,
    shortfallCount: variation.shortfalls.length,
    spentUsd: variation.build?.spentUsd ?? null,
    rounds: variation.build?.rounds ?? null,
  };
}
