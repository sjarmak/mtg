/** Offline audit inputs, not a decision-family classifier or play-admission artifact. */
import { createHash } from 'node:crypto';
import { parsePrintedCardCatalog, serializedPrintedCardCatalogContent } from '../artifact';

const digest = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort();

function literalTokens(script: string) {
  // Only script declarations, never Oracle prose or comments. These tokens are
  // navigation hints: keyword expansion and referenced token scripts live in Forge.
  const declarations = script.split(/\r?\n/u).filter((line) => /^(?:A|K|T|S|R|SVar):/u.test(line));
  return {
    keywords: sortedUnique(
      declarations.flatMap((line) => /^K:([^:]+)(?::|$)/u.exec(line)?.[1]?.trim() ?? []),
    ),
    apis: sortedUnique(
      declarations.flatMap((line) =>
        [...line.matchAll(/(?:^|[:|])\s*(?:AB|SP|DB)\$\s*([A-Za-z0-9_]+)/gu)].map((match) => match[1]!),
      ),
    ),
    triggerModes: sortedUnique(
      declarations
        .filter((line) => line.startsWith('T:'))
        .flatMap((line) =>
          [...line.matchAll(/(?:^|[:|])\s*Mode\$\s*([A-Za-z0-9_]+)/gu)].map((match) => match[1]!),
        ),
    ),
  };
}

export function buildPrintedScriptInventory(
  inputs: readonly unknown[],
  readScript: (archiveMember: string) => string | Uint8Array,
) {
  const catalogs = inputs
    .map(parsePrintedCardCatalog)
    .sort((a, b) => (a.format < b.format ? -1 : a.format > b.format ? 1 : 0));
  if (catalogs.length === 0) throw new Error('Script inventory requires catalogs');
  if (new Set(catalogs.map((catalog) => catalog.format)).size !== catalogs.length) {
    throw new Error('Script inventory has duplicate catalog identities');
  }
  // Validate every catalog and every path before making any archive read request.
  for (const catalog of catalogs) {
    if (digest(serializedPrintedCardCatalogContent(catalog)) !== catalog.contentSha256) {
      throw new Error(`Script inventory catalog checksum mismatch: ${catalog.format}`);
    }
    for (const card of catalog.cards) {
      if (!/^[a-zA-Z0-9_][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9_-]+)*\.txt$/u.test(card.forgeScript)) {
        throw new Error(`Invalid inventory script path: ${card.forgeScript}`);
      }
    }
  }
  const scripts = sortedUnique(
    catalogs.flatMap((catalog) => catalog.cards.map((card) => card.forgeScript)),
  ).map((path) => {
    const bytes = readScript(path);
    const text = typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return {
      path,
      sha256: digest(bytes),
      lines: text
        .split(/\r?\n/u)
        .map((text, index) => ({ number: index + 1, text }))
        .filter(
          ({ text }) =>
            text.trim() !== '' && !text.trimStart().startsWith('#') && !text.startsWith('Oracle:'),
        ),
      tokens: literalTokens(text),
    };
  });
  const byPath = new Map(scripts.map((script) => [script.path, script]));
  const cards = catalogs.flatMap((catalog) =>
    catalog.cards.map((card) => {
      const script = byPath.get(card.forgeScript)!;
      if (script.sha256 !== card.forgeScriptSha256) {
        throw new Error(
          `Script inventory script checksum mismatch: ${card.physicalId} (${card.forgeScript})`,
        );
      }
      return {
        physicalId: card.physicalId,
        name: card.name,
        catalogFormat: catalog.format,
        forgeScript: card.forgeScript,
        forgeScriptSha256: card.forgeScriptSha256,
        review: 'pending' as const,
        ...script.tokens,
      };
    }),
  );
  return {
    schemaVersion: 1 as const,
    kind: 'printed-script-review-inventory' as const,
    catalogs: catalogs.map(({ format, contentSha256 }) => ({ format, contentSha256 })),
    cards,
    scripts: scripts.map(({ tokens: _tokens, ...script }) => script),
  };
}
