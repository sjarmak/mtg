import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import type { LlmProvider } from '@mtg/llm';
import {
  parsePrintedArchetypeList,
  validatePrintedArchetypeList,
  type PrintedArchetypeList,
} from '../src/printed-card/archetypes';
import {
  generatePrintedArchetypes,
  parseRefreshPrintedArchetypesArgs,
} from '../tools/refresh-printed-archetypes';

const dataRoot = new URL('../data/', import.meta.url);

const cards = [
  { physicalId: 'set:0001:first', name: 'First Signpost' },
  { physicalId: 'set:0002:second', name: 'Second Signpost' },
];

const valid: PrintedArchetypeList = {
  schemaVersion: 1,
  formatId: 'fixture',
  archetypes: [
    {
      id: 'white-blue-fliers',
      name: 'White-Blue Fliers',
      colors: ['W', 'U'],
      signpost: { name: 'First Signpost', physicalId: 'set:0001:first' },
      plan: 'Build an evasive battlefield and protect the tempo advantage.',
    },
  ],
};

describe('printed draft archetypes', () => {
  it('accepts a schema-valid list whose signposts are exact cards in the format pool', () => {
    expect(validatePrintedArchetypeList(valid, cards)).toEqual(valid);
  });

  it('refuses a signpost physical id outside the format pool', () => {
    const outside = {
      ...valid,
      archetypes: [
        {
          ...valid.archetypes[0]!,
          signpost: { name: 'Missing Signpost', physicalId: 'other:9999:missing' },
        },
      ],
    };
    expect(() => validatePrintedArchetypeList(outside, cards)).toThrow(/other:9999:missing.*not in fixture/u);
  });

  it('refuses a signpost name that does not match its physical id', () => {
    const mismatch = {
      ...valid,
      archetypes: [
        {
          ...valid.archetypes[0]!,
          signpost: { name: 'Second Signpost', physicalId: 'set:0001:first' },
        },
      ],
    };
    expect(() => validatePrintedArchetypeList(mismatch, cards)).toThrow(/First Signpost.*Second Signpost/u);
  });

  it('requires canonical colors and unique archetype ids', () => {
    expect(() =>
      parsePrintedArchetypeList({
        ...valid,
        archetypes: [
          { ...valid.archetypes[0]!, colors: ['U', 'W'] },
          { ...valid.archetypes[0]!, signpost: cards[1] },
        ],
      }),
    ).toThrow();
  });
});

describe('printed archetype refresh tool', () => {
  it('requires an explicit positive spend ceiling and one format', () => {
    expect(parseRefreshPrintedArchetypesArgs(['--format', 'xln', '--max-usd', '2'])).toEqual({
      formatId: 'xln',
      maxUsd: 2,
    });
    expect(() => parseRefreshPrintedArchetypesArgs(['--format', 'xln'])).toThrow(/--max-usd/u);
    expect(() => parseRefreshPrintedArchetypesArgs(['--format', 'xln', '--max-usd', '0'])).toThrow(
      /positive/u,
    );
  });

  it('hands the model the pool and a schema bound to the requested format and signposts', async () => {
    const complete = vi.fn().mockResolvedValue({ value: valid });
    const provider = { complete } as unknown as LlmProvider;
    await expect(generatePrintedArchetypes('fixture', ['Fixture Set'], cards, provider)).resolves.toEqual(
      valid,
    );
    const request = complete.mock.calls[0]?.[0] as {
      readonly prompt: string;
      readonly schema: { readonly parse: (input: unknown) => unknown };
    };
    expect(request.prompt).toContain('set:0001:first');
    expect(() => request.schema.parse({ ...valid, formatId: 'other' })).toThrow();
    expect(() =>
      request.schema.parse({
        ...valid,
        archetypes: [
          {
            ...valid.archetypes[0]!,
            signpost: { name: 'Missing Signpost', physicalId: 'other:9999:missing' },
          },
        ],
      }),
    ).toThrow(/other:9999:missing/u);
  });
});

describe('committed printed draft archetype lists', () => {
  const registry = JSON.parse(readFileSync(new URL('printed-formats-v1.json', dataRoot), 'utf8')) as {
    readonly formats: readonly {
      readonly id: string;
      readonly availability: { readonly draft: string };
      readonly catalogs: readonly { readonly file: string }[];
    }[];
  };
  const draftFormats = registry.formats.filter((format) => format.availability.draft === 'available');

  it('covers every draft-available printed format', () => {
    expect(draftFormats).toHaveLength(30);
    for (const format of draftFormats) {
      expect(existsSync(new URL(`${format.id}/archetypes-v1.json`, dataRoot)), format.id).toBe(true);
    }
  });

  it.each(draftFormats)('$id names only exact signposts from its committed catalogs', (format) => {
    const list = parsePrintedArchetypeList(
      JSON.parse(readFileSync(new URL(`${format.id}/archetypes-v1.json`, dataRoot), 'utf8')),
    );
    const pool = format.catalogs.flatMap((catalog) => {
      const parsed = JSON.parse(readFileSync(new URL(`${format.id}/${catalog.file}`, dataRoot), 'utf8')) as {
        readonly cards: readonly { readonly physicalId: string; readonly name: string }[];
      };
      return parsed.cards;
    });
    expect(list.formatId).toBe(format.id);
    expect(validatePrintedArchetypeList(list, pool).archetypes.length).toBeGreaterThan(0);
  });

  it('keeps pool-specific plans aligned with the cards and mechanics they name', () => {
    const read = (formatId: string): PrintedArchetypeList =>
      parsePrintedArchetypeList(
        JSON.parse(readFileSync(new URL(`${formatId}/archetypes-v1.json`, dataRoot), 'utf8')),
      );
    const innistrad = read('isd').archetypes.find((archetype) => archetype.colors.join('') === 'WB');
    const scarsPlans = [...read('som').archetypes, ...read('mbs').archetypes].map(
      (archetype) => archetype.plan,
    );
    const therosMinotaurs = read('ths').archetypes.find(
      (archetype) => archetype.id === 'black-red-minotaurs',
    );

    expect(innistrad?.name).toBe('White-Black Reanimator');
    expect(innistrad?.plan).toMatch(/graveyard.*return|return.*graveyard/u);
    expect(scarsPlans).not.toEqual(expect.arrayContaining([expect.stringMatching(/Spawn/u)]));
    expect(therosMinotaurs?.plan).not.toMatch(/reduce.*cost/iu);
    expect(therosMinotaurs?.plan).toMatch(/Rageblood Shaman|Kragma Warcaller/u);
  });
});
