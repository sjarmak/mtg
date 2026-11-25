import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  checkCommanderDeck,
  parsePrintedCardCatalog,
  parsePrintedConstructedFormat,
  parsePrintedTokenPrintings,
} from '@mtg/printed-card';
import { FORGE_TOKEN_SCRIPTS_PATH, readForgeScriptArchive } from '../src/printed-card/forge-install';
import { verifiedPrintedFormat } from '../src/printed-card/play-admission';
import { catalogTokenScriptReferences } from '../src/printed-card/token-references';
import { parseForgeTokenScript } from '../src/printed-card/token-printings';

const dataRoot = new URL('../data/commander-precons/', import.meta.url);
const readData = (file: string) => readFileSync(new URL(file, dataRoot), 'utf8');
const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

const CATALOG_FILES = [
  'scd-printed-catalog-v1.json',
  'c17-printed-catalog-v1.json',
  'ala-printed-catalog-v1.json',
  'c13-printed-catalog-v1.json',
  'cma-printed-catalog-v1.json',
  'c16-printed-catalog-v1.json',
  'cmm-printed-catalog-v1.json',
] as const;

const NEW_WAVE_DECK_IDS = [
  'draconic-domination',
  'vampiric-bloodlust',
  'heavenly-inferno',
  'plunder-the-graves',
  'invent-superiority',
  'eldrazi-unbound',
];

describe('Commander Preconstructed Decks printed format sources', () => {
  const catalogInputs = CATALOG_FILES.map((file) => JSON.parse(readData(file)) as unknown);
  const catalogs = catalogInputs.map(parsePrintedCardCatalog);
  const formatInput = JSON.parse(readData('commander-precons-constructed-format-v1.json')) as unknown;
  const format = parsePrintedConstructedFormat(formatInput);
  const evidence = JSON.parse(readData('build-evidence.json')) as {
    status: string;
    formatId: string;
    formatSha256: string;
    forgeVersion: string;
    builds: readonly { sourceCodes: readonly string[]; sourceSha256: string; archiveSha256: string }[];
    catalogs: readonly { code: string; cards: number; contentSha256: string }[];
    artifactSha256: Record<string, string>;
  };

  it('binds the staged catalogs, format and the two sub-builds to the build evidence', () => {
    expect(format.id).toBe('commander-precons');
    expect(format.rules).toEqual({ variant: 'commander', startingLife: 40 });
    expect(evidence.status).toBe('catalog-only-not-play-admitted');
    expect(evidence.formatId).toBe(format.id);
    expect(evidence.formatSha256).toBe(format.contentSha256);
    expect(evidence.forgeVersion).toBe('2.0.14');
    expect(format.sources.map((source) => source.code)).toEqual([
      'SCD',
      'C17',
      'ALA',
      'C13',
      'CMA',
      'C16',
      'CMM',
    ]);
    expect(evidence.catalogs).toEqual(
      format.sources.map((source, index) => ({
        code: source.code,
        cards: catalogs[index]!.cards.length,
        contentSha256: catalogs[index]!.contentSha256,
      })),
    );
    expect(evidence.builds.map((build) => build.sourceCodes)).toEqual([
      ['SCD'],
      ['C17', 'ALA', 'C13', 'CMA', 'C16', 'CMM'],
    ]);
    expect(sha256(readFileSync(new URL('../scd/scd-printed-sources-v1.json', dataRoot), 'utf8'))).toBe(
      evidence.builds[0]!.sourceSha256,
    );
    expect(sha256(readData('commander-precons-printed-sources-v1.json'))).toBe(
      evidence.builds[1]!.sourceSha256,
    );
    expect(evidence.builds[0]!.archiveSha256).toBe(evidence.builds[1]!.archiveSha256);
    for (const file of [
      ...CATALOG_FILES,
      'commander-precons-constructed-format-v1.json',
      'onboarding-format-v1.json',
      'commander-precons-printed-sources-v1.json',
    ]) {
      expect(sha256(readData(file))).toBe(evidence.artifactSha256[file]);
    }
  });

  it('holds eleven precons across seven sets, each one commander over ninety-nine cards', () => {
    expect(format.decks.map((deck) => deck.id)).toEqual([
      'chaos-incarnate',
      'draconic-destruction',
      'first-flight',
      'grave-danger',
      'token-triumph',
      'draconic-domination',
      'vampiric-bloodlust',
      'heavenly-inferno',
      'plunder-the-graves',
      'invent-superiority',
      'eldrazi-unbound',
    ]);
    const printings = new Map(
      catalogs.flatMap((catalog) => catalog.cards).map((card) => [card.physicalId, card]),
    );
    for (const deck of format.decks) {
      expect(deck.commanders).toHaveLength(1);
      expect(deck.cards.reduce((sum, slot) => sum + slot.count, 0)).toBe(99);
      for (const slot of [...deck.commanders, ...deck.cards]) {
        expect(printings.get(slot.physicalId)?.correctedName).toBe(slot.name);
      }
    }
  });

  it('passes every precon through the Commander deck check, each inside its commander’s colors', () => {
    const printings = new Map(
      catalogs.flatMap((catalog) => catalog.cards).map((card) => [card.physicalId, card]),
    );
    expect(
      format.decks.map((deck) => {
        const verdict = checkCommanderDeck(deck, printings);
        return [deck.id, verdict.legal, verdict.cards, verdict.colorIdentity.join(''), verdict.findings];
      }),
    ).toEqual([
      ['chaos-incarnate', true, 100, 'BR', []],
      ['draconic-destruction', true, 100, 'RG', []],
      ['first-flight', true, 100, 'WU', []],
      ['grave-danger', true, 100, 'UB', []],
      ['token-triumph', true, 100, 'WG', []],
      ['draconic-domination', true, 100, 'WUBRG', []],
      ['vampiric-bloodlust', true, 100, 'WBR', []],
      ['heavenly-inferno', true, 100, 'WBR', []],
      ['plunder-the-graves', true, 100, 'BG', []],
      ['invent-superiority', true, 100, 'WUBR', []],
      ['eldrazi-unbound', true, 100, '', []],
    ]);
  });

  it('is the new-wave half of the format the shipped recipe describes, card for card', () => {
    const recipe = JSON.parse(readData('onboarding-format-v1.json')) as {
      decks: readonly {
        id: string;
        commanders: readonly { name: string }[];
        cards: readonly { name: string; count: number }[];
      }[];
    };
    expect(recipe.decks.map((deck) => deck.id)).toEqual(NEW_WAVE_DECK_IDS);
    for (const recipeDeck of recipe.decks) {
      const deck = format.decks.find((entry) => entry.id === recipeDeck.id)!;
      expect(deck.commanders.map((entry) => entry.name)).toEqual(
        recipeDeck.commanders.map((entry) => entry.name),
      );
      const counts = new Map<string, number>();
      for (const entry of recipeDeck.cards)
        counts.set(entry.name, (counts.get(entry.name) ?? 0) + entry.count);
      const built = new Map<string, number>();
      for (const slot of deck.cards) built.set(slot.name, (built.get(slot.name) ?? 0) + slot.count);
      expect(built).toEqual(counts);
    }
  });

  it('is the identity a probe suite would bind: the constructed format and its seven catalogs, checksums re-derived', () => {
    const verified = verifiedPrintedFormat(formatInput, catalogInputs);
    expect(verified.format.kind).toBe('printed-constructed-format');
    expect(verified.format.contentSha256).toBe(format.contentSha256);
    expect(verified.catalogs.map((entry) => entry.contentSha256)).toEqual(
      catalogs.map((catalog) => catalog.contentSha256),
    );
    const tampered = { ...(formatInput as Record<string, unknown>), name: 'Not the shipped decks' };
    expect(() => verifiedPrintedFormat(tampered, catalogInputs)).toThrow(/format checksum mismatch/u);
    expect(() => verifiedPrintedFormat(formatInput, [])).toThrow(/exactly the recipe source catalogs/u);
  });

  it('gives every token the seven catalogs create a printing the board can pick by name and color', () => {
    // The board matches a token by its engine name, then by color (`printingFor` in
    // packages/ui/src/routes/play/backend-position.ts), so a name alone is not enough:
    // Afterlife's white and black Spirit has no row even where a white Spirit does (#311).
    const sheet = parsePrintedTokenPrintings(
      JSON.parse(readData('commander-precons-token-printings-v1.json')),
    );
    const created = catalogTokenScriptReferences(
      [...new Set(catalogs.flatMap((catalog) => catalog.cards.map((card) => card.forgeScript)))],
      readForgeScriptArchive(),
    );
    const unbound = created.filter((reference) => {
      const file = `${reference}.txt`;
      const script = parseForgeTokenScript(file, readFileSync(`${FORGE_TOKEN_SCRIPTS_PATH}/${file}`, 'utf8'));
      if (script === undefined) throw new Error(`Forge token script ${file} states no token`);
      return !sheet.tokens.some(
        (token) =>
          token.observedNames.includes(script.name) && token.colors.join('') === script.colors.join(''),
      );
    });
    expect(created.length).toBeGreaterThan(100);
    expect(unbound).toEqual([]);
  }, 180_000);
});
