/**
 * What `import type` is quietly buying this workspace, stated as a number and
 * held to it.
 *
 * Counting every import edge, `packages/<pkg>/src` has 17 cyclic groups spread
 * over 10 packages. Counting only the edges that survive compilation — a value
 * import, a side-effect import, a re-export — it has 5, in 4 packages. The
 * difference is entirely `import type`, which `eslint.config.js` already makes
 * mandatory (`@typescript-eslint/consistent-type-imports: 'error'`) and which
 * erases before anything runs. A type-only loop is a loop in the type graph and
 * nothing at run time: no module initialization order depends on it, no bundler
 * has to break it, and `@mtg/ui`'s 270 files and `@mtg/dsl-coverage`'s 188 are
 * acyclic at run time only because of it.
 *
 * That discipline is doing architectural work and, until this file, nothing
 * named it as such. The lint rule is spelled as a style preference and the
 * property it produces was invisible. So the gate is "no new ones": every
 * package that has no value-import cycle keeps having none, and the five that do
 * are named below with the reason each one exists. A sixth has to argue for
 * itself here, in the same file, before it can be added.
 *
 * # What counts as an edge
 *
 * A specifier is a value edge when the import it belongs to still exists after
 * type erasure: a plain `import`, an `import` whose named bindings are not all
 * inline `type`, a bare `import './x'` (the side effect is the point), a
 * `export … from` that is not `export type`, and a dynamic `import('./x')`.
 * `import type`, an all-`type` binding list and `import('./x').Thing` in a type
 * position all erase and are not edges. Only relative specifiers are resolved:
 * an arrow between two packages is `package-surfaces.test.ts`'s question and is
 * declared there.
 *
 * # Why a parse and not a program
 *
 * `package-surfaces.test.ts` builds a `ts.Program` over the same files and takes
 * about a minute, because it resolves symbols to their declaration sites. This
 * question needs the specifier text and whether the import erases, both of which
 * are in the syntax, so it parses each file on its own and finishes in about two
 * seconds.
 *
 * # Why the pin is a count per package and not a file list
 *
 * The kernel's cycle is one strongly-connected component of 17 files, and a card
 * lane that adds a module `zones.ts` reaches and that reaches `layers.ts` puts
 * an eighteenth file inside it without making a new architectural decision. A
 * pinned membership list would go red on that and be re-pinned unread, which is
 * worse than no gate. A count goes red on the thing worth stopping: a package
 * that had no run-time cycle growing one. Each grandfathered entry also names
 * the files its reason is about, and those are asserted to still be in a cycle,
 * so an entry cannot outlive the cycle it excuses.
 *
 * Scope is `packages/<pkg>/src`, matching `package-surfaces.test.ts`: `test/`
 * and `tools/` are leaves nothing imports, and a cycle between two of them says
 * nothing about the shipped shape.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../', import.meta.url).pathname;

/** A cycle that is in the shipped tree on purpose, with the reason it is. */
interface Grandfathered {
  readonly pkg: string;
  /** The files the reason is about. Asserted to still be inside a cycle. */
  readonly files: readonly string[];
  readonly why: string;
}

/**
 * The five, measured 2026-08-28 (`mtg-31xc`).
 *
 * Four of them are domain recursion: the domain being modeled is itself
 * self-referential, so breaking the loop means inserting an injection seam that
 * buys nothing and hides the recursion from the reader. The fifth is named as
 * the one that could be broken cheaply, and `mtg-31xc.1` holds that work.
 */
const GRANDFATHERED: readonly Grandfathered[] = [
  {
    pkg: 'dsl',
    files: ['validate/abilities.ts', 'validate/effects.ts'],
    why: 'An ability holds effects and an effect can hold an ability, so the two validators are mutually recursive by the grammar itself.',
  },
  {
    pkg: 'forge-export',
    files: ['ability-script.ts', 'effect-script.ts'],
    why: "The same recursion one layer out, in the target grammar: transpileAbility renders its effects, and transpileEffect renders a sub-ability through Forge's SubAbility chain.",
  },
  {
    pkg: 'kernel',
    files: ['layers.ts', 'abilities.ts', 'target-filter.ts', 'zones.ts', 'cost.ts', 'mana.ts'],
    why: 'Two recursions the rules have, knitted into one 17-file component. CR 613 is self-referential by construction — which objects an effect applies to depends on characteristics the layer walk is computing — so layers.ts, abilities.ts and target-filter.ts close a loop. Paying a cost taps a permanent, tapping is a zone operation, and registering a cost modifier is a battlefield event, so zones.ts, cost.ts and mana.ts close another. target-filter.ts reaching stack-spell.ts and zones.ts importing nine of its neighbors join the two.',
  },
  {
    pkg: 'deckbuild',
    files: ['deck-context.ts', 'evaluate.ts'],
    why: "A card's value depends on the deck around it — evaluate.ts reads supplies and expected bodies from deck-context.ts — and assembling that context needs the evaluator's own judgments, activationRate and isRemovalCard. Neither half can be computed first.",
  },
  {
    pkg: 'deckbuild',
    files: ['config.ts', 'config-unknown-keys.ts'],
    why: 'The one here that is not domain recursion. config-unknown-keys.ts derives the admissible key set from the default config objects so the check cannot drift from the shape it checks, and config.ts calls it on load. Moving the defaults to a module of their own would break it; mtg-31xc.1 holds that.',
  },
];

/** Every package with a `src/`, found on disk so a new one is covered on arrival. */
function packages(): readonly string[] {
  return readdirSync(`${ROOT}packages`, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        statSync(`${ROOT}packages/${entry.name}/src`, { throwIfNoEntry: false })?.isDirectory() === true,
    )
    .map((entry) => entry.name)
    .sort();
}

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sources(path, found);
    else if (path.endsWith('.ts') || path.endsWith('.tsx')) found.push(path);
  }
  return found;
}

/** Every specifier in a file whose import survives type erasure. See the docblock. */
function valueSpecifiers(file: string): readonly string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const allInlineType =
        clause?.name === undefined &&
        bindings !== undefined &&
        ts.isNamedImports(bindings) &&
        bindings.elements.every((element) => element.isTypeOnly);
      if (clause === undefined || (clause.isTypeOnly !== true && allInlineType !== true))
        found.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.exportClause;
      const allInlineType =
        clause !== undefined &&
        ts.isNamedExports(clause) &&
        clause.elements.every((element) => element.isTypeOnly);
      if (!node.isTypeOnly && !allInlineType) found.push(node.moduleSpecifier.text);
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

/** A relative specifier as the file it names, or null when it names none. */
function resolve(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const segments = `${from.slice(0, from.lastIndexOf('/'))}/${specifier}`.split('/');
  const path: string[] = [];
  for (const segment of segments) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') path.pop();
    else path.push(segment);
  }
  const base = `/${path.join('/')}`;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile() === true) return candidate;
  }
  return null;
}

/** Tarjan's strongly-connected components, smallest identity first within each. */
function components(
  nodes: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>,
): readonly (readonly string[])[] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];
  let next = 0;
  const walk = (node: string): void => {
    index.set(node, next);
    low.set(node, next);
    next += 1;
    stack.push(node);
    onStack.add(node);
    for (const target of edges.get(node) ?? []) {
      if (!index.has(target)) {
        walk(target);
        low.set(node, Math.min(low.get(node) ?? 0, low.get(target) ?? 0));
      } else if (onStack.has(target)) {
        low.set(node, Math.min(low.get(node) ?? 0, index.get(target) ?? 0));
      }
    }
    if (low.get(node) !== index.get(node)) return;
    const component: string[] = [];
    for (;;) {
      const popped = stack.pop();
      if (popped === undefined) break;
      onStack.delete(popped);
      component.push(popped);
      if (popped === node) break;
    }
    found.push(component.sort());
  };
  for (const node of nodes) if (!index.has(node)) walk(node);
  return found;
}

/** Every value-import cycle in one package's `src/`, as paths relative to it. */
function cyclesIn(pkg: string): readonly (readonly string[])[] {
  const root = `${ROOT}packages/${pkg}/src`;
  const files = sources(root).sort();
  const edges = new Map<string, readonly string[]>();
  for (const file of files) {
    const targets: string[] = [];
    for (const specifier of valueSpecifiers(file)) {
      const target = resolve(file, specifier);
      if (target !== null && target !== file && !targets.includes(target)) targets.push(target);
    }
    edges.set(file, targets);
  }
  return components(files, edges)
    .filter((component) => component.length > 1)
    .map((component) => component.map((file) => file.slice(root.length + 1)));
}

const measured = new Map(packages().map((pkg) => [pkg, cyclesIn(pkg)]));

describe('value-import cycles', () => {
  it('has none outside the five that are named and argued', () => {
    const expected = new Map(
      packages().map((pkg) => [pkg, GRANDFATHERED.filter((entry) => entry.pkg === pkg).length]),
    );
    const actual = new Map([...measured].map(([pkg, cycles]) => [pkg, cycles.length]));
    const report = [...actual]
      .filter(([pkg, count]) => count !== expected.get(pkg))
      .map(
        ([pkg, count]) =>
          `${pkg}: ${String(count)} cyclic groups, expected ${String(expected.get(pkg) ?? 0)} — ${(measured.get(pkg) ?? []).map((cycle) => `[${cycle.join(', ')}]`).join(' ')}`,
      );
    expect(
      report,
      'a run-time module cycle changed. Adding one means adding an entry to GRANDFATHERED with the reason it has to exist; removing one means deleting its entry',
    ).toEqual([]);
  });

  it('excuses no cycle that has already been broken', () => {
    const stale = GRANDFATHERED.filter((entry) => {
      const cycles = measured.get(entry.pkg) ?? [];
      return !entry.files.every((file) => cycles.some((cycle) => cycle.includes(file)));
    }).map((entry) => `${entry.pkg}: ${entry.files.join(', ')}`);
    expect(
      stale,
      'a grandfathered cycle is gone or has moved. Delete its entry rather than leaving the excuse behind',
    ).toEqual([]);
  });

  it('reads a type-only loop as no loop at all', () => {
    // The property the whole file rests on, asserted on the largest subject in
    // the workspace: @mtg/ui has two cyclic groups counting every import edge
    // and none counting the edges that survive erasure.
    expect(measured.get('ui')).toEqual([]);
    expect(measured.get('dsl-coverage')).toEqual([]);
  });
});
