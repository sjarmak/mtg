/**
 * Writing generated lab cards into the same tables as real ones.
 *
 * The data lane's ruling (`prior-art-data-sources.md` §8): custom cards live in
 * the *same* `oracle_card`/`printing` shape with a `source: "lab"`
 * discriminator, because one schema for real and generated cards is what makes
 * the deck lab, sim and renderer indifferent to card origin.
 *
 * Deliberately no `@mtg/dsl` import: the store must not know the DSL, so the
 * DSL can later consume this package's MTGJSON vocabulary without a cycle. The
 * set-gen package projects its DSL cards onto `LabCardInput`.
 */
import { z } from 'zod';
import { InvalidInputError } from '../errors';
import type { DataStore } from './store';
import { createWriters } from './writers';

const ColorLetterSchema = z.enum(['W', 'U', 'B', 'R', 'G']);

export const LabCardInputSchema = z.object({
  /** Stable identity for the generated card; a slug is fine, it need not be a UUID. */
  oracleId: z.string().min(1),
  name: z.string().min(1),
  manaCost: z.string().nullable().default(null),
  manaValue: z.number().nonnegative(),
  typeLine: z.string().min(1),
  oracleText: z.string().nullable().default(null),
  power: z.string().nullable().default(null),
  toughness: z.string().nullable().default(null),
  loyalty: z.string().nullable().default(null),
  colors: z.array(ColorLetterSchema).default([]),
  colorIdentity: z.array(ColorLetterSchema).default([]),
  layout: z.string().min(1).default('normal'),
  keywords: z.array(z.string()).default([]),
  /** Optional printing; omit for a card that has no set membership yet. */
  printing: z
    .object({
      printingId: z.string().min(1),
      setCode: z.string().min(1),
      setName: z.string().nullable().default(null),
      collectorNumber: z.string().min(1),
      rarity: z.string().min(1),
      artist: z.string().nullable().default(null),
      releasedAt: z.string().nullable().default(null),
      imageUris: z.record(z.string(), z.string()).nullable().default(null),
    })
    .optional(),
});

export type LabCardInput = z.input<typeof LabCardInputSchema>;
export type LabCard = z.output<typeof LabCardInputSchema>;

const COLOR_ORDER: Readonly<Record<string, number>> = { W: 0, U: 1, B: 2, R: 3, G: 4 };

function canonical(colors: readonly string[]): string {
  return [...new Set(colors)].sort((a, b) => (COLOR_ORDER[a] ?? 9) - (COLOR_ORDER[b] ?? 9)).join('');
}

/**
 * Validates and upserts a generated card (and optionally its printing).
 * Idempotent on `oracleId`, exactly like the Scryfall path.
 */
export function upsertLabCard(store: DataStore, input: LabCardInput): LabCard {
  const parsed = LabCardInputSchema.safeParse(input);
  if (!parsed.success) throw new InvalidInputError('lab card', z.prettifyError(parsed.error));
  const card = parsed.data;
  const writers = createWriters(store);
  const now = store.now();
  const raw = JSON.stringify(card);

  const write = store.db.transaction(() => {
    writers.oracleCard.run({
      oracle_id: card.oracleId,
      source: 'lab',
      name: card.name,
      mana_cost: card.manaCost,
      mana_value: card.manaValue,
      type_line: card.typeLine,
      oracle_text: card.oracleText,
      power: card.power,
      toughness: card.toughness,
      loyalty: card.loyalty,
      colors: canonical(card.colors),
      color_identity: canonical(card.colorIdentity),
      layout: card.layout,
      keywords: JSON.stringify([...card.keywords].sort()),
      legalities: null,
      reserved: 0,
      raw_json: raw,
      bulk_updated_at: null,
      ingested_at: now,
    });

    const printing = card.printing;
    if (printing !== undefined) {
      writers.printing.run({
        scryfall_id: printing.printingId,
        oracle_id: card.oracleId,
        source: 'lab',
        set_code: printing.setCode.toUpperCase(),
        set_name: printing.setName,
        collector_number: printing.collectorNumber,
        rarity: printing.rarity,
        artist: printing.artist,
        released_at: printing.releasedAt,
        lang: 'en',
        digital: 1,
        border_color: null,
        frame: null,
        image_uris: printing.imageUris === null ? null : JSON.stringify(printing.imageUris),
        raw_json: JSON.stringify(printing),
        bulk_updated_at: null,
        ingested_at: now,
      });
    }
  });

  write();
  return card;
}

/** Removes a generated card and its printings. Never touches Scryfall rows. */
export function deleteLabCard(store: DataStore, oracleId: string): boolean {
  const remove = store.db.transaction(() => {
    store.db.prepare(`DELETE FROM printing WHERE oracle_id = ? AND source = 'lab'`).run(oracleId);
    return store.db.prepare(`DELETE FROM oracle_card WHERE oracle_id = ? AND source = 'lab'`).run(oracleId);
  });
  return remove().changes > 0;
}
