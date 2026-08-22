import { describe, expect, it } from 'vitest';
import {
  EXECUTABLE_COVERAGE_INSTRUMENT_VERSION,
  ExecutableReferenceSetSchema,
  ReferenceCorpusSchema,
  buildExecutableReferenceSet,
  referencePositionFingerprint,
  type ExecutableCoverageEvidence,
  type ReferenceCard,
  type ReferenceCorpus,
} from '@mtg/data';
import type { Card } from '@mtg/dsl';

const ORACLE_ONE = '00000000-0000-4000-8000-000000000001';
const ORACLE_TWO = '00000000-0000-4000-8000-000000000002';

function sourceCard(
  uuid: string,
  number: string,
  name: string,
  oracleId: string,
  extra: Partial<ReferenceCard> = {},
): ReferenceCard {
  return {
    uuid,
    name,
    number,
    rarity: number === '1' ? 'common' : 'uncommon',
    setCode: 'TST',
    roles: ['main-set'],
    identifiers: { scryfallOracleId: oracleId },
    availability: ['paper'],
    boosterTypes: ['default'],
    promoTypes: [],
    otherFaceIds: [],
    layout: 'normal',
    manaValue: number === '1' ? 0 : 2,
    type: number === '1' ? 'Basic Land — Forest' : 'Creature — Shapeshifter',
    types: number === '1' ? ['Land'] : ['Creature'],
    supertypes: number === '1' ? ['Basic'] : [],
    subtypes: number === '1' ? ['Forest'] : ['Shapeshifter'],
    colors: number === '1' ? [] : ['U'],
    colorIdentity: number === '1' ? ['G'] : ['U'],
    keywords: [],
    ...extra,
  };
}

function corpus(): ReferenceCorpus {
  const forest = sourceCard('00000000-0000-5000-8000-000000000001', '1', 'Quiet Forest', ORACLE_ONE);
  const day = sourceCard('00000000-0000-5000-8000-000000000002', '2', 'Day // Night', ORACLE_TWO, {
    side: 'a',
    layout: 'transform',
    manaCost: '{1}{U}',
    text: 'When this creature enters, draw a card.',
    power: '1',
    toughness: '1',
    otherFaceIds: ['00000000-0000-5000-8000-000000000003'],
  });
  const night = sourceCard('00000000-0000-5000-8000-000000000003', '2', 'Day // Night', ORACLE_TWO, {
    side: 'b',
    layout: 'transform',
    manaCost: '',
    text: 'Menace',
    colors: ['B'],
    colorIdentity: ['U', 'B'],
    keywords: ['Menace'],
    power: '3',
    toughness: '2',
    otherFaceIds: ['00000000-0000-5000-8000-000000000002'],
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
        code: 'TST',
        name: 'Test Set',
        sourceUrl: 'https://mtgjson.com/api/v5/TST.json',
        releaseDate: '2020-01-01',
        setType: 'core',
        sourceSha256: 'a'.repeat(64),
        mainSetSize: 2,
        totalSetSize: 2,
        cards: [forest, day, night],
        tokens: [],
        draftBooster: {
          boosters: [{ contents: { main: 2 }, weight: 1 }],
          boostersTotalWeight: 1,
          name: 'Draft',
          sheets: {
            main: {
              cards: { [forest.uuid]: 3, [day.uuid]: 1 },
              foil: false,
              totalWeight: 4,
            },
          },
          sourceSetCodes: ['TST'],
        },
      },
    ],
  });
}

function translatedCard(number: number, name: string): Card {
  if (number === 1) {
    return {
      id: 'translated-1',
      name,
      rarity: 'common',
      set: { code: 'XLAT', collectorNumber: number },
      kind: 'land',
      costReduction: null,
      basicLandType: 'Forest',
      producesMana: ['G'],
      colors: [],
      supertypes: ['basic'],
      subtypes: [],
      keywords: [],
      effects: [],
      abilities: [],
    };
  }
  return {
    id: 'translated-2',
    name,
    rarity: 'common',
    set: { code: 'XLAT', collectorNumber: number },
    kind: 'creature',
    manaCost: { generic: 1, W: 0, U: 1, B: 0, R: 0, G: 0, hasX: false },
    costReduction: null,
    artifact: false,
    power: 1,
    toughness: 1,
    colors: ['U'],
    supertypes: [],
    subtypes: ['Shapeshifter'],
    keywords: [],
    effects: [],
    abilities: [],
  };
}

function evidence(reference: ReferenceCorpus = corpus()): ExecutableCoverageEvidence {
  const set = reference.sets[0];
  if (set === undefined) throw new Error('fixture set missing');
  const rows = [1, 2].map((collectorNumber) => {
    const faces = set.cards.filter(
      (card) => card.number === String(collectorNumber) && card.roles.includes('main-set'),
    );
    const first = faces[0];
    if (first === undefined) throw new Error('fixture face missing');
    return {
      instrumentVersion: EXECUTABLE_COVERAGE_INSTRUMENT_VERSION,
      setCode: set.code,
      collectorNumber,
      sourceFingerprint: referencePositionFingerprint(faces),
      translationSourceFingerprint: 'd'.repeat(64),
      oracleId: String(first.identifiers['scryfallOracleId']),
      outcome: 'covered' as const,
      approximations: [],
      problems: [],
      evidence: ['cardCast', 'spellResolved'],
      card: translatedCard(collectorNumber, first.name),
    };
  });
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
    rows,
  };
}

function copyEvidence(): ExecutableCoverageEvidence {
  return structuredClone(evidence());
}

describe('strict executable reference seam', () => {
  it('builds one deterministic checked artifact while preserving source identities exactly', () => {
    const reference = corpus();
    const artifact = buildExecutableReferenceSet(reference, evidence(reference));

    expect(ExecutableReferenceSetSchema.parse(artifact)).toEqual(artifact);
    expect(buildExecutableReferenceSet(reference, evidence(reference))).toEqual(artifact);
    expect(artifact.kind).toBe('coverage-checked-reference-set');
    const serialized = ExecutableReferenceSetSchema.parse(JSON.parse(JSON.stringify(artifact)));
    expect(serialized.coverage.instrumentVersion).toBe(3);
    expect(serialized.coverage.rows.map((row) => row.instrumentVersion)).toEqual([3, 3]);
    expect(serialized.coverage.rows.map((row) => row.translationSourceFingerprint)).toEqual([
      'd'.repeat(64),
      'd'.repeat(64),
    ]);
    const staleSerialized = structuredClone(serialized) as unknown as {
      coverage: { instrumentVersion: number };
    };
    staleSerialized.coverage.instrumentVersion = 2;
    expect(ExecutableReferenceSetSchema.safeParse(staleSerialized).success).toBe(false);
    expect(JSON.stringify(artifact.sourceSet.cards)).toBe(JSON.stringify(reference.sets[0]?.cards));
    expect(JSON.stringify(artifact.sourceSet.draftBooster)).toBe(
      JSON.stringify(reference.sets[0]?.draftBooster),
    );
    expect(artifact.cards.map((card) => [card.id, card.name, card.rarity, card.set])).toEqual([
      ['tst-1', 'Quiet Forest', 'common', { code: 'TST', collectorNumber: 1 }],
      ['tst-2', 'Day // Night', 'uncommon', { code: 'TST', collectorNumber: 2 }],
    ]);
  });

  it('rejects an omitted collector position and duplicate evidence rows with named errors', () => {
    const missing = copyEvidence();
    missing.rows = missing.rows.slice(0, 1);
    expect(() => buildExecutableReferenceSet(corpus(), missing)).toThrowError(
      expect.objectContaining({ code: 'MISSING_POSITION', collectorNumber: 2 }),
    );

    const duplicate = copyEvidence();
    const first = duplicate.rows[0];
    if (first === undefined) throw new Error('fixture row missing');
    duplicate.rows.push(structuredClone(first));
    expect(() => buildExecutableReferenceSet(corpus(), duplicate)).toThrowError(
      expect.objectContaining({ code: 'DUPLICATE_POSITION', collectorNumber: 1 }),
    );
  });

  it.each([
    'approximated',
    'untranslatable',
    'invalidAnswer',
    'invalidDsl',
    'kernelThrew',
    'unreached',
    'callFailed',
  ] as const)('rejects the %s coverage outcome', (outcome) => {
    const input = copyEvidence();
    const first = input.rows[0];
    if (first === undefined) throw new Error('fixture row missing');
    first.outcome = outcome;
    expect(() => buildExecutableReferenceSet(corpus(), input)).toThrowError(
      expect.objectContaining({ code: 'NONEXACT_OUTCOME', collectorNumber: 1, outcome }),
    );
  });

  it('rejects admitted approximation and covered rows without probe evidence', () => {
    const approximate = copyEvidence();
    const approximateRow = approximate.rows[0];
    if (approximateRow === undefined) throw new Error('fixture row missing');
    approximateRow.approximations = ['left off a triggered ability'];
    expect(() => buildExecutableReferenceSet(corpus(), approximate)).toThrowError(
      expect.objectContaining({ code: 'APPROXIMATION', collectorNumber: 1 }),
    );

    const unprobed = copyEvidence();
    const unprobedRow = unprobed.rows[0];
    if (unprobedRow === undefined) throw new Error('fixture row missing');
    unprobedRow.evidence = [];
    expect(() => buildExecutableReferenceSet(corpus(), unprobed)).toThrowError(
      expect.objectContaining({ code: 'UNPROBED', collectorNumber: 1 }),
    );

    const invalid = copyEvidence();
    const invalidRow = invalid.rows[0];
    if (invalidRow === undefined) throw new Error('fixture row missing');
    invalidRow.problems = ['validator rejected the emitted card'];
    expect(() => buildExecutableReferenceSet(corpus(), invalid)).toThrowError(
      expect.objectContaining({ code: 'INVALID_TRANSLATION', collectorNumber: 1 }),
    );
  });

  it('rejects stale corpus, set, position, and Oracle identities', () => {
    const staleCorpus = copyEvidence();
    staleCorpus.corpus.version = '5.2.0';
    expect(() => buildExecutableReferenceSet(corpus(), staleCorpus)).toThrowError(
      expect.objectContaining({ code: 'STALE_CORPUS' }),
    );

    const staleSet = copyEvidence();
    staleSet.set.sourceSha256 = 'b'.repeat(64);
    expect(() => buildExecutableReferenceSet(corpus(), staleSet)).toThrowError(
      expect.objectContaining({ code: 'STALE_SET' }),
    );

    const stalePosition = copyEvidence();
    const stalePositionRow = stalePosition.rows[0];
    if (stalePositionRow === undefined) throw new Error('fixture row missing');
    stalePositionRow.sourceFingerprint = 'c'.repeat(64);
    expect(() => buildExecutableReferenceSet(corpus(), stalePosition)).toThrowError(
      expect.objectContaining({ code: 'STALE_POSITION', collectorNumber: 1 }),
    );

    const staleOracle = copyEvidence();
    const staleOracleRow = staleOracle.rows[0];
    if (staleOracleRow === undefined) throw new Error('fixture row missing');
    staleOracleRow.oracleId = '00000000-0000-4000-8000-000000000099';
    expect(() => buildExecutableReferenceSet(corpus(), staleOracle)).toThrowError(
      expect.objectContaining({ code: 'STALE_ORACLE', collectorNumber: 1 }),
    );
  });

  it('rejects stale instrument rows, invalid translations, and source-name drift', () => {
    const staleInstrument = copyEvidence() as unknown as { instrumentVersion: number };
    staleInstrument.instrumentVersion = 2;
    expect(() => buildExecutableReferenceSet(corpus(), staleInstrument)).toThrowError(
      expect.objectContaining({ code: 'INVALID_EVIDENCE' }),
    );

    const staleRowInstrument = copyEvidence() as unknown as {
      rows: { instrumentVersion: number }[];
    };
    const staleRow = staleRowInstrument.rows[0];
    if (staleRow === undefined) throw new Error('fixture row missing');
    staleRow.instrumentVersion = 2;
    expect(() => buildExecutableReferenceSet(corpus(), staleRowInstrument)).toThrowError(
      expect.objectContaining({ code: 'INVALID_EVIDENCE' }),
    );

    const invalid = copyEvidence();
    const invalidRow = invalid.rows[0];
    if (invalidRow === undefined) throw new Error('fixture row missing');
    invalidRow.card = null;
    expect(() => buildExecutableReferenceSet(corpus(), invalid)).toThrowError(
      expect.objectContaining({ code: 'INVALID_TRANSLATION', collectorNumber: 1 }),
    );

    const wrongName = copyEvidence();
    const wrongNameRow = wrongName.rows[0];
    if (wrongNameRow === undefined || wrongNameRow.card === null) throw new Error('fixture row missing');
    wrongNameRow.card.name = 'Different Card';
    expect(() => buildExecutableReferenceSet(corpus(), wrongName)).toThrowError(
      expect.objectContaining({ code: 'STALE_TRANSLATION', collectorNumber: 1 }),
    );
  });
});
