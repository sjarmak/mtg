/**
 * No referee seat can reach the balance sweep.
 *
 * ADR-0001 §2.4: "Refereed games are excluded from balance CI entirely." The
 * sweep's seats are `BotSpec`s — plain data with a closed `greedy | random`
 * union that a worker turns into an agent — so a referee cannot be named there
 * even by accident, and nothing in the sim or metrics packages imports this one.
 * That is a structural fact rather than a convention, and this test is what
 * keeps it one: wiring a referee into the sweep has to delete an assertion,
 * which is a decision somebody makes on purpose.
 *
 * Reading the tree rather than the types is deliberate — an import that only a
 * worker entry point makes would still be an import, and a type-level check
 * would not see it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGES = new URL('../../', import.meta.url).pathname;
const SELF = 'referee';

function sourceFiles(pkg: string): readonly string[] {
  const files: string[] = [];
  for (const dir of ['src', 'test', 'tools']) {
    walk(join(PACKAGES, pkg, dir), files);
  }
  return files;
}

function walk(dir: string, into: string[]): void {
  let entries: readonly { name: string; isDirectory: () => boolean }[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, into);
    else if (entry.name.endsWith('.ts')) into.push(path);
  }
}

function packageNames(): readonly string[] {
  return readdirSync(PACKAGES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

describe('the referee package', () => {
  it('is imported by no other package', () => {
    const importers = packageNames()
      .filter((pkg) => pkg !== SELF)
      .flatMap((pkg) =>
        sourceFiles(pkg).filter((file) => readFileSync(file, 'utf8').includes('@mtg/referee')),
      );
    expect(importers).toEqual([]);
  });

  it('is not a declared dependency of the sim or metrics packages', () => {
    for (const pkg of ['sim', 'metrics']) {
      const manifest = readFileSync(join(PACKAGES, pkg, 'package.json'), 'utf8');
      expect(manifest, `${pkg} declares @mtg/referee`).not.toContain('@mtg/referee');
    }
  });

  it('cannot be named as a seat in the sweep, because a seat is a closed union', () => {
    const bots = readFileSync(join(PACKAGES, 'sim', 'src', 'bots.ts'), 'utf8');
    const kinds = [...bots.matchAll(/kind: '([a-z]+)'/g)].map(([, kind]) => kind);
    expect([...new Set(kinds)].sort()).toEqual(['greedy', 'random']);
  });

  it('declares only the packages it actually imports', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(PACKAGES, SELF, 'package.json'), 'utf8'));
    const declared =
      typeof manifest === 'object' && manifest !== null && 'dependencies' in manifest
        ? Object.keys((manifest as { dependencies: Record<string, string> }).dependencies)
        : [];
    const imported = new Set(
      sourceFiles(SELF)
        .flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/from '(@mtg\/[a-z-]+)'/g)])
        .flatMap(([, name]) => (name === undefined || name === '@mtg/referee' ? [] : [name])),
    );
    expect([...imported].sort()).toEqual([...declared].sort());
  });
});
