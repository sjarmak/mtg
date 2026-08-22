/**
 * The one explicit conversion from a reduced reference set to a set document a
 * play surface can open, and the record that keeps it from lying.
 *
 * # Why this is a separate named function
 *
 * `partial.ts` deliberately ships no converter to `ExecutableReferenceSet`,
 * because a reduced set that happens to have dropped nothing is still a reduced
 * set. This is not that converter and does not widen anything: it produces a
 * *third* document, `position-reduced-reference-set-document`, which no consumer
 * of a complete set accepts either. What it adds is a `cards` array and a `set`
 * block in the shape `packages/ui/tools/resolve-set.ts` reads, so `npm run play`
 * can open one.
 *
 * # A reduced M11 that looks like an M11 is a trap
 *
 * Measured on the committed six-ledger union, M11's 249 main-set collector
 * positions reduce to 123 kept and 126 refused; M13's reduce to 121 and 128.
 * Those numbers move every time a capability lands, which is the point, and they
 * are not pinned anywhere — `reduction.dropped` is computed from the artifact.
 * The half that is missing is not a random half: the rare-and-mythic sheet loses
 * most of its depth while the common sheet keeps most of its own, so a person
 * who opens this and finds no Llanowar Elves is looking at a set where that is
 * the ordinary case rather than a bug in the deal.
 *
 * So the document carries the whole drop record, not a count. Every refused
 * position keeps its collector number, its printed name, rarity and colors, the
 * machine-readable code that refused it and the prose of that refusal, and — when
 * the caller supplies them — the identity-level reason and the named vocabulary
 * gaps behind it. A person who cannot find a card can look it up and be told
 * whether it was refused, and by what.
 *
 * **Why the identity-level reason has to be passed in.** A position drops here
 * because its evidence row is absent, and "absent" is all this seam can see; the
 * refusal that made it absent (`NONEXACT_EVIDENCE`, the missing-vocabulary
 * taxonomy under it) is known one layer up, in `@mtg/dsl-coverage`'s
 * materializer, which depends on this package rather than the other way round.
 * Passing it down keeps that arrow pointing one way, and the parameter is
 * required rather than optional so a caller who has the reasons cannot omit them
 * by forgetting.
 *
 * # What the document drops
 *
 * The submitted coverage evidence and the normalized MTGJSON source set. Both
 * are kilobytes per card and neither is anything a play surface reads, and
 * neither is *lost*: `PartialExecutableReferenceSet` keeps both, and the emitter
 * writes that artifact whole beside this one.
 *
 * # Why the collation stopped being a summary (`mtg-nhyv.40`)
 *
 * It used to carry sheet depths, pack sizes and whether a pack still fills, and
 * to leave the sampler weights behind on the grounds that a uuid is a fact about
 * a printing this document no longer carries. That reason was sound and the
 * conclusion was too narrow: what a play surface needs is not the uuid, it is
 * *which card sits on which sheet at what weight*, and this document already
 * names every card it prints. So the weights are rekeyed onto those card ids and
 * the booster configurations come with them, and the whole reweighted collation
 * is here rather than a description of it.
 *
 * The cost of leaving it out was a lab that opened a reduced M11 and dealt nine
 * commons, three uncommons and a rare — `@mtg/deckbuild`'s rarity recipe, which
 * is what a set with no collation gets. M11 opens fifteen cards: a basic, ten
 * commons, three uncommons and a rare-or-mythic, or nine commons and a foil, one
 * configuration weighted 31 against the other's 9. None of that is derivable
 * from a card list, and every part of it is in the artifact this document is cut
 * from.
 *
 * **Rekeying is a bijection or it is a refusal.** A sheet deals physical cards
 * and this document prints one card per collector position, so a surviving sheet
 * that names a printing the document does not print, or two printings of one
 * position, is a collation this document cannot deal. Dropping such an entry
 * would deal a sheet with a hole in it and leave `cards` describing a depth that
 * is not there, so it throws and names the sheet instead.
 */
import { z } from 'zod';
import { CardSchema, validateCards, validateSetUniqueness, parseCard } from '@mtg/dsl';
import { InvalidInputError } from '../errors';
import {
  ReferenceCensusSchema,
  ReducedSlotFindingSchema,
  type PartialExecutableReferenceSet,
} from './partial';

const NonemptyString = z.string().min(1);

export const REDUCED_REFERENCE_SET_DOCUMENT_VERSION = 1 as const;

/**
 * Why the identity behind one collector position was refused, as the coverage
 * materializer knows it. `missing` is the named vocabulary the translation
 * lacked, one line per gap, and is empty when the refusal was not a vocabulary
 * gap at all (stale evidence, an unprobed translation, a conflicting row).
 */
export const ReducedPositionRefusalSchema = z.object({
  collectorNumber: z.number().int().positive(),
  code: NonemptyString,
  detail: NonemptyString,
  missing: z.array(NonemptyString),
});
export type ReducedPositionRefusal = z.infer<typeof ReducedPositionRefusalSchema>;

/** One refused position, printed identity first, so a reader can look a card up. */
export const ReducedDropRecordSchema = z.object({
  collectorNumber: z.number().int().positive(),
  name: NonemptyString,
  rarity: NonemptyString,
  colors: z.array(NonemptyString),
  /** The position-level refusal code from the reduced builder. */
  code: NonemptyString,
  reason: NonemptyString,
  /** The identity-level refusal, when the caller knew it. */
  refusal: ReducedPositionRefusalSchema.omit({ collectorNumber: true }).nullable(),
});
export type ReducedDropRecord = z.infer<typeof ReducedDropRecordSchema>;

/**
 * One reweighted sheet, keyed by the card ids this document prints.
 *
 * `cards` is the depth a reader compares against `sourceCards`, and it is also
 * the length of `weights`, which is a duplication on purpose: the two are read
 * by different consumers — the launcher prints the depths, a sampler draws from
 * the weights — and a document where they disagree would print one number and
 * deal another. The refinement is what makes them one fact.
 */
export const PlayableSheetSchema = z
  .object({
    name: NonemptyString,
    sourceCards: z.number().int().nonnegative(),
    cards: z.number().int().positive(),
    /** Card id to sampler weight. Relative odds are the printing's, unchanged. */
    weights: z.record(NonemptyString, z.number().int().positive()),
  })
  .refine((sheet) => Object.keys(sheet.weights).length === sheet.cards, {
    message: 'a sheet must weight exactly as many cards as its depth claims',
  });
export type PlayableSheet = z.infer<typeof PlayableSheetSchema>;

/** One booster configuration that still fills: sheet to count, and its odds. */
export const PlayableBoosterSchema = z.object({
  contents: z.record(NonemptyString, z.number().int().positive()),
  weight: z.number().int().positive(),
  packSize: z.number().int().positive(),
});
export type PlayableBooster = z.infer<typeof PlayableBoosterSchema>;

export const PlayableCollationSchema = z.object({
  fillsAPack: z.boolean(),
  sheets: z.array(PlayableSheetSchema),
  emptiedSheets: z.array(NonemptyString),
  /**
   * Every configuration that still fills, whole. A list of pack sizes stood
   * here and was the half a reader could check and a surface could not use.
   */
  boosters: z.array(PlayableBoosterSchema),
  unfillableBoosters: z.number().int().nonnegative(),
  /**
   * Slots that fill and no longer deal what they dealt, carried whole from the
   * artifact rather than summarized. `fillsAPack` above is the yes-or-no a
   * surface can act on; these are the sentences it should print beside it, and
   * a count would lose the only part a reader can do anything with.
   */
  slotFindings: z.array(ReducedSlotFindingSchema),
});
export type PlayableCollation = z.infer<typeof PlayableCollationSchema>;

export const ReducedReferenceSetDocumentSchema = z.object({
  formatVersion: z.literal(REDUCED_REFERENCE_SET_DOCUMENT_VERSION),
  /** The discriminant, carried on the document as well as on the artifact. */
  kind: z.literal('position-reduced-reference-set-document'),
  set: z.object({
    code: NonemptyString,
    /** Says "reduced" in the name, because the name is what a surface prints. */
    name: NonemptyString,
    reduced: z.literal(true),
  }),
  reduction: z.object({
    source: z.object({
      code: NonemptyString,
      name: NonemptyString,
      releaseDate: NonemptyString,
      sourceSha256: NonemptyString,
      mainSetPositions: z.number().int().positive(),
    }),
    kept: z.number().int().positive(),
    dropped: z.number().int().nonnegative(),
    census: z.object({ kept: ReferenceCensusSchema, dropped: ReferenceCensusSchema }),
    collation: PlayableCollationSchema,
    /** Every refused position, in collector order. Never a count on its own. */
    drops: z.array(ReducedDropRecordSchema),
  }),
  cards: z.array(CardSchema).min(1),
});
export type ReducedReferenceSetDocument = z.infer<typeof ReducedReferenceSetDocumentSchema>;

/**
 * The card id this document prints for each printing uuid the source set names.
 *
 * The join runs through the collector position, which is the one identity both
 * halves carry: the source face knows its printed number, and `exactCard` gives
 * the card it built the id `<code>-<number>`. Joining on the uuid directly is
 * not available — a DSL card has no uuid, deliberately, because a uuid is a fact
 * about a printing and this document is not a printing.
 *
 * A position the reduction dropped has no entry here, which is exactly right:
 * its uuid was already removed from every sheet upstream.
 */
function cardIdsByUuid(reduced: PartialExecutableReferenceSet): ReadonlyMap<string, string> {
  const idsByPosition = new Map(reduced.cards.map((card) => [card.set.collectorNumber, card.id] as const));
  const ids = new Map<string, string>();
  for (const face of reduced.sourceSet.cards) {
    const number = Number(face.number);
    if (!Number.isSafeInteger(number)) continue;
    const id = idsByPosition.get(number);
    if (id !== undefined) ids.set(face.uuid, id);
  }
  return ids;
}

/**
 * The reweighted collation with its sheets rekeyed onto this document's card
 * ids, so a play surface can deal from it without holding the source set.
 *
 * Every refusal here is about the two halves not agreeing rather than about a
 * card, which is `partial.ts`'s own line between a drop and a throw: a drop is a
 * position this translation cannot reach, and none of these are that.
 */
function playableCollation(reduced: PartialExecutableReferenceSet): PlayableCollation {
  const ids = cardIdsByUuid(reduced);
  const code = reduced.sourceSet.code;
  const sheets = reduced.collation.sheets.map((sheet) => {
    const weights: Record<string, number> = {};
    for (const [uuid, weight] of Object.entries(sheet.weights)) {
      const id = ids.get(uuid);
      if (id === undefined) {
        throw new InvalidInputError(
          'reduced reference set',
          `${code} sheet ${sheet.name} deals printing ${uuid}, which this document does not print`,
        );
      }
      if (weights[id] !== undefined) {
        throw new InvalidInputError(
          'reduced reference set',
          `${code} sheet ${sheet.name} deals two printings of ${id}, so its depth cannot be dealt`,
        );
      }
      weights[id] = weight;
    }
    return { name: sheet.name, sourceCards: sheet.sourceCards, cards: sheet.cards, weights };
  });
  const named = new Set(sheets.map((sheet) => sheet.name));
  const boosters = reduced.collation.boosters.map((booster) => {
    for (const name of Object.keys(booster.contents)) {
      if (!named.has(name)) {
        throw new InvalidInputError(
          'reduced reference set',
          `${code} has a filling booster whose ${name} slot names a sheet the reduction emptied`,
        );
      }
    }
    return { contents: { ...booster.contents }, weight: booster.weight, packSize: booster.packSize };
  });
  return {
    fillsAPack: reduced.collation.fillsAPack,
    sheets,
    emptiedSheets: [...reduced.collation.emptiedSheets],
    boosters,
    unfillableBoosters: reduced.collation.unfillableBoosters.length,
    slotFindings: [...reduced.collation.slotFindings],
  };
}

/**
 * Converts a reduced reference set into a playable set document, sweeping every
 * card through the DSL's own validator first.
 *
 * `CardSchema.safeParse` is not this check. It says the record has the right
 * shape; `validateCard` says the card is legal — that its effects name targets
 * that exist, that its abilities are reachable, that its cost and colors agree.
 * A document written past a violation is a blank page in a browser with a
 * console error, so the sweep happens here rather than in whichever script
 * happens to be writing the file.
 *
 * @param reduced The artifact `buildPartialExecutableReferenceSet` produced.
 * @param refusals Identity-level reasons keyed by collector position. Pass the
 *   empty array only when there genuinely are none to pass; a drop with no
 *   refusal records `refusal: null` and says only that the position had no row.
 */
export function reducedReferenceSetDocument(
  reduced: PartialExecutableReferenceSet,
  refusals: readonly ReducedPositionRefusal[],
): ReducedReferenceSetDocument {
  // Before the validator, because "no cards" is not a validation failure and
  // the schema would refuse it as a shape error about `cards.min(1)`, which
  // says nothing about what happened. A reduction that kept nothing is a real
  // outcome of a real artifact; it is just not a set anybody can open.
  if (reduced.cards.length === 0) {
    throw new InvalidInputError(
      'reduced reference set',
      `${reduced.sourceSet.code} kept no collector position: all ` +
        `${String(reduced.dropped.length)} were refused, and a document of no cards is not a set`,
    );
  }
  const violations = validateCards(reduced.cards);
  if (violations.length > 0) {
    throw new InvalidInputError(
      'reduced reference set',
      `${reduced.sourceSet.code} holds ${String(violations.length)} invalid card(s): ` +
        violations
          .slice(0, 5)
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join('; '),
    );
  }
  const parsed = reduced.cards.map((card) => parseCard(card));
  const uniqueness = validateSetUniqueness(parsed);
  if (uniqueness.length > 0) {
    throw new InvalidInputError(
      'reduced reference set',
      `${reduced.sourceSet.code} is not a legal card list: ` +
        uniqueness.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
    );
  }

  const byPosition = new Map(refusals.map((refusal) => [refusal.collectorNumber, refusal]));
  const unknown = refusals.find(
    (refusal) => !reduced.dropped.some((drop) => drop.collectorNumber === refusal.collectorNumber),
  );
  if (unknown !== undefined) {
    throw new InvalidInputError(
      'reduced reference set',
      `${reduced.sourceSet.code} was given a refusal for collector position ` +
        `${String(unknown.collectorNumber)}, which is not a dropped position`,
    );
  }

  const document = {
    formatVersion: REDUCED_REFERENCE_SET_DOCUMENT_VERSION,
    kind: 'position-reduced-reference-set-document',
    set: {
      code: reduced.sourceSet.code,
      name: `${reduced.sourceSet.name} (reduced)`,
      reduced: true,
    },
    reduction: {
      source: {
        code: reduced.sourceSet.code,
        name: reduced.sourceSet.name,
        releaseDate: reduced.sourceSet.releaseDate,
        sourceSha256: reduced.sourceSet.sourceSha256,
        mainSetPositions: reduced.sourceSet.mainSetSize,
      },
      kept: reduced.cards.length,
      dropped: reduced.dropped.length,
      census: reduced.census,
      collation: playableCollation(reduced),
      drops: [...reduced.dropped]
        .sort((left, right) => left.collectorNumber - right.collectorNumber)
        .map((drop) => {
          const refusal = byPosition.get(drop.collectorNumber);
          return {
            collectorNumber: drop.collectorNumber,
            name: drop.name,
            rarity: drop.rarity,
            colors: [...drop.colors],
            code: drop.code,
            reason: drop.reason,
            refusal:
              refusal === undefined
                ? null
                : { code: refusal.code, detail: refusal.detail, missing: [...refusal.missing] },
          };
        }),
    },
    cards: reduced.cards,
  } satisfies ReducedReferenceSetDocument;
  return ReducedReferenceSetDocumentSchema.parse(document);
}
