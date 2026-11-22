/** Declarative official-set assembly. Catalog availability never grants play admission. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  PrintedConstructedFormatSchema,
  PrintedFormatRulesSchema,
  PrintedLimitedFormatSchema,
  serializedPrintedConstructedFormatContent,
  serializedPrintedLimitedFormatContent,
} from '@mtg/printed-card';
import type { PrintedCardCatalog, PrintedConstructedFormat, PrintedLimitedFormat } from '@mtg/printed-card';
import { buildPrintedBoosterProduct } from './booster-product';
import { buildPrintedSetCatalog, type PrintedSetForgeInputs } from './set-catalog';
import type { PrintedSourcePin } from './source-pin';

const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const Code = z.string().regex(/^[A-Z0-9]{2,8}$/);
const unique = (values: readonly string[]) => new Set(values).size === values.length;

const LimitedRecipeSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    /** Absent on every recipe written before a second kind existed. */
    kind: z.literal('limited').optional(),
    id: Slug,
    name: z.string().trim().min(1),
    sourceCodes: z.array(Code).min(1).refine(unique, 'duplicate source code'),
    products: z
      .array(
        z.strictObject({
          id: Slug,
          setCode: Code,
          boosterKey: z.string().regex(/^[a-zA-Z0-9_-]+$/),
        }),
      )
      .min(1),
    draft: PrintedLimitedFormatSchema.shape.draft,
    sealed: PrintedLimitedFormatSchema.shape.sealed,
    basicLandPolicy: PrintedLimitedFormatSchema.shape.basicLandPolicy,
  })
  .superRefine((recipe, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message });
    if (!unique(recipe.products.map((p) => p.id))) issue('duplicate product id');
    for (const p of recipe.products) {
      if (!recipe.sourceCodes.includes(p.setCode)) issue(`unknown product source: ${p.setCode}`);
    }
    for (const id of [...recipe.draft.rounds, ...recipe.sealed.boosters]) {
      if (!recipe.products.some((p) => p.id === id)) issue(`unknown recipe product: ${id}`);
    }
  });

/**
 * A deck is names and counts, the way Forge's own deck files state one. The
 * set code is where to look the name up; absent, the first recipe source
 * holding the name answers. A name and set code resolve to the first printing
 * of that name in the catalog's order, so a set with several arts of Plains
 * hands every deck the same one and two builds agree.
 */
const RecipeSlot = z.strictObject({ name: z.string().trim().min(1), setCode: Code.optional() });
const ConstructedRecipeSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal('constructed'),
    id: Slug,
    name: z.string().trim().min(1),
    sourceCodes: z.array(Code).min(1).refine(unique, 'duplicate source code'),
    rules: PrintedFormatRulesSchema,
    decks: z
      .array(
        z.strictObject({
          id: Slug,
          name: z.string().trim().min(1),
          commanders: z.array(RecipeSlot),
          cards: z.array(RecipeSlot.extend({ count: z.number().int().positive() })).min(1),
        }),
      )
      .min(1),
  })
  .superRefine((recipe, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message });
    if (!unique(recipe.decks.map((deck) => deck.id))) issue('duplicate deck id');
    for (const deck of recipe.decks) {
      for (const slot of [...deck.commanders, ...deck.cards]) {
        if (slot.setCode !== undefined && !recipe.sourceCodes.includes(slot.setCode)) {
          issue(`deck ${deck.id} names ${slot.name} from an unpinned set ${slot.setCode}`);
        }
      }
      if (recipe.rules.variant === 'commander' && deck.commanders.length === 0) {
        issue(`deck ${deck.id} names no commander on a commander table`);
      }
      if (recipe.rules.variant !== 'commander' && deck.commanders.length > 0) {
        issue(`deck ${deck.id} names a commander on a ${recipe.rules.variant} table`);
      }
      if (recipe.rules.variant === 'momir') {
        const counts = new Map(deck.cards.map((slot) => [slot.name, slot.count]));
        const basics = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
        if (deck.cards.length !== basics.length || basics.some((name) => counts.get(name) !== 12)) {
          issue(`deck ${deck.id} is not 12 each of Plains, Island, Swamp, Mountain, and Forest`);
        }
      }
    }
  });

export const PrintedFormatRecipeSchema = z.union([LimitedRecipeSchema, ConstructedRecipeSchema]);
export type PrintedFormatRecipe = z.infer<typeof PrintedFormatRecipeSchema>;
export type PrintedLimitedFormatRecipe = z.infer<typeof LimitedRecipeSchema>;
export type PrintedConstructedFormatRecipe = z.infer<typeof ConstructedRecipeSchema>;

function orderedSources(recipe: PrintedFormatRecipe, pin: PrintedSourcePin) {
  if (
    pin.sources.length !== recipe.sourceCodes.length ||
    !unique(pin.sources.map((s) => s.descriptor.code))
  ) {
    throw new Error('Pinned sources must exactly match recipe sourceCodes');
  }
  return recipe.sourceCodes.map((code) => {
    const source = pin.sources.find((s) => s.descriptor.code === code);
    if (source === undefined) throw new Error(`Missing pinned recipe source: ${code}`);
    return source;
  });
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
type FormatSources = PrintedLimitedFormat['sources'];

function sealLimitedFormat(
  recipe: PrintedLimitedFormatRecipe,
  sources: FormatSources,
  products: PrintedLimitedFormat['products'],
): PrintedLimitedFormat {
  const unsealed = PrintedLimitedFormatSchema.parse({
    schemaVersion: 1,
    kind: 'printed-limited-format',
    id: recipe.id,
    name: recipe.name,
    sources,
    products,
    draft: recipe.draft,
    sealed: recipe.sealed,
    basicLandPolicy: recipe.basicLandPolicy,
    contentSha256: '0'.repeat(64),
  });
  return PrintedLimitedFormatSchema.parse({
    ...unsealed,
    contentSha256: sha256(serializedPrintedLimitedFormatContent(unsealed)),
  });
}

function sealConstructedFormat(
  recipe: PrintedConstructedFormatRecipe,
  sources: FormatSources,
  decks: PrintedConstructedFormat['decks'],
): PrintedConstructedFormat {
  const unsealed = PrintedConstructedFormatSchema.parse({
    schemaVersion: 1,
    kind: 'printed-constructed-format',
    id: recipe.id,
    name: recipe.name,
    sources,
    rules: recipe.rules,
    decks,
    contentSha256: '0'.repeat(64),
  });
  return PrintedConstructedFormatSchema.parse({
    ...unsealed,
    contentSha256: sha256(serializedPrintedConstructedFormatContent(unsealed)),
  });
}

interface BuiltSource {
  readonly code: string;
  readonly catalog: PrintedCardCatalog;
}

/** A name and set code to the first catalog printing answering to it; two lines naming one printing are one slot. */
function resolveDeckSlots(
  deckId: string,
  slots: readonly {
    readonly name: string;
    readonly setCode?: string | undefined;
    readonly count?: number | undefined;
  }[],
  built: readonly BuiltSource[],
) {
  const resolved = new Map<string, { physicalId: string; name: string; count: number }>();
  for (const slot of slots) {
    const searched =
      slot.setCode === undefined ? built : built.filter((entry) => entry.code === slot.setCode);
    const printing = searched
      .flatMap((entry) => entry.catalog.cards)
      .find((card) => card.correctedName === slot.name);
    if (printing === undefined) {
      const where = slot.setCode ?? searched.map((entry) => entry.code).join(', ');
      throw new Error(`deck ${deckId}: no ${where} printing of "${slot.name}"`);
    }
    const count = slot.count ?? 1;
    const prior = resolved.get(printing.physicalId);
    resolved.set(printing.physicalId, {
      physicalId: printing.physicalId,
      name: printing.correctedName,
      count: (prior?.count ?? 0) + count,
    });
  }
  return [...resolved.values()];
}

function buildLimitedProducts(
  recipe: PrintedLimitedFormatRecipe,
  built: readonly (BuiltSource & {
    readonly source: PrintedSourcePin['sources'][number];
    readonly uuidToPhysicalId: ReadonlyMap<string, string>;
  })[],
): PrintedLimitedFormat['products'] {
  const identities = built.map(({ code, uuidToPhysicalId }) => ({ code, uuidToPhysicalId }));
  return recipe.products.map((product) => {
    const source = built.find((entry) => entry.code === product.setCode)!.source;
    const booster = source.document.data.booster[product.boosterKey];
    if (booster === undefined) throw new Error(`missing booster: ${product.setCode}/${product.boosterKey}`);
    for (const configuration of booster.boosters) {
      for (const sheet of Object.keys(configuration.contents)) {
        if (!Object.hasOwn(booster.sheets, sheet)) throw new Error(`missing booster sheet: ${sheet}`);
      }
    }
    return buildPrintedBoosterProduct(product.id, product.setCode, booster, identities);
  });
}

function buildSources(recipe: PrintedFormatRecipe, pin: PrintedSourcePin, forge: PrintedSetForgeInputs) {
  const built = orderedSources(recipe, pin).map((source) => ({
    source,
    code: source.descriptor.code,
    ...buildPrintedSetCatalog(source, pin, 'sources.json', forge),
  }));
  const sources: FormatSources = built.map(({ source, catalog }) => ({
    code: source.descriptor.code,
    catalogFormat: catalog.format,
    catalogSha256: catalog.contentSha256,
    mtgjson: {
      url: source.descriptor.mtgjson.url,
      sha256: source.descriptor.mtgjson.sha256,
      version: source.document.meta.version,
    },
  }));
  return { built, sources, catalogs: built.map((entry) => entry.catalog) };
}

const STATUS = 'catalog-only-not-play-admitted' as const;

function buildLimited(
  recipe: PrintedLimitedFormatRecipe,
  pin: PrintedSourcePin,
  forge: PrintedSetForgeInputs,
) {
  const { built, sources, catalogs } = buildSources(recipe, pin, forge);
  return {
    recipe,
    catalogs,
    format: sealLimitedFormat(recipe, sources, buildLimitedProducts(recipe, built)),
    status: STATUS,
  };
}

function buildConstructed(
  recipe: PrintedConstructedFormatRecipe,
  pin: PrintedSourcePin,
  forge: PrintedSetForgeInputs,
) {
  const { built, sources, catalogs } = buildSources(recipe, pin, forge);
  const decks = recipe.decks.map((deck) => ({
    id: deck.id,
    name: deck.name,
    commanders: resolveDeckSlots(deck.id, deck.commanders, built),
    cards: resolveDeckSlots(deck.id, deck.cards, built),
  }));
  return { recipe, catalogs, format: sealConstructedFormat(recipe, sources, decks), status: STATUS };
}

/** A booster-shaped recipe to its Limited format, typed for a caller that knows which kind it holds. */
export function buildPrintedLimitedFormat(
  input: unknown,
  pin: PrintedSourcePin,
  forge: PrintedSetForgeInputs,
) {
  return buildLimited(LimitedRecipeSchema.parse(input), pin, forge);
}

/** A deck-list recipe to its constructed format, every slot resolved to a catalog printing. */
export function buildPrintedConstructedFormat(
  input: unknown,
  pin: PrintedSourcePin,
  forge: PrintedSetForgeInputs,
) {
  return buildConstructed(ConstructedRecipeSchema.parse(input), pin, forge);
}

/** Either kind, told apart by the recipe's `kind`; the file writer's entry point. */
export function buildPrintedFormat(input: unknown, pin: PrintedSourcePin, forge: PrintedSetForgeInputs) {
  const recipe = PrintedFormatRecipeSchema.parse(input);
  return recipe.kind === 'constructed'
    ? buildConstructed(recipe, pin, forge)
    : buildLimited(recipe, pin, forge);
}
