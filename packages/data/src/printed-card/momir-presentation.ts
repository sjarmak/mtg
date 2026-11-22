import type Database from 'better-sqlite3';
import { PrintedPresentationCatalogSchema } from '@mtg/printed-card';
import type { PrintedPresentationCatalog } from '@mtg/printed-card';
import { ScryfallCardSchema } from '../scryfall/schemas';
import { printedCardEntry } from './entry';

interface SelectedPrinting {
  readonly raw_json: string;
  readonly set_code: string;
  readonly rarity: string;
}

const MOMIR_AVATAR_NAME = 'Momir Vig, Simic Visionary Avatar';

const QUERY = `
  WITH creatures AS (
    SELECT p.raw_json, p.set_code, p.rarity,
      ROW_NUMBER() OVER (
        PARTITION BY p.oracle_id
        ORDER BY p.digital, CASE WHEN p.released_at IS NULL THEN 1 ELSE 0 END,
          p.released_at, p.set_code, p.collector_number, p.scryfall_id
      ) AS rank
    FROM oracle_card o
    JOIN printing p ON p.oracle_id = o.oracle_id
    WHERE o.source = 'scryfall'
      AND p.source = 'scryfall'
      AND instr(o.type_line, 'Creature') > 0
      AND p.lang = 'en'
      AND instr(p.raw_json, '"image_uris"') > 0
  ),
  avatar AS (
    SELECT p.raw_json, p.set_code, p.rarity,
      ROW_NUMBER() OVER (
        PARTITION BY p.oracle_id
        ORDER BY CASE WHEN p.released_at IS NULL THEN 1 ELSE 0 END,
          p.released_at, p.set_code, p.collector_number, p.scryfall_id
      ) AS rank
    FROM oracle_card o
    JOIN printing p ON p.oracle_id = o.oracle_id
    WHERE o.source = 'scryfall'
      AND p.source = 'scryfall'
      AND o.name = ?
      AND p.lang = 'en'
      AND instr(p.raw_json, '"image_uris"') > 0
  )
  SELECT raw_json, set_code, rarity FROM creatures WHERE rank = 1
  UNION ALL
  SELECT raw_json, set_code, rarity FROM avatar WHERE rank = 1
`;

export function buildMomirPresentationCatalog(database: Database.Database): PrintedPresentationCatalog {
  const rows = database.prepare(QUERY).all(MOMIR_AVATAR_NAME) as SelectedPrinting[];
  const cards = rows
    .map((row) => {
      const raw = JSON.parse(row.raw_json) as Record<string, unknown>;
      const producedMana = Array.isArray(raw['produced_mana'])
        ? raw['produced_mana'].filter(
            (value) => typeof value === 'string' && ['W', 'U', 'B', 'R', 'G', 'C'].includes(value),
          )
        : undefined;
      return {
        row,
        card: ScryfallCardSchema.parse({
          ...raw,
          ...(producedMana === undefined ? {} : { produced_mana: producedMana }),
        }),
      };
    })
    .sort(
      (left, right) =>
        left.card.name.localeCompare(right.card.name) ||
        left.card.oracle_id.localeCompare(right.card.oracle_id),
    )
    .map(({ row, card }, index) => {
      const entry = printedCardEntry(
        'momir-presentation-v1',
        {
          position: index + 1,
          sourceName: card.name,
          correctedName: card.name,
          forgeScript: 'presentation-only',
        },
        card,
        new Uint8Array(),
      );
      return {
        physicalId: entry.physicalId,
        position: entry.position,
        name: entry.name,
        oracleId: entry.oracleId,
        scryfallId: entry.scryfallId,
        manaCost: entry.manaCost,
        manaValue: entry.manaValue,
        typeLine: entry.typeLine,
        oracleText: entry.oracleText,
        power: entry.power,
        toughness: entry.toughness,
        loyalty: entry.loyalty,
        colors: entry.colors,
        colorIdentity: entry.colorIdentity,
        faces: entry.faces,
        art: entry.art,
        observedNames: [...new Set([entry.name, ...entry.faces.map((face) => face.name)])],
        ...(entry.producedMana === undefined ? {} : { producedMana: entry.producedMana }),
        setCode: row.set_code.toUpperCase(),
        rarity: row.rarity,
      };
    });
  return PrintedPresentationCatalogSchema.parse({
    schemaVersion: 1,
    kind: 'printed-presentation-catalog',
    selection: 'oldest-english-image-printing-per-oracle-creature-paper-before-digital-plus-named-avatar',
    cards,
  });
}
