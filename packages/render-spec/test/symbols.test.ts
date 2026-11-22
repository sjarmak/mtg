import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { oracleChunks, SYMBOL_TOKENS, symbolLabel } from '../src/symbols';

interface PrintedFormatRegistry {
  readonly formats: readonly {
    readonly id: string;
    readonly catalogs: readonly { readonly file: string }[];
  }[];
}

interface PrintedCardCatalog {
  readonly cards: readonly {
    readonly manaCost: string | null;
    readonly oracleText: string | null;
    readonly faces: readonly {
      readonly manaCost: string | null;
      readonly oracleText: string | null;
    }[];
  }[];
}

const dataRoot = new URL('../../data/data/', import.meta.url);
const registryPath = new URL('printed-formats-v1.json', dataRoot);

function catalogPaths(): readonly string[] {
  if (!existsSync(registryPath)) return [];
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as PrintedFormatRegistry;
  return [
    ...new Set(
      registry.formats.flatMap((format) => format.catalogs.map((catalog) => join(format.id, catalog.file))),
    ),
  ];
}

function cardText(catalog: PrintedCardCatalog): readonly string[] {
  return catalog.cards.flatMap((card) =>
    [
      card.manaCost,
      card.oracleText,
      ...card.faces.flatMap((face) => [face.manaCost, face.oracleText]),
    ].filter((value): value is string => value !== null),
  );
}

describe('printed symbol vocabulary', () => {
  it('parses and names energy counters', () => {
    expect(oracleChunks('Pay {E}{E}')).toEqual([
      { kind: 'text', text: 'Pay ' },
      { kind: 'symbol', token: 'E', text: '{E}' },
      { kind: 'symbol', token: 'E', text: '{E}' },
    ]);
    expect(symbolLabel('E')).toBe('one energy counter');
  });

  const catalogs = catalogPaths();
  const missingCatalogs = catalogs.filter((path) => !existsSync(new URL(path, dataRoot)));
  const audit = existsSync(registryPath) && missingCatalogs.length === 0 ? it : it.skip;

  audit('covers every brace token in every staged printed catalog', () => {
    const found = new Set<string>();
    for (const path of catalogs) {
      const catalog = JSON.parse(readFileSync(new URL(path, dataRoot), 'utf8')) as PrintedCardCatalog;
      for (const text of cardText(catalog)) {
        for (const match of text.matchAll(/\{([^{}]*)\}/g)) found.add(match[1] ?? '');
      }
    }

    expect([...found].filter((token) => !SYMBOL_TOKENS.includes(token)).sort()).toEqual([]);
  });

  if (!existsSync(registryPath) || missingCatalogs.length > 0) {
    it.skip(`catalog audit requires the installed printed catalogs (${missingCatalogs.join(', ') || 'registry absent'})`, () =>
      undefined);
  }
});
