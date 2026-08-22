/**
 * No two package barrels export the same name, unless `shared-exports.ts` says why.
 *
 * `mtg-bc2.68`'s four exported collisions accumulated silently across two beads
 * because nothing looked. The check that caught them looked at one pair —
 * `@mtg/deckbuild` against `@mtg/decklab` — and it was deleted into this file,
 * which asks the same question of every package at once. Its argument is
 * unchanged and is worth restating: a shared name is never a shared type, it is
 * two incompatible shapes wearing one label, and the cost only lands later, when
 * something imports both packages and has to alias half its imports, or when
 * somebody editing one package autocompletes the neighbor's symbol.
 *
 * A new collision is expected to FAIL here rather than be added to the list on
 * sight. Adding an entry means writing its reason first and finding it true.
 *
 * Two things this reads that a text search cannot:
 *
 *  - **Types.** Most of these names are interfaces and type aliases. An imported
 *    module object does not list a type at all, so `Object.keys` would report the
 *    surfaces as disjoint while `ColorSourceReport` meant two different things.
 *  - **Re-exports.** `@mtg/card-render` exports `costPips`, `TOKEN_CSS` and four
 *    more names that `@mtg/ui` also exports, and every one of them is `@mtg/ui`'s
 *    own declaration handed on one module deeper (ADR-0002 keeps one
 *    specification behind two renderers). Reading names off the barrel source
 *    would call those collisions and drown the real ones. So the check resolves
 *    each export to the declaration it binds and compares declaration sites: one
 *    site is one symbol, however many barrels name it.
 *
 * The price is a `ts.Program`, which is the only thing in this file that costs
 * anything. It is built once for the whole file and budgeted below.
 */
import { readdirSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { SHARED_EXPORTS } from './support/shared-exports';

const ROOT = new URL('../../../', import.meta.url).pathname;

/**
 * Measured on a quiet 16-core box: about 3s to parse and bind the 693 files the
 * package barrels reach. Budgeted well above that rather than at it, because
 * the cost is one program build shared by every test here and vitest's 5s
 * default leaves no room for a loaded box (`vitest.config.ts`, mtg-bc2.107).
 */
const PROGRAM_BUDGET_MS = 60_000;

interface Barrel {
  readonly pkg: string;
  readonly file: string;
}

/** Every package in the checkout, found on disk so a new one is covered on arrival. */
function barrels(): readonly Barrel[] {
  return readdirSync(`${ROOT}packages`, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ pkg: entry.name, file: `${ROOT}packages/${entry.name}/src/index.ts` }))
    .sort((a, b) => a.pkg.localeCompare(b.pkg));
}

/** The root tsconfig, so `@mtg/*` resolves inside this checkout and not through node_modules. */
function compilerOptions(): ts.CompilerOptions {
  const read = ts.readConfigFile(`${ROOT}tsconfig.json`, ts.sys.readFile);
  if (read.error !== undefined) {
    throw new Error(`tsconfig.json: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`);
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT);
  if (parsed.errors.length > 0) {
    const messages = parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, ' '));
    throw new Error(`tsconfig.json: ${messages.join('; ')}`);
  }
  return { ...parsed.options, noEmit: true };
}

/** Where a symbol is declared. Equal strings mean one symbol seen through two barrels. */
function declarationSite(symbol: ts.Symbol): string {
  const declarations = symbol.declarations ?? [];
  if (declarations.length === 0) throw new Error(`${symbol.name} resolves to no declaration`);
  return declarations
    .map((node) => `${node.getSourceFile().fileName}:${String(node.getStart())}`)
    .sort()
    .join(' ')
    .replace(ROOT, '');
}

/** Every exported name in the workspace, mapped to the packages and sites behind it. */
function exportedNames(): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const list = barrels();
  const program = ts.createProgram(
    list.map((barrel) => barrel.file),
    compilerOptions(),
  );
  const checker = program.getTypeChecker();
  const found = new Map<string, Map<string, string>>();

  for (const { pkg, file } of list) {
    const source = program.getSourceFile(file);
    if (source === undefined) throw new Error(`@mtg/${pkg} has no barrel at ${file}`);
    const moduleSymbol = checker.getSymbolAtLocation(source);
    if (moduleSymbol === undefined) throw new Error(`@mtg/${pkg}'s barrel is not a module`);
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const bound =
        (exported.flags & ts.SymbolFlags.Alias) === 0 ? exported : checker.getAliasedSymbol(exported);
      const sites = found.get(exported.name) ?? new Map<string, string>();
      sites.set(pkg, declarationSite(bound));
      found.set(exported.name, sites);
    }
  }
  return found;
}

let cached: ReadonlyMap<string, ReadonlyMap<string, string>> | undefined;
function workspaceExports(): ReadonlyMap<string, ReadonlyMap<string, string>> {
  cached ??= exportedNames();
  return cached;
}

/** `name: pkg, pkg` for every name two packages declare separately, sorted. */
function collisions(): readonly string[] {
  const lines: string[] = [];
  for (const [name, sites] of workspaceExports()) {
    if (new Set(sites.values()).size < 2) continue;
    lines.push(`${name}: ${[...sites.keys()].sort().join(', ')}`);
  }
  return lines.sort();
}

function allowed(): readonly string[] {
  return SHARED_EXPORTS.map((entry) => `${entry.name}: ${[...entry.packages].sort().join(', ')}`).sort();
}

describe('package export surfaces', { timeout: PROGRAM_BUDGET_MS }, () => {
  it('reads a real name out of a barrel, so an empty parse cannot pass the checks below', ({ task }) => {
    // Reads back the budget the runner applied: drop the describe option above
    // and this is 5000, so the docblock cannot outlive what it describes.
    expect(task.timeout, 'building a program over every barrel needs its own budget').toBe(PROGRAM_BUDGET_MS);

    expect([...(workspaceExports().get('assembleDeck')?.keys() ?? [])]).toEqual(['decklab']);
    expect([...(workspaceExports().get('buildManaBase')?.keys() ?? [])]).toEqual(['deckbuild']);
  });

  it('counts a name two barrels hand on from one declaration as one symbol', () => {
    // `@mtg/card-render` re-exports `@mtg/ui`'s `costPips` rather than deriving
    // its own pip run (ADR-0002). If this ever reports two sites, the packages
    // have grown a second pip specification and the collision list is not the
    // place to record it.
    const sites = workspaceExports().get('costPips');
    expect([...(sites?.keys() ?? [])].sort()).toEqual(['card-render', 'ui']);
    expect(new Set(sites?.values() ?? []).size).toBe(1);
  });

  it('shares no exported name across packages that the list does not explain', () => {
    expect(collisions().filter((line) => !allowed().includes(line))).toEqual([]);
  });

  it('keeps no entry for a collision that no longer exists', () => {
    expect(allowed().filter((line) => !collisions().includes(line))).toEqual([]);
  });
});
