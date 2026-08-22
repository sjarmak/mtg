/**
 * The five-position reference set every reduced-artifact test reduces.
 *
 * One position per rarity band and one per color, with two booster
 * configurations that differ only in how many commons they open. Dropping its
 * one red common therefore exercises every question a reduction answers at
 * once: the drop is named, the census moves in one color and one rarity, the
 * common sheet reweights, the two-common booster stops fitting, and the
 * one-common booster still does.
 *
 * Lifted out of `partial-executable-reference.test.ts` when the playable
 * document became a second reader of it. Both the reduced artifact and the
 * document cut from it have to be tested against the same source set, or a
 * disagreement between them shows up as two passing suites.
 */
import {
  EXECUTABLE_COVERAGE_INSTRUMENT_VERSION,
  ReferenceCorpusSchema,
  referencePositionFingerprint,
  type ExecutableCoverageEvidence,
  type ReferenceCard,
  type ReferenceCorpus,
} from '@mtg/data';
import type { Card } from '@mtg/dsl';

export const UUID = (n: number): string => `00000000-0000-5000-8000-${String(n).padStart(12, '0')}`;
export const ORACLE = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export interface Spec {
  readonly number: number;
  readonly name: string;
  readonly rarity: string;
  readonly colors: readonly string[];
  readonly sheet: string;
}

export const SPECS: readonly Spec[] = [
  { number: 1, name: 'Still Meadow', rarity: 'common', colors: [], sheet: 'basic' },
  { number: 2, name: 'Meadow Sentry', rarity: 'common', colors: ['W'], sheet: 'common' },
  { number: 3, name: 'Ember Runner', rarity: 'common', colors: ['R'], sheet: 'common' },
  { number: 4, name: 'Tidal Recall', rarity: 'uncommon', colors: ['U'], sheet: 'uncommon' },
  { number: 5, name: 'Grove Warden', rarity: 'rare', colors: ['G'], sheet: 'rare' },
];

function sourceCard(spec: Spec): ReferenceCard {
  const land = spec.number === 1;
  return {
    uuid: UUID(spec.number),
    name: spec.name,
    number: String(spec.number),
    rarity: spec.rarity,
    setCode: 'RDC',
    roles: ['main-set'],
    identifiers: { scryfallOracleId: ORACLE(spec.number) },
    availability: ['paper'],
    boosterTypes: ['default'],
    promoTypes: [],
    otherFaceIds: [],
    layout: 'normal',
    manaValue: land ? 0 : 2,
    ...(land ? {} : { manaCost: `{1}{${spec.colors[0] ?? 'W'}}` }),
    type: land ? 'Basic Land — Plains' : 'Creature — Scout',
    types: land ? ['Land'] : ['Creature'],
    supertypes: land ? ['Basic'] : [],
    subtypes: land ? ['Plains'] : ['Scout'],
    colors: [...spec.colors],
    colorIdentity: [...spec.colors],
    keywords: [],
    ...(land ? {} : { power: '2', toughness: '2' }),
  };
}

export function corpus(): ReferenceCorpus {
  const cards = SPECS.map(sourceCard);
  const sheetCards = (name: string): Record<string, number> =>
    Object.fromEntries(SPECS.filter((spec) => spec.sheet === name).map((spec) => [UUID(spec.number), 1]));
  const sheet = (name: string): Record<string, unknown> => ({
    cards: sheetCards(name),
    foil: false,
    totalWeight: Object.keys(sheetCards(name)).length,
  });
  return ReferenceCorpusSchema.parse({
    schemaVersion: 1,
    source: {
      provider: 'MTGJSON',
      license: 'MIT',
      licenseUrl: 'https://mtgjson.com/license/',
      version: '5.3.0+20260814',
      builtDate: '2026-08-14',
    },
    sets: [
      {
        code: 'RDC',
        name: 'Reduced Test Set',
        sourceUrl: 'https://mtgjson.com/api/v5/RDC.json',
        releaseDate: '2020-01-01',
        setType: 'core',
        sourceSha256: 'a'.repeat(64),
        mainSetSize: SPECS.length,
        totalSetSize: SPECS.length,
        cards,
        tokens: [],
        draftBooster: {
          boosters: [
            { contents: { basic: 1, common: 2, uncommon: 1, rare: 1 }, weight: 3 },
            { contents: { basic: 1, common: 1, uncommon: 1, rare: 1 }, weight: 1 },
          ],
          boostersTotalWeight: 4,
          name: 'Draft',
          sheets: {
            basic: sheet('basic'),
            common: sheet('common'),
            uncommon: sheet('uncommon'),
            rare: sheet('rare'),
          },
          sourceSetCodes: ['RDC'],
        },
      },
    ],
  });
}

export function translatedCard(spec: Spec): Card {
  const shared = {
    id: `xlat-${String(spec.number)}`,
    name: spec.name,
    rarity: 'common' as const,
    set: { code: 'XLAT', collectorNumber: spec.number },
    colors: [...spec.colors] as Card['colors'],
    keywords: [],
    effects: [],
    abilities: [],
    costReduction: null,
  };
  if (spec.number === 1) {
    return {
      ...shared,
      kind: 'land',
      basicLandType: 'Plains',
      producesMana: ['W'],
      supertypes: ['basic'],
      subtypes: [],
    };
  }
  const color = spec.colors[0];
  return {
    ...shared,
    kind: 'creature',
    manaCost: {
      generic: 1,
      W: color === 'W' ? 1 : 0,
      U: color === 'U' ? 1 : 0,
      B: color === 'B' ? 1 : 0,
      R: color === 'R' ? 1 : 0,
      G: color === 'G' ? 1 : 0,
      hasX: false,
    },
    artifact: false,
    power: 2,
    toughness: 2,
    supertypes: [],
    subtypes: ['Scout'],
  };
}

export function evidence(reference: ReferenceCorpus = corpus()): ExecutableCoverageEvidence {
  const set = reference.sets[0];
  if (set === undefined) throw new Error('fixture set missing');
  return {
    schemaVersion: 1,
    instrumentVersion: EXECUTABLE_COVERAGE_INSTRUMENT_VERSION,
    corpus: {
      schemaVersion: reference.schemaVersion,
      provider: reference.source.provider,
      version: reference.source.version,
      builtDate: reference.source.builtDate,
    },
    set: { code: set.code, sourceSha256: set.sourceSha256 },
    rows: SPECS.map((spec) => {
      const faces = set.cards.filter((card) => card.number === String(spec.number));
      return {
        instrumentVersion: EXECUTABLE_COVERAGE_INSTRUMENT_VERSION,
        setCode: set.code,
        collectorNumber: spec.number,
        sourceFingerprint: referencePositionFingerprint(faces),
        translationSourceFingerprint: 'd'.repeat(64),
        oracleId: ORACLE(spec.number),
        outcome: 'covered' as const,
        approximations: [],
        problems: [],
        evidence: ['cardCast', 'spellResolved'],
        card: translatedCard(spec),
      };
    }),
  };
}

export function copyEvidence(): ExecutableCoverageEvidence {
  return structuredClone(evidence());
}

/** Refuses collector position 3 (the red common) the way the evidence would. */
export function withRefusedRed(): ExecutableCoverageEvidence {
  const input = copyEvidence();
  const row = input.rows[2];
  if (row === undefined) throw new Error('fixture row missing');
  row.outcome = 'untranslatable';
  return input;
}
