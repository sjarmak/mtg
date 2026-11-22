/**
 * A printed format with no packs: a list of fixed decks over exact catalogs.
 *
 * The Limited format states products and how many of each a seat opens; this
 * one states decks and what each is made of, resolved to catalog printings, so
 * a Commander precon is a format the same tools stage, hash, and admit. The
 * rules block is the table's rules in the engine contract's vocabulary
 * (`MatchRules`), written out rather than imported because this package
 * depends on nothing.
 */
import { z } from 'zod';

const Name = z.string().trim().min(1);
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const Count = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const Slot = z.strictObject({
  /** A catalog printing: `<catalogFormat>:<position>:<scryfallId>`. */
  physicalId: Name,
  /** The name Forge's card database answers to, the catalog's `correctedName`. */
  name: Name,
  count: Count,
});

export const PrintedFormatRulesSchema = z.strictObject({
  variant: z.enum(['standard', 'commander', 'momir']),
  startingLife: Count,
});

export const PrintedConstructedFormatSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal('printed-constructed-format'),
    id: Name,
    name: Name,
    sources: z
      .array(
        z.strictObject({
          code: Name,
          catalogFormat: Name,
          catalogSha256: Sha256,
          mtgjson: z.strictObject({ url: z.url(), sha256: Sha256, version: Name }),
        }),
      )
      .min(1),
    rules: PrintedFormatRulesSchema,
    decks: z
      .array(
        z.strictObject({
          id: Name,
          name: Name,
          /** The cards that begin in the command zone, one slot each at count one. */
          commanders: z.array(Slot),
          cards: z.array(Slot).min(1),
        }),
      )
      .min(1),
    contentSha256: Sha256,
  })
  .superRefine((format, context) => {
    const issue = (message: string): void => context.addIssue({ code: 'custom', message });
    if (new Set(format.sources.map((source) => source.code)).size !== format.sources.length) {
      issue('duplicate source set code');
    }
    const catalogFormats = new Set(format.sources.map((source) => source.catalogFormat));
    if (catalogFormats.size !== format.sources.length) issue('duplicate source catalog identity');
    if (new Set(format.decks.map((deck) => deck.id)).size !== format.decks.length) issue('duplicate deck id');
    for (const deck of format.decks) {
      const slots = [...deck.commanders, ...deck.cards];
      if (new Set(slots.map((slot) => slot.physicalId)).size !== slots.length) {
        issue(`deck ${deck.id} lists a printing twice`);
      }
      for (const slot of slots) {
        const catalogFormat = slot.physicalId.split(':')[0] ?? '';
        if (!catalogFormats.has(catalogFormat)) {
          issue(`deck ${deck.id} names ${slot.name} from an unlisted catalog ${catalogFormat}`);
        }
      }
      if (format.rules.variant === 'commander' && deck.commanders.length === 0) {
        issue(`deck ${deck.id} names no commander on a commander table`);
      }
      if (format.rules.variant !== 'commander' && deck.commanders.length > 0) {
        issue(`deck ${deck.id} names a commander on a ${format.rules.variant} table`);
      }
      if (format.rules.variant === 'momir') {
        const counts = new Map(deck.cards.map((slot) => [slot.name, slot.count]));
        const basics = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
        if (deck.cards.length !== basics.length || basics.some((name) => counts.get(name) !== 12)) {
          issue(`deck ${deck.id} is not 12 each of Plains, Island, Swamp, Mountain, and Forest`);
        }
      }
      for (const commander of deck.commanders) {
        if (commander.count !== 1)
          issue(`deck ${deck.id} names ${commander.name} as a commander more than once`);
      }
    }
  });

export type PrintedConstructedFormat = z.infer<typeof PrintedConstructedFormatSchema>;
export type PrintedConstructedDeck = PrintedConstructedFormat['decks'][number];
export type PrintedFormatRules = z.infer<typeof PrintedFormatRulesSchema>;

export function parsePrintedConstructedFormat(value: unknown): PrintedConstructedFormat {
  return PrintedConstructedFormatSchema.parse(value);
}

/** The hashed subject: every deck slot, the rules and the sources; never the checksum itself. */
export function serializedPrintedConstructedFormatContent(format: PrintedConstructedFormat): string {
  const { contentSha256: _checksum, ...content } = format;
  return `${JSON.stringify(content)}\n`;
}
