/**
 * What a cube designer asked for, on the same ZFC line `@mtg/decklab` draws.
 *
 * **Structural** criteria (size, format legality, singleton, a price ceiling,
 * color balance, curve bands, pod capacity) are facts about a list of rows and
 * arithmetic over them, so code owns them end to end. **Semantic** criteria
 * (which cards serve which archetype, what belongs in a power band) are
 * judgments about what a card does, so the model owns them and code only
 * checks the answer against the store.
 *
 * The field set is Lucky Paper's four questions
 * (`docs/research/prior-art-set-design.md` §8.2) turned into schema: context is
 * `seats` and `cardsPerSeat`, restrictions are `format`, `singleton` and
 * `maxCardUsd`, ideal gameplay is `archetypes` and `curve`, and power level is
 * `prompt` — free text, because there is no power column in the store and a
 * hardcoded rarity-to-power table is exactly the heuristic scoring the
 * project's ZFC rule forbids.
 */
import { z } from 'zod';
import { COLORS } from '@mtg/dsl';
import { DECK_FORMATS } from '@mtg/decklab';

/** The Lucky Paper norm for a typical pod: 360-450, and 360 is the floor of it. */
export const CUBE_DEFAULT_SIZE = 360;

/** The pod the bead's acceptance criterion names. */
export const CUBE_DEFAULT_SEATS = 8;

/** Three 15-card packs, which is what an 8-seat 360 cube is sized around. */
export const CUBE_DEFAULT_CARDS_PER_SEAT = 45;

/**
 * How far one color's share may sit from an even share of the colors the cube
 * is measured across — a fifth when it states no archetypes, and one over the
 * colors its archetypes span when it does (`measuredColors` in `validate.ts`).
 *
 * Five points, not fifteen: on a 360-card cube with ~300 colored slots an even
 * split is 60 cards a color, and five points of share is fifteen cards. That
 * is already a list a drafter would notice; a looser default would pass a cube
 * whose weakest color holds half what its strongest does and call it balanced.
 */
export const CUBE_DEFAULT_COLOR_TOLERANCE = 0.05;

export const CubeColorSchema = z.enum(COLORS);

/**
 * One band of the curve, inclusive at both ends, with `to: null` meaning
 * open-ended. Bands are stated, never defaulted: a cube's curve is a designed
 * dial rather than a constant (§6.4 of the same lane report), so an unstated
 * curve is measured and reported but never failed.
 */
export const CurveBandSchema = z
  .object({
    from: z.int().min(0).max(20),
    /** Inclusive upper bound; `null` is "and everything above". */
    to: z.int().min(0).max(20).nullable(),
    minCards: z.int().min(0).max(1080),
    maxCards: z.int().min(0).max(1080),
  })
  .strict()
  .refine((band) => band.to === null || band.to >= band.from, {
    message: 'a curve band ends before it starts',
  })
  .refine((band) => band.maxCards >= band.minCards, {
    message: 'a curve band allows fewer cards than it requires',
  });

export type CurveBand = z.infer<typeof CurveBandSchema>;

/**
 * A named archetype and the colors it is drafted in.
 *
 * The name is free text on purpose — which archetypes a cube supports is the
 * designer's judgment and the model's to serve, and constraining the
 * vocabulary here would move that judgment into code. The colors are not:
 * a card whose color identity falls outside them cannot be cast in the deck,
 * and that is a fact about a row.
 */
export const CubeArchetypeSchema = z
  .object({
    name: z.string().min(1),
    colors: z.array(CubeColorSchema).min(1).max(5),
    /** How many cards the cube must hold for a drafter to assemble this deck. */
    minPlayable: z.int().min(1).max(1080),
    /**
     * The share of seats across the measured drafts that must be able to
     * assemble this archetype, in [0, 1].
     *
     * Stated, never defaulted, for the reason a curve band is: how many of eight
     * seats should be able to field one archetype is a designed dial — a cube
     * stating two archetypes wants both at most seats, and a cube stating ten
     * wants each at few — so an unstated minimum is measured and reported but
     * never failed. A default here would fail cubes against a number nobody
     * chose.
     */
    minAvailability: z.number().min(0).max(1).optional(),
  })
  .strict();

export type CubeArchetype = z.infer<typeof CubeArchetypeSchema>;

export const CubeCriteriaSchema = z
  .object({
    /** The designer's own words. Carried verbatim to the model, never parsed by code. */
    prompt: z.string().min(1),
    format: z.enum(DECK_FORMATS),
    size: z.int().min(45).max(1080).default(CUBE_DEFAULT_SIZE),
    /** One copy of each card, which is what nearly every cube means by "cube". */
    singleton: z.boolean().default(true),
    /** Per-card USD ceiling at the cheapest non-digital printing. */
    maxCardUsd: z.number().positive().optional(),
    colorBalanceTolerance: z.number().min(0).max(1).default(CUBE_DEFAULT_COLOR_TOLERANCE),
    curve: z.array(CurveBandSchema).default([]),
    archetypes: z.array(CubeArchetypeSchema).default([]),
    seats: z.int().min(1).max(16).default(CUBE_DEFAULT_SEATS),
    cardsPerSeat: z.int().min(1).max(90).default(CUBE_DEFAULT_CARDS_PER_SEAT),
  })
  .strict()
  .superRefine((criteria, ctx) => {
    for (const issue of bandIssues(criteria.curve)) {
      ctx.addIssue({ code: 'custom', path: ['curve'], message: issue });
    }
    const names = criteria.archetypes.map((archetype) => archetype.name);
    const repeated = names.filter((name, index) => names.indexOf(name) !== index);
    if (repeated.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['archetypes'],
        message: `archetype named twice: ${[...new Set(repeated)].join(', ')}`,
      });
    }
  });

export type CubeCriteria = z.infer<typeof CubeCriteriaSchema>;
export type CubeCriteriaInput = z.input<typeof CubeCriteriaSchema>;

/**
 * Bands may not overlap, and an open-ended band must be the last one.
 *
 * Overlapping bands are not a stricter constraint, they are an ambiguous one:
 * a card at mana value 2 counted by both a 1-2 band and a 2-3 band makes the
 * two bands' minima unsatisfiable together in ways nothing reports.
 */
function bandIssues(curve: readonly CurveBand[]): readonly string[] {
  const sorted = [...curve].sort((a, b) => a.from - b.from);
  const issues: string[] = [];
  for (const [index, band] of sorted.entries()) {
    const next = sorted[index + 1];
    if (next === undefined) continue;
    if (band.to === null) {
      issues.push(`the open-ended band from ${band.from} must be the last one`);
      continue;
    }
    if (next.from <= band.to) {
      issues.push(`bands ${bandLabel(band)} and ${bandLabel(next)} overlap`);
    }
  }
  return issues;
}

/** How a band is named in a finding: `MV 1-2`, or `MV 6+` when open-ended. */
export function bandLabel(band: CurveBand): string {
  if (band.to === null) return `MV ${band.from}+`;
  if (band.to === band.from) return `MV ${band.from}`;
  return `MV ${band.from}-${band.to}`;
}

/** Whether a mana value falls in a band. */
export function bandHolds(band: CurveBand, manaValue: number): boolean {
  return manaValue >= band.from && (band.to === null || manaValue <= band.to);
}

/**
 * Copies of one card the cube allows. Singleton means one; anything else is
 * held to the game's own four-copy rule rather than to a number this schema
 * invents.
 */
export function cubeCopyLimit(criteria: CubeCriteria): number {
  return criteria.singleton ? 1 : 4;
}

/** Cards an `seats`-player pod consumes at `cardsPerSeat` each. */
export function draftCapacity(criteria: CubeCriteria): number {
  return criteria.seats * criteria.cardsPerSeat;
}

/**
 * `boros aggro:WR:24, dimir control:UB:24:0.25` → two archetypes.
 *
 * A command line has only strings, and an archetype is three fields and an
 * optional fourth, so it needs a written form. It lives here rather than in the
 * CLI because it is the text projection of `CubeArchetypeSchema` and every rule
 * it enforces is that schema's; the CLI is the caller, not the owner. Malformed
 * input throws with the offending term rather than being dropped, because a
 * typo'd archetype that silently disappears becomes a cube built to criteria
 * nobody stated. A trailing colon with nothing after it is malformed rather than
 * an omitted field, since `Number('')` is 0 and a silent 0 would read as a
 * minimum availability the designer never asked for.
 */
export function parseArchetypeSpecs(spec: string): readonly CubeArchetype[] {
  return spec
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [name, colors, minPlayable, minAvailability, ...extra] = entry
        .split(':')
        .map((field) => field.trim());
      if (extra.length > 0 || minPlayable === undefined || minAvailability === '') {
        throw new Error(
          `archetype "${entry}" must read name:colors:minPlayable or name:colors:minPlayable:minAvailability, e.g. boros aggro:WR:24:0.25`,
        );
      }
      const parsed = CubeArchetypeSchema.safeParse({
        name,
        colors: [...(colors ?? '').toUpperCase()],
        minPlayable: Number(minPlayable),
        ...(minAvailability === undefined ? {} : { minAvailability: Number(minAvailability) }),
      });
      if (!parsed.success) {
        throw new Error(`archetype "${entry}": ${z.prettifyError(parsed.error)}`);
      }
      return parsed.data;
    });
}
