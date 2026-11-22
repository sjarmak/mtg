import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { serializedPrintedConstructedFormatContent } from '@mtg/printed-card';
import {
  buildPrintedConstructedCandidate,
  finalizePrintedConstructedFormat,
  forgeCompletionResults,
} from '../src/printed-card/constructed-pipeline';

const sources = [
  {
    code: 'TST',
    catalogFormat: 'test-v1',
    catalogSha256: '1'.repeat(64),
    mtgjson: { url: 'https://example.com/TST.json', sha256: '2'.repeat(64), version: '1' },
  },
];

const basic = {
  physicalId: 'test-v1:0001:basic',
  correctedName: 'Plains',
  typeLine: 'Basic Land — Plains',
  oracleText: null,
};

const spell = {
  physicalId: 'test-v1:0002:spell',
  correctedName: 'Test Spell',
  typeLine: 'Creature — Test',
  oracleText: null,
};

const archetypes = {
  schemaVersion: 1 as const,
  formatId: 'test',
  archetypes: [
    {
      id: 'white-test',
      name: 'White Test',
      colors: ['W'] as const,
      signpost: { name: 'Test Spell', physicalId: spell.physicalId },
      plan: 'Cast Test Spell and attack.',
    },
  ],
};

function artifact(spellCount = 4) {
  return {
    schemaVersion: 1,
    kind: 'printed-constructed-deck',
    formatId: 'test',
    sourceCodes: ['TST'],
    archetype: {
      name: 'White Test',
      colors: ['W'],
      plan: 'Cast Test Spell and attack.',
    },
    spend: { spentUsd: 1, selectionUsd: 1, maxSpendUsd: 10 },
    deck: {
      id: 'white-test',
      name: 'White Test',
      commanders: [],
      cards: [
        { physicalId: spell.physicalId, name: spell.correctedName, count: spellCount },
        { physicalId: basic.physicalId, name: basic.correctedName, count: 60 - spellCount },
      ],
    },
  };
}

function loaded(value: unknown = artifact()) {
  return { archetypeId: 'white-test', status: 'loaded' as const, value };
}

const input = {
  id: 'test',
  name: 'Test Format',
  sources,
  archetypes,
  catalogs: [{ code: 'TST', cards: [basic, spell] }],
  admittedPhysicalIds: new Set([basic.physicalId, spell.physicalId]),
};

describe('printed constructed pipeline', () => {
  it('builds a candidate only from exact legal archetype artifacts', () => {
    const candidate = buildPrintedConstructedCandidate({ ...input, artifacts: [loaded()] });
    expect(candidate.results).toEqual([{ archetypeId: 'white-test', status: 'passed' }]);
    const format = candidate.format;
    if (format === null) throw new Error('expected candidate format');
    expect(format.decks).toHaveLength(1);
    expect(format.contentSha256).toBe(
      createHash('sha256').update(serializedPrintedConstructedFormatContent(format)).digest('hex'),
    );
  });

  it('reports illegal and unadmitted decks without shipping them', () => {
    const illegal = buildPrintedConstructedCandidate({ ...input, artifacts: [loaded(artifact(5))] });
    expect(illegal.results[0]).toMatchObject({ archetypeId: 'white-test', status: 'failed' });
    expect(illegal.results[0]?.reason).toMatch(/appears 5 times/u);
    expect(illegal.format).toBeNull();

    const unadmitted = buildPrintedConstructedCandidate({
      ...input,
      admittedPhysicalIds: new Set([basic.physicalId]),
      artifacts: [loaded()],
    });
    expect(unadmitted.results[0]?.reason).toMatch(/not Forge-admitted/u);
    expect(unadmitted.format).toBeNull();
  });

  it('requires exactly sixty cards', () => {
    const base = artifact();
    for (const basicCount of [55, 57]) {
      const candidate = buildPrintedConstructedCandidate({
        ...input,
        artifacts: [
          loaded({
            ...base,
            deck: {
              ...base.deck,
              cards: [base.deck.cards[0], { ...base.deck.cards[1], count: basicCount }],
            },
          }),
        ],
      });
      expect(candidate.results[0]?.reason).toMatch(/requires exactly 60/u);
      expect(candidate.format).toBeNull();
    }
  });

  it('requires a completed Forge game for every deck in the final format', () => {
    const candidate = buildPrintedConstructedCandidate({ ...input, artifacts: [loaded()] });
    expect(() => finalizePrintedConstructedFormat(candidate, new Map())).toThrow(/completed Forge game/u);
    expect(
      finalizePrintedConstructedFormat(candidate, new Map([['white-test', 'completed']])).decks,
    ).toHaveLength(1);
  });

  it('binds Forge receipts to one format and one result per archetype', () => {
    const candidate = buildPrintedConstructedCandidate({ ...input, artifacts: [loaded()] });
    const format = candidate.format;
    if (format === null) throw new Error('expected candidate format');
    const receipt = {
      schemaVersion: 1,
      formatId: 'test',
      formatSha256: format.contentSha256,
      results: [{ archetypeId: 'white-test', status: 'completed', decisions: 12, elapsedMs: 34 }],
    };
    expect(forgeCompletionResults(format, receipt)).toEqual(new Map([['white-test', 'completed']]));
    expect(() => forgeCompletionResults({ ...format, id: 'other' }, receipt)).toThrow(/receipt is for test/u);
    expect(() => forgeCompletionResults({ ...format, contentSha256: '9'.repeat(64) }, receipt)).toThrow(
      /receipt proves format/u,
    );
    expect(() =>
      forgeCompletionResults(format, {
        ...receipt,
        results: [...receipt.results, ...receipt.results],
      }),
    ).toThrow(/duplicate Forge result/u);
  });

  it('rejects card names that differ from the catalog printing', () => {
    const original = artifact();
    const wrongName = {
      ...original,
      deck: {
        ...original.deck,
        cards: original.deck.cards.map((slot, index) =>
          index === 0 ? { ...slot, name: 'Different Spell' } : slot,
        ),
      },
    };
    const candidate = buildPrintedConstructedCandidate({ ...input, artifacts: [loaded(wrongName)] });
    expect(candidate.results[0]).toMatchObject({ archetypeId: 'white-test', status: 'failed' });
    expect(candidate.results[0]?.reason).toMatch(/name|printing/u);
    expect(candidate.format).toBeNull();
  });

  it('preserves valid decks when another archetype artifact cannot be read', () => {
    const candidate = buildPrintedConstructedCandidate({
      ...input,
      artifacts: [
        loaded(),
        { archetypeId: 'missing-test', status: 'failed' as const, reason: 'artifact file is missing' },
      ],
    });
    expect(candidate.results).toEqual([
      { archetypeId: 'white-test', status: 'passed' },
      { archetypeId: 'missing-test', status: 'failed', reason: 'artifact file is missing' },
    ]);
    expect(candidate.format?.decks).toHaveLength(1);
  });
});
