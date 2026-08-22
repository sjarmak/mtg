/**
 * The reduced reference set: every position the strict builder can prove, and a
 * named receipt for every position it cannot.
 *
 * # Why this exists
 *
 * `buildExecutableReferenceSet` walks collector positions 1..mainSetSize and
 * throws on the first one without an exact, kernel-reached row. Measured on the
 * committed six-ledger union, M11 holds 249 main-set collector positions and 120
 * of them are exact. Its 129 refused identities name 89 distinct residual blocker
 * families, 70 of those families block exactly one identity, and 85 of the 129
 * identities are held up by a single blocker apiece. Under the all-or-nothing
 * gate, 248 of 249 is worth exactly what zero is worth, and the road to 249 runs
 * through seventy separate capabilities that each buy one card.
 *
 * So there is a second artifact. It is not a looser standard: it calls the same
 * `exactCard` on every position it keeps, so a kept card is a card the strict
 * builder would have kept, byte for byte. What it adds is the willingness to
 * drop the rest and say so.
 *
 * # Why it is a type and not a flag
 *
 * `@mtg/engine`'s `determinism.ts` argues this at length for recorded versus
 * observed backends and the argument transfers whole: a boolean on one artifact
 * is a thing a caller can forget to read, and a caller who forgets this one
 * calls a set playable that is missing half its rares. So completeness is the
 * `kind` discriminant. `PartialExecutableReferenceSet` is a different type from
 * `ExecutableReferenceSet`, a function that requires a complete set says
 * `ExecutableReferenceSet` in its signature, and a reduced set handed to it
 * fails to typecheck rather than failing a run-time check somewhere downstream.
 *
 * There is deliberately no converter. A reduced set that happens to have dropped
 * nothing is still a reduced set; the way to hold a complete one is to call the
 * strict builder and have it succeed.
 *
 * # What a drop is, and what it is not
 *
 * A position is dropped only when its evidence row is refused — absent,
 * non-exact, approximated, unprobed, stale against the source, or invalid after
 * identity binding — and the `ExecutableReferenceError` that refused it is
 * recorded verbatim as the reason. Nothing is approximated, simplified,
 * substituted or renamed. mtg-ts5j.3's acceptance is "do not call a set playable
 * when unsupported cards were silently removed or simplified", and the word
 * doing the work there is *silently*: `dropped` is the artifact's answer.
 *
 * Failures that are about the inputs rather than about a card still throw.
 * A corpus that does not parse, evidence for another set, a duplicated row, a
 * source set missing a collector position: none of those are a card this
 * translation cannot reach, and a reduced artifact built over inputs that do not
 * belong together would be reduced from nothing in particular.
 *
 * # What reweighting does to the rarity mix
 *
 * The source set's collation is MTGJSON's: named sheets of `uuid -> weight` with
 * a `totalWeight`, and boosters that draw a fixed count of distinct cards from
 * each named sheet. Reweighting removes the dropped positions' uuids from every
 * sheet and re-sums `totalWeight` over what is left. The relative odds of any two
 * surviving cards on a sheet are therefore unchanged, and a sampler that draws
 * `weight / totalWeight` draws a real distribution rather than rolling holes.
 *
 * **The mix inside a pack does not move at all.** The recipe is a count per
 * sheet — M11 opens 1 basic, 10 commons, 3 uncommons and 1 rare-or-mythic, or
 * swaps a common for a foil — and those counts are in the booster, not in the
 * pool. What moves is *depth per slot*, and it moves unevenly, because
 * translation coverage is not uniform across rarities. Measured on M11's reduced
 * list: the common sheet falls 101 -> 60, uncommon 60 -> 28, rare-and-mythic
 * 68 -> 12, basics 20 -> 20 untouched. The rare slot is the one that changes
 * character: an eight-seat draft opens 24 packs and would draw its 24 rares from
 * twelve distinct cards, so a rare repeats roughly five times more often than it
 * did. A reader who wants that stated per color has `census`, which is where a
 * set that lost most of one color becomes visible.
 *
 * **A reduced M11 still fills a 15-card pack**, and `collation.fillsAPack` is
 * that question asked rather than assumed: every slot needs fewer distinct cards
 * than its reduced sheet holds (10 <= 60, 3 <= 28, 1 <= 12, 1 <= 20). A booster
 * configuration whose slot outruns its sheet is dropped from `boosters` and named
 * in `unfillableBoosters`, and the weights of the configurations that remain are
 * what `boostersTotalWeight` sums; if none remain, `fillsAPack` is false and the
 * reduced set is a card list rather than a draftable one.
 *
 * Sheets keyed by *DSL* rarity — what `@mtg/draft-export` builds — need no
 * reweighting here, because it derives them from a card list and `cards` is
 * already the reduced list.
 */
import { COLORS, RARITIES, CardSchema, type Card } from '@mtg/dsl';
import { z } from 'zod';
import {
  ExecutableCoverageEvidenceSchema,
  ExecutableCoverageOutcomeSchema,
  ExecutableReferenceError,
  assertCorpusIdentity,
  exactCard,
  mainSetPositions,
  parseCorpus,
  parseEvidence,
  rowsByPosition,
} from './executable';
import { ReferenceSetSchema, type ReferenceCard, type ReferenceSet } from './schemas';

const NonemptyString = z.string().min(1);

export const PARTIAL_EXECUTABLE_REFERENCE_SCHEMA_VERSION = 1 as const;

/** The `ExecutableReferenceError` that refused one position, on the wire. */
export const DroppedPositionSchema = z.object({
  collectorNumber: z.number().int().positive(),
  name: NonemptyString,
  rarity: NonemptyString,
  colors: z.array(NonemptyString),
  /** The refusal code, so a reader can group drops without parsing prose. */
  code: NonemptyString,
  outcome: ExecutableCoverageOutcomeSchema.nullable(),
  reason: NonemptyString,
});
export type DroppedPosition = z.infer<typeof DroppedPositionSchema>;

/**
 * One collation sheet with the dropped positions removed and `totalWeight`
 * re-summed over what is left. `weights` is the sampler's input; `cards` and
 * `sourceCards` are how much of the sheet survived.
 */
export const ReducedSheetSchema = z.object({
  name: NonemptyString,
  foil: z.boolean(),
  sourceCards: z.number().int().nonnegative(),
  cards: z.number().int().nonnegative(),
  sourceTotalWeight: z.number().int().positive(),
  totalWeight: z.number().int().nonnegative(),
  weights: z.record(NonemptyString, z.number().int().positive()),
});
export type ReducedSheet = z.infer<typeof ReducedSheetSchema>;

/** A slot asking for more distinct cards than its reduced sheet can supply. */
export const ReducedShortSlotSchema = z.object({
  sheet: NonemptyString,
  need: z.number().int().positive(),
  have: z.number().int().nonnegative(),
});
export type ReducedShortSlot = z.infer<typeof ReducedShortSlotSchema>;

export const ReducedBoosterSchema = z.object({
  contents: z.record(NonemptyString, z.number().int().positive()),
  weight: z.number().int().positive(),
  /** Cards in one pack of this configuration, summed over its slots. */
  packSize: z.number().int().positive(),
});
export type ReducedBooster = z.infer<typeof ReducedBoosterSchema>;

export const UnfillableBoosterSchema = ReducedBoosterSchema.extend({
  shortSlots: z.array(ReducedShortSlotSchema).min(1),
});
export type UnfillableBooster = z.infer<typeof UnfillableBoosterSchema>;

/**
 * A slot that still fills but no longer deals what it dealt.
 *
 * `fillsAPack` is a yes-or-no about arithmetic — does the slot want more
 * distinct cards than its sheet holds — and `mtg-nhyv.24` is the observation
 * that it is the only automated verdict a reduced set gets, while being nearly
 * impossible to fail. A rare slot draws one card, so it fills from a sheet of
 * one. Both reduced M11 and reduced M13 pass it with rare sheets of fourteen and
 * thirteen against sixty-eight, two colors of M11 holding no rare at all and no
 * mythic surviving M13 at any color. That is a different format, and nothing
 * said so.
 *
 * These are the two ways a filling slot changes character, and both are stated
 * as comparisons against the source rather than as scores.
 */
export const ReducedSlotConcentrationSchema = z.object({
  kind: z.literal('concentrated'),
  sheet: NonemptyString,
  /** Cards this slot deals per pack, the most any filling configuration asks. */
  need: z.number().int().positive(),
  sourceCards: z.number().int().positive(),
  cards: z.number().int().positive(),
  sourceTotalWeight: z.number().int().positive(),
  totalWeight: z.number().int().positive(),
  /**
   * `sourceTotalWeight / totalWeight`: how much more often a card off this slot
   * repeats. It is a ratio of weights and not of distinct cards, because a
   * sampler draws a card at `weight / totalWeight` and the two ratios agree only
   * when the sheet is uniform. Every real foil sheet is skewed -- M11's runs
   * 29,040 weight over 249 cards -- so counting cards misreported both reference
   * sets in both directions: M11's rare slot repeats 5.04 times as often and
   * card counts said 4.86, M13's repeats 4.65 and card counts said 5.23. A
   * sheet retaining weights [100, 1] out of [100, 1, 1, 1] is the shape that
   * makes it a verdict rather than a rounding difference: two cards of four
   * survive, so counting says the slot doubled, while the card a drafter
   * actually opens got 1.02 times as likely.
   */
  concentration: z.number().positive(),
  detail: NonemptyString,
});
export type ReducedSlotConcentration = z.infer<typeof ReducedSlotConcentrationSchema>;

export const ReducedSlotColorLossSchema = z.object({
  kind: z.literal('colorAbsent'),
  sheet: NonemptyString,
  need: z.number().int().positive(),
  /** Printed colors the source sheet dealt and the reduced sheet cannot. */
  colors: z.array(NonemptyString).min(1),
  /** What each of those colors held on the source sheet. */
  sourceCounts: z.record(NonemptyString, z.number().int().positive()),
  detail: NonemptyString,
});
export type ReducedSlotColorLoss = z.infer<typeof ReducedSlotColorLossSchema>;

export const ReducedSlotFindingSchema = z.discriminatedUnion('kind', [
  ReducedSlotConcentrationSchema,
  ReducedSlotColorLossSchema,
]);
export type ReducedSlotFinding = z.infer<typeof ReducedSlotFindingSchema>;

/**
 * Doubling is where a repeat rate stops being a rounding error, so
 * `concentration >= 2` is what `concentrated` fires on. It is a stated policy
 * choice rather than a measured one, and the ten slots of the two reference sets
 * are what it was chosen against: M11 rare fires at 5.04, M13 rare at 4.65, M13
 * uncommon at 2.40, and the seven that do not fire sit between 1.00 and 1.69.
 * The gap the boundary sits in is 1.69 to 2.40. The number is a place to put the
 * line, not a discovery, and a third reference set is what would move it.
 *
 * The comparison is against the exact ratio and the rounding happens after, so a
 * slot at 1.995 is not reported as a slot that doubled. Rounding first put the
 * policy boundary at 1.995 rather than at 2, which is a threshold nobody stated.
 */
export const SLOT_CONCENTRATION_THRESHOLD = 2;

export const ReducedCollationSchema = z.object({
  sheets: z.array(ReducedSheetSchema),
  /** Sheets every one of whose cards was dropped; no booster may name one. */
  emptiedSheets: z.array(NonemptyString),
  boosters: z.array(ReducedBoosterSchema),
  boostersTotalWeight: z.number().int().nonnegative(),
  unfillableBoosters: z.array(UnfillableBoosterSchema),
  /** Whether any booster configuration can still be opened from the pool. */
  fillsAPack: z.boolean(),
  /**
   * Slots that fill and have still changed character. Empty is the claim that
   * every slot deals what it dealt, not the claim that nobody looked.
   */
  slotFindings: z.array(ReducedSlotFindingSchema),
});
export type ReducedCollation = z.infer<typeof ReducedCollationSchema>;

/**
 * Collector positions counted by printed rarity and printed color, so the two
 * halves of the split are comparable. A position counts once under each color it
 * prints, and under `colorless` when it prints none, so `byColor` sums to at
 * least `positions`.
 */
export const ReferenceCensusSchema = z.object({
  positions: z.number().int().nonnegative(),
  byRarity: z.array(z.object({ rarity: NonemptyString, positions: z.number().int().positive() })),
  byColor: z.array(z.object({ color: NonemptyString, positions: z.number().int().positive() })),
});
export type ReferenceCensus = z.infer<typeof ReferenceCensusSchema>;

export const PartialExecutableReferenceSetSchema = z.object({
  schemaVersion: z.literal(PARTIAL_EXECUTABLE_REFERENCE_SCHEMA_VERSION),
  /** The discriminant. Nothing that requires a complete set accepts this. */
  kind: z.literal('position-reduced-reference-set'),
  /** The whole submitted evidence, kept: the drops explain it, not replace it. */
  coverage: ExecutableCoverageEvidenceSchema,
  sourceSet: ReferenceSetSchema,
  cards: z.array(CardSchema),
  dropped: z.array(DroppedPositionSchema),
  census: z.object({ kept: ReferenceCensusSchema, dropped: ReferenceCensusSchema }),
  collation: ReducedCollationSchema,
});
export type PartialExecutableReferenceSet = z.infer<typeof PartialExecutableReferenceSetSchema>;

function isColor(value: string): value is (typeof COLORS)[number] {
  return (COLORS as readonly string[]).includes(value);
}

/** Printed colors in WUBRG order, with anything unrecognized kept and named. */
function positionColors(faces: readonly ReferenceCard[]): readonly string[] {
  const colors = new Set(faces.flatMap((face) => face.colors));
  return [
    ...COLORS.filter((color) => colors.has(color)),
    ...[...colors].filter((color) => !isColor(color)).sort(),
  ];
}

function positionRarity(faces: readonly ReferenceCard[]): string {
  const first = faces[0];
  if (first === undefined) throw new Error('nonempty face invariant failed');
  return first.rarity;
}

function positionName(faces: readonly ReferenceCard[]): string {
  const first = faces[0];
  if (first === undefined) throw new Error('nonempty face invariant failed');
  return first.name;
}

function census(faces: readonly (readonly ReferenceCard[])[]): ReferenceCensus {
  const rarities = new Map<string, number>();
  const colors = new Map<string, number>();
  for (const position of faces) {
    const rarity = positionRarity(position);
    rarities.set(rarity, (rarities.get(rarity) ?? 0) + 1);
    const printed = positionColors(position);
    for (const color of printed.length === 0 ? ['colorless'] : printed) {
      colors.set(color, (colors.get(color) ?? 0) + 1);
    }
  }
  const rankIn = (order: readonly string[], value: string): number => {
    const index = order.indexOf(value);
    return index === -1 ? order.length : index;
  };
  return {
    positions: faces.length,
    byRarity: [...rarities.entries()]
      .map(([rarity, positions]) => ({ rarity, positions }))
      .sort(
        (left, right) =>
          rankIn(RARITIES, left.rarity) - rankIn(RARITIES, right.rarity) ||
          left.rarity.localeCompare(right.rarity),
      ),
    byColor: [...colors.entries()]
      .map(([color, positions]) => ({ color, positions }))
      .sort(
        (left, right) =>
          rankIn(COLORS, left.color) - rankIn(COLORS, right.color) || left.color.localeCompare(right.color),
      ),
  };
}

/**
 * The findings a filling slot can still carry, per sheet a filling booster deals
 * from. A sheet nothing deals is not a draft problem, so `needBySheet` is the
 * whole population: it holds the most any surviving configuration asks of each
 * sheet, because a slot that appears twice at different counts is at its worst
 * where it asks for most.
 */
function slotFindings(
  set: ReferenceSet,
  sheets: readonly ReducedSheet[],
  needBySheet: ReadonlyMap<string, number>,
): ReducedSlotFinding[] {
  const colorsByUuid = new Map(set.cards.map((card) => [card.uuid, card.colors] as const));
  const findings: ReducedSlotFinding[] = [];
  for (const sheet of sheets) {
    const need = needBySheet.get(sheet.name);
    if (need === undefined) continue;
    // An emptied sheet is removed before this runs, so a zero divisor is a
    // caller that stopped doing that rather than a sheet to report on.
    if (sheet.totalWeight === 0) {
      throw new Error(`reduced sheet ${sheet.name} has no weight left, so no booster may still deal it`);
    }
    const repeatRate = sheet.sourceTotalWeight / sheet.totalWeight;
    if (repeatRate >= SLOT_CONCENTRATION_THRESHOLD) {
      const concentration = Number(repeatRate.toFixed(2));
      findings.push({
        kind: 'concentrated',
        sheet: sheet.name,
        need,
        sourceCards: sheet.sourceCards,
        cards: sheet.cards,
        sourceTotalWeight: sheet.sourceTotalWeight,
        totalWeight: sheet.totalWeight,
        concentration,
        detail:
          `the ${sheet.name} sheet fell from ${sheet.sourceCards} distinct cards to ${sheet.cards} and ` +
          `from ${sheet.sourceTotalWeight} weight to ${sheet.totalWeight}, so a card off this slot ` +
          `repeats ${concentration} times as often as it did; the slot deals ${need} per pack and still ` +
          `fills`,
      });
    }
    const sourceSheet = set.draftBooster.sheets[sheet.name];
    if (sourceSheet === undefined) continue;
    const sourceCounts: Record<string, number> = {};
    for (const uuid of Object.keys(sourceSheet.cards)) {
      for (const color of colorsByUuid.get(uuid) ?? []) {
        if (!isColor(color)) continue;
        sourceCounts[color] = (sourceCounts[color] ?? 0) + 1;
      }
    }
    const kept = new Set<string>();
    for (const uuid of Object.keys(sheet.weights)) {
      for (const color of colorsByUuid.get(uuid) ?? []) kept.add(color);
    }
    const lost = COLORS.filter((color) => sourceCounts[color] !== undefined && !kept.has(color));
    if (lost.length > 0) {
      findings.push({
        kind: 'colorAbsent',
        sheet: sheet.name,
        need,
        colors: [...lost],
        sourceCounts: Object.fromEntries(lost.map((color) => [color, sourceCounts[color] ?? 0])),
        detail:
          `the ${sheet.name} sheet deals no ${lost.join(', ')} card at all, against ` +
          `${lost.map((color) => `${String(sourceCounts[color])} ${color}`).join(', ')} on the source sheet; ` +
          `a drafter in ${lost.length === 1 ? 'that color' : 'those colors'} can never open one`,
      });
    }
  }
  return findings;
}

function reduceCollation(set: ReferenceSet, droppedUuids: ReadonlySet<string>): ReducedCollation {
  const sheets: ReducedSheet[] = [];
  const emptiedSheets: string[] = [];
  const remaining = new Map<string, number>();
  for (const [name, sheet] of Object.entries(set.draftBooster.sheets)) {
    const weights: Record<string, number> = {};
    let totalWeight = 0;
    for (const [uuid, weight] of Object.entries(sheet.cards)) {
      if (droppedUuids.has(uuid)) continue;
      weights[uuid] = weight;
      totalWeight += weight;
    }
    const cards = Object.keys(weights).length;
    remaining.set(name, cards);
    if (cards === 0) {
      emptiedSheets.push(name);
      continue;
    }
    sheets.push({
      name,
      foil: sheet.foil,
      sourceCards: Object.keys(sheet.cards).length,
      cards,
      sourceTotalWeight: sheet.totalWeight,
      totalWeight,
      weights,
    });
  }
  sheets.sort((left, right) => left.name.localeCompare(right.name));
  emptiedSheets.sort((left, right) => left.localeCompare(right));

  const boosters: ReducedBooster[] = [];
  const unfillableBoosters: UnfillableBooster[] = [];
  for (const booster of set.draftBooster.boosters) {
    const contents: Record<string, number> = {};
    let packSize = 0;
    const shortSlots: ReducedShortSlot[] = [];
    for (const [sheetName, count] of Object.entries(booster.contents)) {
      contents[sheetName] = count;
      packSize += count;
      const have = remaining.get(sheetName) ?? 0;
      if (have < count) shortSlots.push({ sheet: sheetName, need: count, have });
    }
    if (packSize === 0) continue;
    const reduced: ReducedBooster = { contents, weight: booster.weight, packSize };
    if (shortSlots.length === 0) boosters.push(reduced);
    else unfillableBoosters.push({ ...reduced, shortSlots });
  }
  const needBySheet = new Map<string, number>();
  for (const booster of boosters) {
    for (const [sheetName, count] of Object.entries(booster.contents)) {
      needBySheet.set(sheetName, Math.max(needBySheet.get(sheetName) ?? 0, count));
    }
  }
  return {
    sheets,
    emptiedSheets,
    boosters,
    boostersTotalWeight: boosters.reduce((total, booster) => total + booster.weight, 0),
    unfillableBoosters,
    fillsAPack: boosters.length > 0,
    slotFindings: slotFindings(set, sheets, needBySheet),
  };
}

/**
 * Builds the reduced main-set artifact: every position the strict builder proves,
 * a named drop for every position it refuses, collation reweighted over what is
 * left, and a printed census of both halves.
 *
 * Throws for the same input-level failures the strict builder throws for — an
 * unparsable corpus, evidence naming another set or another corpus version, a
 * duplicated row, a source set missing one of its own collector positions. Those
 * say the inputs do not belong together, which no amount of dropping repairs.
 */
export function buildPartialExecutableReferenceSet(
  corpusInput: unknown,
  evidenceInput: unknown,
): PartialExecutableReferenceSet {
  const corpus = parseCorpus(corpusInput);
  const evidence = parseEvidence(evidenceInput);
  const set = assertCorpusIdentity(corpus, evidence);
  const positions = mainSetPositions(set);
  const rows = rowsByPosition(set, evidence);

  const cards: Card[] = [];
  const dropped: DroppedPosition[] = [];
  const keptFaces: (readonly ReferenceCard[])[] = [];
  const droppedFaces: (readonly ReferenceCard[])[] = [];
  const droppedUuids = new Set<string>();

  for (let number = 1; number <= set.mainSetSize; number += 1) {
    const faces = positions.get(number);
    if (faces === undefined) throw new Error('complete membership invariant failed');
    const row = rows.get(number);
    const refuse = (error: ExecutableReferenceError): void => {
      dropped.push({
        collectorNumber: number,
        name: positionName(faces),
        rarity: positionRarity(faces),
        colors: [...positionColors(faces)],
        code: error.code,
        outcome: error.outcome ?? null,
        reason: error.message,
      });
      droppedFaces.push(faces);
      for (const face of faces) droppedUuids.add(face.uuid);
    };
    if (row === undefined) {
      refuse(
        new ExecutableReferenceError(
          'MISSING_POSITION',
          `${set.code} collector position ${String(number)} has no coverage row`,
          { collectorNumber: number },
        ),
      );
      continue;
    }
    try {
      cards.push(exactCard(set, faces, row));
      keptFaces.push(faces);
    } catch (error) {
      // Only a named per-position refusal is a drop. An invariant failure is a
      // bug in this seam and must not be laundered into a missing card.
      if (!(error instanceof ExecutableReferenceError)) throw error;
      refuse(error);
    }
  }

  const unexpected = [...rows.keys()].find((number) => !positions.has(number));
  if (unexpected !== undefined) {
    throw new ExecutableReferenceError(
      'STALE_POSITION',
      `${set.code} evidence includes unexpected collector position ${String(unexpected)}`,
      { collectorNumber: unexpected },
    );
  }

  return PartialExecutableReferenceSetSchema.parse({
    schemaVersion: PARTIAL_EXECUTABLE_REFERENCE_SCHEMA_VERSION,
    kind: 'position-reduced-reference-set',
    coverage: evidence,
    sourceSet: set,
    cards,
    dropped,
    census: { kept: census(keptFaces), dropped: census(droppedFaces) },
    collation: reduceCollation(set, droppedUuids),
  } satisfies PartialExecutableReferenceSet);
}
