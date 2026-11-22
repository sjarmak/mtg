/**
 * What a human asked for, split along the line the whole lab is built on.
 *
 * Two kinds of criterion live here and they are not interchangeable.
 * **Structural** criteria (format legality, color identity, mana value, card
 * type, price) are settled by SQL against the card store: they are facts about
 * a row, and code decides them. **Semantic** criteria (archetype, synergy
 * themes, power band) are judgments about what a card *does* and how well it
 * does it, and code must not decide them — the model does, over the pool the
 * structural pass already narrowed.
 *
 * Every criterion carries a stable `id`. That id is what an inclusion cites in
 * the final report, which is what makes "every card traces to a stated
 * criterion" checkable rather than aspirational: a justification naming an id
 * the user never stated is a bug the report catches.
 */
import { z } from 'zod';
import { COLORS } from '@mtg/dsl';

/**
 * Formats the store can answer for, matching Scryfall's `legalities` keys.
 *
 * Constrained rather than free string because a typo silently returns an empty
 * pool, which reads as "no cards matched your criteria" instead of "you asked
 * for a format that does not exist".
 */
export const DECK_FORMATS = [
  'standard',
  'pioneer',
  'modern',
  'legacy',
  'vintage',
  'pauper',
  'commander',
  'brawl',
  'historic',
  'timeless',
  'premodern',
  'duel',
  'oathbreaker',
] as const;

export type DeckFormat = (typeof DECK_FORMATS)[number];

/** Deck sizes the assembler knows how to fill. */
export const DECK_SIZES = { limited: 40, constructed: 60, commander: 100 } as const;

export const ColorSchema = z.enum(COLORS);

/**
 * A budget expressed the way players express it: a ceiling on the whole deck,
 * a ceiling per card, or both. Prices are the cheapest non-digital printing in
 * USD; a card with no price at all is treated as unpriced, never as free.
 */
export const BudgetSchema = z
  .object({
    maxDeckUsd: z.number().positive().optional(),
    maxCardUsd: z.number().positive().optional(),
    /** Allow cards the store has no USD price for. Off by default: an unpriced
     * card cannot be held to a budget, so including one silently breaks it. */
    allowUnpriced: z.boolean().default(false),
  })
  .strict();

export type Budget = z.infer<typeof BudgetSchema>;

const OpponentPopulationMemberSchema = z
  .object({
    /** Stable deck or archetype identity used by later gameplay comparisons. */
    id: z.string().min(1),
    /** Expected fraction of games against this member. */
    share: z.number().positive().max(1),
    /** What the opposing deck is trying to do, supplied to the model as context. */
    strategy: z.string().min(1),
  })
  .strict();

export const OpponentPopulationSchema = z
  .object({
    id: z.string().min(1),
    members: z.array(OpponentPopulationMemberSchema).min(1),
  })
  .strict()
  .superRefine((population, context) => {
    const ids = new Set<string>();
    for (const [index, member] of population.members.entries()) {
      if (ids.has(member.id)) {
        context.addIssue({
          code: 'custom',
          path: ['members', index, 'id'],
          message: `duplicate opponent id ${member.id}`,
        });
      }
      ids.add(member.id);
    }
    const total = population.members.reduce((sum, member) => sum + member.share, 0);
    if (Math.abs(total - 1) > 1e-9) {
      context.addIssue({
        code: 'custom',
        path: ['members'],
        message: `opponent shares must sum to 1; received ${String(total)}`,
      });
    }
  });

export type OpponentPopulation = z.infer<typeof OpponentPopulationSchema>;

export const DeckCriteriaSchema = z
  .object({
    /** The human's own words. Carried verbatim to the model, never parsed by code. */
    prompt: z.string().min(1),
    /**
     * The format the deck must be legal in, when the pool is the card store.
     *
     * Optional because a deck can also be built over a staged set's own cards,
     * and a generated set has no format legality at all: nothing in it is legal
     * or illegal in Modern, so a stated format would be a criterion the pool
     * cannot enforce and a line in the report nothing checked. Exactly one of
     * `format` and `sets` is stated, and `pool.ts` is what refuses the other
     * three combinations — refused rather than ignored, because a false
     * statement to the model is worse than a missing one.
     */
    format: z.enum(DECK_FORMATS).optional(),
    /**
     * The staged sets the pool was drawn from, by set code, when the deck is
     * built over cards this kernel can actually run.
     *
     * Present exactly when `format` is absent. It is a structural criterion an
     * inclusion may cite for the same reason `format` is one: it is a fact about
     * where a card came from, and a card outside it does not exist for this
     * build.
     */
    sets: z.array(z.string().min(1)).optional(),
    /** Deck's color identity. Empty means the model may choose. */
    colors: z.array(ColorSchema).max(5).default([]),
    /** Total cards including lands. */
    size: z.int().min(40).max(250).default(60),
    /**
     * How many of those are lands. Absent means the player did not say, and the
     * model decides: the count follows from the deck's curve and its plan, which
     * is a judgment, while the split of that count across colors is arithmetic
     * and stays in code. A stated count wins outright. See `land-plan.ts`.
     */
    landCount: z.int().min(0).max(60).optional(),
    /** Max copies of any one non-basic card. */
    maxCopies: z.int().min(1).max(4).default(4),
    /**
     * Named archetype, e.g. "aggro", "reanimator". Free text on purpose: this
     * is a semantic criterion the model resolves, so constraining the vocabulary
     * here would just move the judgment into code.
     */
    archetype: z.string().optional(),
    /** Synergy themes, e.g. ["lifegain", "artifacts"]. Semantic. */
    themes: z.array(z.string().min(1)).default([]),
    /** Structural ceiling on mana value; the curve shape itself is semantic. */
    maxManaValue: z.number().min(0).max(20).optional(),
    budget: BudgetSchema.optional(),
    /**
     * Free-text power band, e.g. "casual kitchen-table", "competitive". Purely
     * semantic: there is no power column in the store to filter on, and a
     * hardcoded rarity-to-power table would be exactly the heuristic scoring
     * the project's ZFC rule forbids.
     */
    powerBand: z.string().optional(),
    /**
     * The field this deck is intended to face. This is strategic context for
     * construction, not evidence that the resulting deck beats that field;
     * outcome evidence records the frozen gauntlet separately.
     */
    opponentPopulation: OpponentPopulationSchema.optional(),
  })
  .strict();

export type DeckCriteria = z.infer<typeof DeckCriteriaSchema>;
export type DeckCriteriaInput = z.input<typeof DeckCriteriaSchema>;

/**
 * The criteria a build actually runs against: everything the player stated, plus
 * the land count once something has decided it.
 *
 * The count is optional in what a player states and required here, because by
 * the time cards are being chosen the deck has a spell target and a land slot,
 * and both come from that number. `resolveCriteria` in `land-plan.ts` is the one
 * place that fuses the two, and this class is what holds that to the type
 * instead of to a comment.
 *
 * It is a class with private fields rather than a branded interface because a
 * brand only guarantees the field it sits on. `{ ...criteria, landCount: 24 }`
 * was already refused, but `{ ...built.criteria, size: 100 }` type-checked and
 * handed the assembler an eighteen-land count decided for a sixty-card deck
 * (mtg-bc2.93). No object literal satisfies a type with a `#private` member, so
 * every reshaping of a resolved criteria is refused, not just the two the brand
 * could see. The count is held privately and handed out through the accessor,
 * which is what makes a hand-written count impossible to substitute.
 *
 * The class stays a type on the package surface — `index.ts` exports it under
 * `export type` — so an importer can name it, hold one, and never construct one.
 * `toJSON` keeps the JSON round trip exactly what the branded record produced:
 * the stated criteria plus the count, with nothing of this class in it.
 */
export class ResolvedCriteria implements DeckCriteria {
  readonly #stated: DeckCriteria;
  readonly #landCount: number;

  /** Package-private by construction: the barrel exports only the type. */
  constructor(stated: DeckCriteria, landCount: number) {
    this.#stated = stated;
    this.#landCount = landCount;
  }

  get prompt(): DeckCriteria['prompt'] {
    return this.#stated.prompt;
  }

  get format(): DeckCriteria['format'] {
    return this.#stated.format;
  }

  get sets(): DeckCriteria['sets'] {
    return this.#stated.sets;
  }

  get colors(): DeckCriteria['colors'] {
    return this.#stated.colors;
  }

  get size(): DeckCriteria['size'] {
    return this.#stated.size;
  }

  /** Decided, never stated: the one field this type adds to what a player said. */
  get landCount(): number {
    return this.#landCount;
  }

  get maxCopies(): DeckCriteria['maxCopies'] {
    return this.#stated.maxCopies;
  }

  get archetype(): DeckCriteria['archetype'] {
    return this.#stated.archetype;
  }

  get themes(): DeckCriteria['themes'] {
    return this.#stated.themes;
  }

  get maxManaValue(): DeckCriteria['maxManaValue'] {
    return this.#stated.maxManaValue;
  }

  get budget(): DeckCriteria['budget'] {
    return this.#stated.budget;
  }

  get powerBand(): DeckCriteria['powerBand'] {
    return this.#stated.powerBand;
  }

  get opponentPopulation(): DeckCriteria['opponentPopulation'] {
    return this.#stated.opponentPopulation;
  }

  /** What a JSON round trip sees: the record, never the holder. */
  toJSON(): DeckCriteria {
    return { ...this.#stated, landCount: this.#landCount };
  }
}

export type CriterionKind = 'structural' | 'semantic';

/** One stated criterion, in the form an inclusion cites. */
export interface Criterion {
  readonly id: string;
  readonly kind: CriterionKind;
  /** Human-readable restatement, used in prompts and in the report. */
  readonly statement: string;
}

/**
 * Explodes the criteria object into the flat, citable list.
 *
 * Only criteria the user actually stated appear. Defaults that were never
 * mentioned (a 60-card deck when they said nothing about size) still constrain
 * the build, but they are not things an inclusion may cite as its reason.
 */
export function enumerateCriteria(criteria: DeckCriteria): readonly Criterion[] {
  const out: Criterion[] = [];

  // One of the two always fires: `pool.ts` refuses criteria that state neither,
  // so the list is never left without the criterion that says what may enter it.
  if (criteria.format !== undefined) {
    out.push({ id: 'format', kind: 'structural', statement: `legal in ${criteria.format}` });
  }
  if (criteria.sets !== undefined && criteria.sets.length > 0) {
    out.push({
      id: 'sets',
      kind: 'structural',
      statement: `printed in ${criteria.sets.join(', ')}`,
    });
  }

  if (criteria.colors.length > 0) {
    out.push({
      id: 'colors',
      kind: 'structural',
      statement: `color identity within {${criteria.colors.join('')}}`,
    });
  }
  if (criteria.maxManaValue !== undefined) {
    out.push({
      id: 'maxManaValue',
      kind: 'structural',
      statement: `mana value at most ${criteria.maxManaValue}`,
    });
  }
  if (criteria.budget !== undefined) {
    out.push({ id: 'budget', kind: 'structural', statement: describeBudget(criteria.budget) });
  }
  if (criteria.archetype !== undefined) {
    out.push({
      id: 'archetype',
      kind: 'semantic',
      statement: `supports the ${criteria.archetype} archetype`,
    });
  }
  // Cited by name, not position, so reordering the input cannot invalidate a
  // recorded justification.
  for (const theme of criteria.themes) {
    out.push({
      id: `theme:${theme}`,
      kind: 'semantic',
      statement: `contributes to the ${theme} theme`,
    });
  }
  if (criteria.powerBand !== undefined) {
    out.push({
      id: 'powerBand',
      kind: 'semantic',
      statement: `fits the ${criteria.powerBand} power band`,
    });
  }
  if (criteria.opponentPopulation !== undefined) {
    const members = criteria.opponentPopulation.members
      .map(
        (member) => `${member.id} (${String(Number((member.share * 100).toFixed(2)))}% — ${member.strategy})`,
      )
      .join('; ');
    out.push({
      id: 'opponents',
      kind: 'semantic',
      statement: `targets ${criteria.opponentPopulation.id}: ${members}`,
    });
  }
  return out;
}

function describeBudget(budget: Budget): string {
  const parts: string[] = [];
  if (budget.maxDeckUsd !== undefined) parts.push(`deck under $${budget.maxDeckUsd}`);
  if (budget.maxCardUsd !== undefined) parts.push(`no card over $${budget.maxCardUsd}`);
  if (parts.length === 0) parts.push('priced cards only');
  return parts.join(', ');
}

/** The ids an inclusion is allowed to cite. */
export function criterionIds(criteria: DeckCriteria): ReadonlySet<string> {
  return new Set(enumerateCriteria(criteria).map((criterion) => criterion.id));
}
