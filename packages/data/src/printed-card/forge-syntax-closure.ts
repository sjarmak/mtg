/**
 * Closure of Forge card scripts over the reviewed syntax table.
 *
 * A script is closed when every syntax token it uses has a reviewed entry; a
 * closed script's controller-decision families are then known without a
 * per-card lane. This module measures that over the whole installed library
 * and per Forge edition, so a set's admission cost is a token count rather
 * than a card count.
 */
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { inventoryForgeScriptSyntax } from '@mtg/printed-card/node';
import { InvalidInputError } from '../errors';
import { forgeSyntaxKey, type ForgeSyntaxReview } from './forge-syntax-review';

export interface ForgeEditionCards {
  readonly code: string;
  readonly name: string;
  readonly cards: readonly string[];
}

/** Reads the `[metadata]` code and name and the `[cards]` names of one `res/editions/*.txt`. */
export function parseForgeEditionCards(text: string): ForgeEditionCards {
  const sections = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const header = /^\[(.+)\]$/u.exec(line);
    if (header?.[1] !== undefined) {
      current = [];
      sections.set(header[1], current);
      continue;
    }
    current?.push(line);
  }
  const metadata = new Map(
    (sections.get('metadata') ?? []).flatMap((line) => {
      const separator = line.indexOf('=');
      return separator === -1 ? [] : [[line.slice(0, separator), line.slice(separator + 1)] as const];
    }),
  );
  const code = metadata.get('Code');
  const name = metadata.get('Name');
  if (code === undefined || name === undefined) {
    throw new InvalidInputError('Forge edition', 'missing [metadata] Code or Name');
  }
  const cards = (sections.get('cards') ?? []).flatMap((line) => {
    const match = /^\S+\s+[A-Z]\s+(.+?)(?:\s+@.*)?$/u.exec(line);
    return match?.[1] === undefined ? [] : [match[1]];
  });
  return { code, name, cards: [...new Set(cards)] };
}

export const FORGE_SYNTAX_CLOSURE_SNAPSHOT_PATH = fileURLToPath(
  new URL('../../data/forge-syntax-closure-v1.json', import.meta.url),
);

export const ForgeSyntaxClosureSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('forge-syntax-closure-snapshot'),
  forge: z.strictObject({ version: z.string().min(1), jarSha256: z.string().regex(/^[a-f0-9]{64}$/u) }),
  reviewedTokens: z.number().int().nonnegative(),
  library: z.strictObject({
    scripts: z.number().int().nonnegative(),
    closed: z.number().int().nonnegative(),
  }),
  editions: z.array(
    z.strictObject({
      code: z.string().min(1),
      cards: z.number().int().nonnegative(),
      closed: z.number().int().nonnegative(),
    }),
  ),
});
export type ForgeSyntaxClosureSnapshot = z.infer<typeof ForgeSyntaxClosureSnapshotSchema>;

export interface ForgeSyntaxClosureEdition {
  readonly code: string;
  readonly name: string;
  /** Distinct card names the edition lists. */
  readonly cards: number;
  /** Names that resolve to a script in the archive. */
  readonly scripted: number;
  readonly closed: number;
  /** Unreviewed tokens ranked by how many of this edition's cards they block. */
  readonly missing: readonly { readonly token: string; readonly cards: number }[];
}

export interface ForgeSyntaxClosureReport {
  readonly forge: ForgeSyntaxReview['forge'];
  readonly reviewedTokens: number;
  readonly library: {
    readonly scripts: number;
    readonly closed: number;
    readonly blockedByOne: number;
    readonly distinctTokens: number;
    readonly unreviewedTokens: number;
    /** Unreviewed tokens ranked by how many library scripts they block. */
    readonly missing: readonly { readonly token: string; readonly scripts: number }[];
  };
  readonly editions: readonly ForgeSyntaxClosureEdition[];
}

interface ScriptClosure {
  readonly name: string | undefined;
  readonly keys: ReadonlySet<string>;
  readonly missing: readonly string[];
}

function closeScript(bytes: Uint8Array, reviewed: ReadonlySet<string>): ScriptClosure {
  const name = /^Name:(.*)$/mu.exec(new TextDecoder('utf-8', { fatal: true }).decode(bytes))?.[1]?.trim();
  const keys = new Set(inventoryForgeScriptSyntax(bytes).map(forgeSyntaxKey));
  return { name, keys, missing: [...keys].filter((key) => !reviewed.has(key)).sort() };
}

const rankedCounts = <T extends string>(
  counts: ReadonlyMap<string, number>,
  label: T,
  limit: number,
): readonly ({ readonly token: string } & Record<T, number>)[] =>
  [...counts.entries()]
    .sort(([leftToken, left], [rightToken, right]) => right - left || leftToken.localeCompare(rightToken))
    .slice(0, limit)
    .map(([token, count]) => ({ token, [label]: count }) as { readonly token: string } & Record<T, number>);

/**
 * `scripts` are archive-relative paths with their bytes; `editions` are the raw
 * edition file texts. Every script is tokenized once.
 */
export function buildForgeSyntaxClosureReport(input: {
  readonly review: ForgeSyntaxReview;
  readonly scripts: ReadonlyMap<string, Uint8Array>;
  readonly editions: readonly string[];
  readonly missingLimit?: number;
}): ForgeSyntaxClosureReport {
  const reviewed = new Set(input.review.entries.map(forgeSyntaxKey));
  const missingLimit = input.missingLimit ?? 50;
  const closures = new Map<string, ScriptClosure>();
  const scriptByName = new Map<string, string>();
  for (const [path, bytes] of [...input.scripts.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const closure = closeScript(bytes, reviewed);
    closures.set(path, closure);
    if (closure.name !== undefined && !scriptByName.has(closure.name)) scriptByName.set(closure.name, path);
  }
  const distinct = new Set<string>();
  const libraryMissing = new Map<string, number>();
  let closed = 0;
  let blockedByOne = 0;
  for (const closure of closures.values()) {
    for (const key of closure.keys) distinct.add(key);
    if (closure.missing.length === 0) closed += 1;
    if (closure.missing.length === 1) blockedByOne += 1;
    for (const key of closure.missing) libraryMissing.set(key, (libraryMissing.get(key) ?? 0) + 1);
  }
  const editions = input.editions
    .map(parseForgeEditionCards)
    .sort((left, right) => left.code.localeCompare(right.code))
    .map((edition): ForgeSyntaxClosureEdition => {
      const missing = new Map<string, number>();
      let scripted = 0;
      let editionClosed = 0;
      for (const card of edition.cards) {
        const path = scriptByName.get(card);
        const closure = path === undefined ? undefined : closures.get(path);
        if (closure === undefined) continue;
        scripted += 1;
        if (closure.missing.length === 0) editionClosed += 1;
        for (const key of closure.missing) missing.set(key, (missing.get(key) ?? 0) + 1);
      }
      return {
        code: edition.code,
        name: edition.name,
        cards: edition.cards.length,
        scripted,
        closed: editionClosed,
        missing: rankedCounts(missing, 'cards', missingLimit),
      };
    });
  return {
    forge: input.review.forge,
    reviewedTokens: reviewed.size,
    library: {
      scripts: closures.size,
      closed,
      blockedByOne,
      distinctTokens: distinct.size,
      unreviewedTokens: libraryMissing.size,
      missing: rankedCounts(libraryMissing, 'scripts', missingLimit),
    },
    editions,
  };
}

export function forgeSyntaxClosureSnapshot(report: ForgeSyntaxClosureReport): ForgeSyntaxClosureSnapshot {
  return {
    schemaVersion: 1,
    kind: 'forge-syntax-closure-snapshot',
    forge: report.forge,
    reviewedTokens: report.reviewedTokens,
    library: { scripts: report.library.scripts, closed: report.library.closed },
    editions: report.editions.map((edition) => ({
      code: edition.code,
      cards: edition.scripted,
      closed: edition.closed,
    })),
  };
}

/** Every edition (and the library) whose closed count moved against the committed snapshot. */
export function compareForgeSyntaxClosure(
  snapshot: ForgeSyntaxClosureSnapshot,
  report: ForgeSyntaxClosureReport,
): { readonly dropped: readonly string[]; readonly changed: readonly string[] } {
  const current = forgeSyntaxClosureSnapshot(report);
  const dropped: string[] = [];
  const changed: string[] = [];
  const note = (label: string, before: number, after: number): void => {
    if (after === before) return;
    changed.push(`${label}: ${before} -> ${after}`);
    if (after < before) dropped.push(`${label}: ${before} -> ${after}`);
  };
  note('library', snapshot.library.closed, current.library.closed);
  const currentByCode = new Map(current.editions.map((edition) => [edition.code, edition]));
  for (const edition of snapshot.editions) {
    const now = currentByCode.get(edition.code);
    note(edition.code, edition.closed, now?.closed ?? 0);
  }
  for (const edition of current.editions) {
    if (!snapshot.editions.some((entry) => entry.code === edition.code))
      changed.push(`${edition.code}: new edition`);
  }
  return { dropped, changed };
}
