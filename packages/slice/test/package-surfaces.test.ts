/**
 * Two facts about the workspace that only a `ts.Program` over every package can
 * state: what the barrels export, and which arrows the sources draw.
 *
 * ## No two barrels export the same name, unless `shared-exports.ts` says why
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
 * ## Every `@mtg/*` arrow a package's source draws is on its declared list
 *
 * `mtg-gbhg`: the dependency arrows are argued at length in `CLAUDE.md` and in
 * `docs/adr/`, and until this test they were enforced for one package —
 * `@mtg/card-geometry`, whose own suite fails when it reaches past `@mtg/dsl`.
 * Prose is not a gate. The arrows that matter most are the ones that would cost
 * the most to reverse and are the easiest to reverse by accident: a browser
 * bundle pulling in `better-sqlite3` through a convenience import, or
 * `@mtg/engine` growing a line to the kernel it was split out to avoid.
 *
 * The table below is the declaration and `DECLARED_ARROWS` is checked both ways —
 * an arrow the source draws and the table does not name fails, and an arrow the
 * table names and the source no longer draws fails too, so the table cannot
 * quietly become a wish. When a new edge closes a loop the message names the
 * declared path it reverses, because "undeclared import" and "cycle" are
 * different problems and the second one is the expensive one.
 *
 * **Scope: `src/`.** Every `.ts` and `.tsx` file under `packages/<pkg>/src`, which
 * is what the package ships. `tools/` and `test/` are deliberately outside it and
 * their edges are real: `@mtg/ui`'s launchers import `@mtg/image-cache` and
 * `@mtg/raster` by design (both are Node-only staging steps, `CLAUDE.md`), and
 * the test trees draw arrows that would be cycles if they shipped — `@mtg/dsl`'s
 * suite imports `@mtg/setgen` for a fixture, `@mtg/kernel`'s imports `@mtg/ui`.
 * A test imports whatever it needs to test; it ships nothing, so it reverses
 * nothing. Widening the scope means declaring those edges, not silencing them.
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
 * Measured on a quiet 16-core box: about 1.4s to parse and bind the 980 files
 * under `packages/<pkg>/src`. Budgeted well above that rather than at it, because
 * the cost is one program build shared by every test here and vitest's 5s
 * default leaves no room for a loaded box (`vitest.config.ts`, mtg-bc2.107).
 */
const PROGRAM_BUDGET_MS = 60_000;

/**
 * The `@mtg/*` imports each package's `src/` is allowed to draw, and nothing
 * else. Sorted, and one line per package so a diff reads as an arrow.
 *
 * A package with no arrows states why the emptiness is load-bearing, because
 * "imports nothing today" and "must import nothing" look identical in a table
 * and only the second one is worth failing a build over.
 */
const DEPENDENCY_FREE: ReadonlyMap<string, string> = new Map([
  ['dsl', 'the vocabulary every other package speaks; it may not know who speaks it'],
  [
    'engine',
    'the backend-neutral session contract: a foreign backend takes it without taking our kernel (ADR-0001 §9)',
  ],
  [
    'image-cache',
    'carries no third-party dependency, which is what lets @mtg/ui take it without better-sqlite3 reaching a browser bundle',
  ],
  [
    'printed-card',
    'the portable printed-card schema may be read by Node producers and browsers without importing a rules model',
  ],
  ['raster', 'a PNG codec and a resampler split out of @mtg/art (mtg-cax8) so a browser bundle can take it'],
]);

const DECLARED_ARROWS: ReadonlyMap<string, readonly string[]> = new Map([
  ['bot-evidence', ['dsl']],
  ['card-geometry', ['dsl']],
  ['card-render', ['card-geometry', 'dsl', 'render-spec']],
  ['cube', ['data', 'deckbuild', 'decklab', 'draft-export', 'dsl', 'llm', 'setgen']],
  ['data', ['dsl', 'printed-card']],
  ['deckbuild', ['dsl']],
  [
    'decklab',
    ['bot-evidence', 'data', 'deckbuild', 'dsl', 'kernel', 'llm', 'metrics', 'printed-card', 'sim'],
  ],
  ['design-data', ['dsl']],
  // Physical printed drafts consume the portable recipe/catalog contract, never Node card storage.
  ['draft-export', ['bot-evidence', 'deckbuild', 'dsl', 'limited', 'printed-card']],
  ['dsl', []],
  ['engine', []],
  ['forge-export', ['bot-evidence', 'dsl', 'engine']],
  ['image-cache', []],
  ['kernel', ['dsl', 'engine']],
  ['limited', ['engine']],
  ['llm', ['dsl']],
  // Printed Cube calibration reuses portable cards, physical deck validation, and the Forge subprocess seam.
  [
    'metrics',
    [
      'bot-evidence',
      'deckbuild',
      'draft-export',
      'dsl',
      'engine',
      'forge-export',
      'kernel',
      'limited',
      'printed-card',
      'sim',
    ],
  ],
  ['netplay', ['deckbuild', 'draft-export', 'dsl', 'engine', 'kernel']],
  ['printed-card', []],
  ['raster', []],
  ['render-spec', ['card-geometry', 'dsl']],
  ['referee', ['dsl', 'kernel', 'llm']],
  ['setgen', ['card-geometry', 'data', 'deckbuild', 'design-data', 'dsl', 'llm']],
  ['sim', ['bot-evidence', 'dsl', 'engine', 'kernel']],
  ['slice', ['data', 'deckbuild', 'dsl', 'forge-export', 'kernel', 'llm', 'metrics', 'setgen', 'sim']],
  [
    'ui',
    [
      'card-geometry',
      'deckbuild',
      'draft-export',
      'dsl',
      'engine',
      'kernel',
      'limited',
      'netplay',
      'printed-card',
      'render-spec',
      'sim',
    ],
  ],
]);

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

/**
 * Every source file each package ships. The barrels alone reach 941 of these
 * 980; a src module nothing re-exports is still shipped code that can draw an
 * arrow, so the program is rooted at all of them rather than at the barrels.
 */
function packageSources(): readonly string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (path.endsWith('.ts') || path.endsWith('.tsx')) found.push(path);
    }
  };
  for (const { pkg } of barrels()) walk(`${ROOT}packages/${pkg}/src`);
  return found.sort();
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

let cachedProgram: ts.Program | undefined;
/** One program for the whole file: both questions below need the same parse. */
function workspaceProgram(): ts.Program {
  cachedProgram ??= ts.createProgram(packageSources(), compilerOptions());
  return cachedProgram;
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
  const program = workspaceProgram();
  const checker = program.getTypeChecker();
  const found = new Map<string, Map<string, string>>();

  for (const { pkg, file } of barrels()) {
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

/**
 * Every module specifier a file names, wherever it names it. Top-level `import`
 * and `export … from` are the whole of it today; a dynamic `import()` and an
 * `import('…').Type` are the two ways a future edge could hide from a walk over
 * statements, so this walks the tree instead.
 */
function specifiers(source: ts.SourceFile): readonly string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier !== undefined && ts.isStringLiteral(specifier)) found.push(specifier.text);
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
        found.push(argument.literal.text);
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** `owner -> target -> the first src file that draws it`, over `packages/<pkg>/src` only. */
function drawnArrows(): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const prefix = `${ROOT}packages/`;
  const drawn = new Map<string, Map<string, string>>();
  for (const source of workspaceProgram().getSourceFiles()) {
    if (!source.fileName.startsWith(prefix)) continue;
    const relative = source.fileName.slice(prefix.length);
    const owner = relative.split('/')[0] ?? '';
    if (!relative.startsWith(`${owner}/src/`)) continue;
    for (const specifier of specifiers(source)) {
      if (!specifier.startsWith('@mtg/')) continue;
      const target = specifier.slice('@mtg/'.length).split('/')[0] ?? '';
      if (target === owner || target === '') continue;
      const targets = drawn.get(owner) ?? new Map<string, string>();
      drawn.set(owner, targets);
      if (!targets.has(target)) targets.set(target, relative);
    }
  }
  return drawn;
}

/** The declared path from `from` to `to`, shortest first, or null when there is none. */
function declaredPath(from: string, to: string): readonly string[] | null {
  const queue: (readonly string[])[] = [[from]];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const path = queue.shift() ?? [];
    const head = path[path.length - 1] ?? '';
    if (head === to) return path;
    for (const next of DECLARED_ARROWS.get(head) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}

/** One line per arrow the source draws that the table does not declare. */
function undeclaredArrows(): readonly string[] {
  const lines: string[] = [];
  for (const [owner, targets] of drawnArrows()) {
    const declared = DECLARED_ARROWS.get(owner);
    for (const [target, file] of targets) {
      if (declared?.includes(target) === true) continue;
      const back = declaredPath(target, owner);
      const verdict =
        back === null
          ? `an edge no package list declares`
          : `reversing the declared arrow ${back.join(' -> ')}`;
      lines.push(`${owner} -> ${target} (${file}): ${verdict}`);
    }
  }
  return lines.sort();
}

/** One line per arrow the table declares that no src file draws any more. */
function staleArrows(): readonly string[] {
  const drawn = drawnArrows();
  const lines: string[] = [];
  for (const [owner, targets] of DECLARED_ARROWS) {
    for (const target of targets) {
      if (drawn.get(owner)?.has(target) === true) continue;
      lines.push(`${owner} -> ${target}: declared, drawn by no file under ${owner}/src`);
    }
  }
  return lines.sort();
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
    // `@mtg/render-spec` declares `costPips` and both renderers hand it on
    // rather than deriving their own pip run (ADR-0002). If this ever reports
    // two sites, the packages have grown a second pip specification and the
    // collision list is not the place to record it.
    const sites = workspaceExports().get('costPips');
    expect([...(sites?.keys() ?? [])].sort()).toEqual(['card-render', 'render-spec', 'ui']);
    expect(new Set(sites?.values() ?? []).size).toBe(1);
  });

  it('shares no exported name across packages that the list does not explain', () => {
    expect(collisions().filter((line) => !allowed().includes(line))).toEqual([]);
  });

  it('keeps no entry for a collision that no longer exists', () => {
    expect(allowed().filter((line) => !collisions().includes(line))).toEqual([]);
  });
});

describe('package dependency arrows', { timeout: PROGRAM_BUDGET_MS }, () => {
  it('declares an arrow list for every package on disk and for nothing else', () => {
    const onDisk = barrels().map((barrel) => barrel.pkg);
    expect([...DECLARED_ARROWS.keys()].sort()).toEqual([...onDisk].sort());
  });

  it('reads a real arrow out of a source file, so an empty walk cannot pass the checks below', () => {
    // `@mtg/kernel` imports both of its declared targets, and `@mtg/dsl` imports
    // neither of anything. If the walk silently found nothing, the two failing
    // checks below would both pass on an empty set.
    expect([...(drawnArrows().get('kernel')?.keys() ?? [])].sort()).toEqual(['dsl', 'engine']);
    expect(drawnArrows().get('dsl')).toBeUndefined();
  });

  it('draws no @mtg arrow out of a package that its list does not declare', () => {
    expect(undeclaredArrows()).toEqual([]);
  });

  it('declares no arrow that the source no longer draws', () => {
    expect(staleArrows()).toEqual([]);
  });

  it('says why each dependency-free package must stay that way', () => {
    const empty = [...DECLARED_ARROWS].filter(([, targets]) => targets.length === 0).map(([pkg]) => pkg);
    expect(empty.sort()).toEqual([...DEPENDENCY_FREE.keys()].sort());
    for (const pkg of empty) {
      expect((DEPENDENCY_FREE.get(pkg) ?? '').length, `@mtg/${pkg} states no reason`).toBeGreaterThan(20);
    }
  });

  it('names the arrow a new edge would reverse', () => {
    // The message is the whole point of the check: an undeclared import and a
    // cycle are different problems, and the second one is the expensive one.
    expect(declaredPath('dsl', 'ui')).toBeNull();
    expect(declaredPath('ui', 'dsl')).toEqual(['ui', 'dsl']);
    expect(declaredPath('slice', 'engine')).toEqual(['slice', 'forge-export', 'engine']);
  });
});
