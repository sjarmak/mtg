import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PrintedFormatRecipeSchema } from '../src/printed-card/format-build';
import { parseForgeDeckFile } from '../src/printed-card/forge-deck-file';
import { preconDeckId, preconRecipe } from '../src/printed-card/precon-recipe';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const rules = { variant: 'commander' as const, startingLife: 40 };
const deck = parseForgeDeckFile(
  '[metadata]\nName=Token Triumph [SCD] [2022]\nSet=SCD\n[Commander]\n1 Emmara, Soul of the Accord|SCD|1\n[Main]\n1 Arcane Signet|SCD|1\n12 Plains|SCD|2\n1 Sol Ring\n[Sideboard]\n',
);

describe('precon recipe from Forge deck files', () => {
  it('states each precon as names, set codes and counts under the format rules, and pins the sets it names', () => {
    const recipe = preconRecipe([deck], { id: 'scd', name: 'Starter Commander Decks 2022', rules });
    expect(PrintedFormatRecipeSchema.parse(recipe)).toEqual(recipe);
    expect(recipe).toEqual({
      schemaVersion: 1,
      kind: 'constructed',
      id: 'scd',
      name: 'Starter Commander Decks 2022',
      sourceCodes: ['SCD'],
      rules,
      decks: [
        {
          id: 'token-triumph',
          name: 'Token Triumph',
          commanders: [{ name: 'Emmara, Soul of the Accord', setCode: 'SCD' }],
          cards: [
            { name: 'Arcane Signet', setCode: 'SCD', count: 1 },
            { name: 'Plains', setCode: 'SCD', count: 12 },
            { name: 'Sol Ring', count: 1 },
          ],
        },
      ],
    });
  });

  it('drops the edition and year suffix from a deck id and keeps the rest', () => {
    expect(preconDeckId('Draconic Rage [AFC] [2021]')).toBe('draconic-rage');
    expect(preconDeckId("Ur-Dragon's Hoard")).toBe('ur-dragon-s-hoard');
    expect(() => preconDeckId('[C13]')).toThrow(/slugifies to nothing/);
  });

  it('refuses a precon with a sideboard and a set of files naming no edition', () => {
    const withSideboard = { ...deck, sideboard: [{ name: 'Extra', count: 1 }] };
    expect(() => preconRecipe([withSideboard], { id: 'scd', name: 'x', rules })).toThrow(/sideboard/);
    const unpinned = { ...deck, commanders: [{ name: 'A', count: 1 }], main: [{ name: 'B', count: 1 }] };
    expect(() => preconRecipe([unpinned], { id: 'scd', name: 'x', rules })).toThrow(/nothing to pin/);
    expect(() => preconRecipe([], { id: 'scd', name: 'x', rules })).toThrow(/No precon/);
  });

  it('imports every precon of one edition through the CLI, into a recipe the builder schema accepts', () => {
    const root = mkdtempSync(join(tmpdir(), 'forge-precons-'));
    roots.push(root);
    writeFileSync(
      join(root, 'Token Triumph [SCD] [2022].dck'),
      '[metadata]\nName=Token Triumph [SCD] [2022]\nSet=SCD\n[Commander]\n1 Emmara, Soul of the Accord|SCD|1\n[Main]\n99 Plains|SCD|1\n',
    );
    writeFileSync(
      join(root, 'Other [C20] [2020].dck'),
      '[metadata]\nName=Other [C20] [2020]\nSet=C20\n[Commander]\n1 Kalamax, the Stormsire+|C20\n[Main]\n99 Island|C20|1\n',
    );
    const tool = fileURLToPath(new URL('../tools/import-forge-precons.ts', import.meta.url));
    const out = join(root, 'recipe.json');
    const run = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        tool,
        '--precons',
        root,
        '--set',
        'scd',
        '--id',
        'scd',
        '--name',
        'SCD',
        '--out',
        out,
      ],
      { encoding: 'utf8', timeout: 20000 },
    );
    expect(run.status, run.stderr).toBe(0);
    const recipe = PrintedFormatRecipeSchema.parse(JSON.parse(readFileSync(out, 'utf8')));
    expect(recipe.kind).toBe('constructed');
    if (recipe.kind !== 'constructed') throw new Error('unreachable');
    expect(recipe.decks.map((entry) => entry.id)).toEqual(['token-triumph']);
    expect(JSON.parse(run.stdout)).toMatchObject({
      decks: ['Token Triumph [SCD] [2022].dck'],
      sourceCodes: ['SCD'],
    });
    const again = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        tool,
        '--precons',
        root,
        '--set',
        'scd',
        '--id',
        'scd',
        '--name',
        'SCD',
        '--out',
        out,
      ],
      { encoding: 'utf8', timeout: 20000 },
    );
    expect(again.status).not.toBe(0);
  });

  it('names decks one by one across products with repeatable --deck, alongside --set', () => {
    const root = mkdtempSync(join(tmpdir(), 'forge-precons-deck-flag-'));
    roots.push(root);
    writeFileSync(
      join(root, 'Token Triumph [SCD] [2022].dck'),
      '[metadata]\nName=Token Triumph [SCD] [2022]\nSet=SCD\n[Commander]\n1 Emmara, Soul of the Accord|SCD|1\n[Main]\n99 Plains|SCD|1\n',
    );
    const elsewhere = mkdtempSync(join(tmpdir(), 'forge-precons-elsewhere-'));
    roots.push(elsewhere);
    const namedDeck = join(elsewhere, 'Elven Empire [KHC] [2024].dck');
    writeFileSync(
      namedDeck,
      '[metadata]\nName=Elven Empire [KHC] [2024]\nSet=KHC\n[Commander]\n1 Lathril, Blade of the Elves|KHC|1\n[Main]\n99 Forest|KHC|1\n',
    );
    const tool = fileURLToPath(new URL('../tools/import-forge-precons.ts', import.meta.url));
    const out = join(root, 'recipe.json');
    const run = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        tool,
        '--precons',
        root,
        '--set',
        'scd',
        '--deck',
        namedDeck,
        '--id',
        'commander-precons',
        '--name',
        'Commander Preconstructed Decks',
        '--out',
        out,
      ],
      { encoding: 'utf8', timeout: 20000 },
    );
    expect(run.status, run.stderr).toBe(0);
    const recipe = PrintedFormatRecipeSchema.parse(JSON.parse(readFileSync(out, 'utf8')));
    expect(recipe.kind).toBe('constructed');
    if (recipe.kind !== 'constructed') throw new Error('unreachable');
    expect(recipe.decks.map((entry) => entry.id)).toEqual(['token-triumph', 'elven-empire']);
    expect(recipe.sourceCodes).toEqual(['SCD', 'KHC']);
    expect(JSON.parse(run.stdout)).toMatchObject({
      decks: ['Token Triumph [SCD] [2022].dck', namedDeck],
      sourceCodes: ['SCD', 'KHC'],
    });
  });

  it('names decks by --deck alone, with no --precons or --set', () => {
    const root = mkdtempSync(join(tmpdir(), 'forge-precons-deck-only-'));
    roots.push(root);
    const namedDeck = join(root, 'Elven Empire [KHC] [2024].dck');
    writeFileSync(
      namedDeck,
      '[metadata]\nName=Elven Empire [KHC] [2024]\nSet=KHC\n[Commander]\n1 Lathril, Blade of the Elves|KHC|1\n[Main]\n99 Forest|KHC|1\n',
    );
    const tool = fileURLToPath(new URL('../tools/import-forge-precons.ts', import.meta.url));
    const out = join(root, 'recipe.json');
    const run = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        tool,
        '--deck',
        namedDeck,
        '--id',
        'elven-empire',
        '--name',
        'Elven Empire',
        '--out',
        out,
      ],
      { encoding: 'utf8', timeout: 20000 },
    );
    expect(run.status, run.stderr).toBe(0);
    const recipe = PrintedFormatRecipeSchema.parse(JSON.parse(readFileSync(out, 'utf8')));
    expect(recipe.kind).toBe('constructed');
    if (recipe.kind !== 'constructed') throw new Error('unreachable');
    expect(recipe.decks.map((entry) => entry.id)).toEqual(['elven-empire']);
  });

  it('refuses --precons without --set and refuses naming no deck at all', () => {
    const root = mkdtempSync(join(tmpdir(), 'forge-precons-refusal-'));
    roots.push(root);
    const tool = fileURLToPath(new URL('../tools/import-forge-precons.ts', import.meta.url));
    const out = join(root, 'recipe.json');
    const missingSet = spawnSync(
      process.execPath,
      ['--import', 'tsx', tool, '--precons', root, '--id', 'x', '--name', 'x', '--out', out],
      { encoding: 'utf8', timeout: 20000 },
    );
    expect(missingSet.status).not.toBe(0);
    const missingSelection = spawnSync(
      process.execPath,
      ['--import', 'tsx', tool, '--id', 'x', '--name', 'x', '--out', out],
      { encoding: 'utf8', timeout: 20000 },
    );
    expect(missingSelection.status).not.toBe(0);
  });
});
