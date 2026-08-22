/**
 * `tsx packages/forge-export/src/cli.ts <command>`
 *
 * Two commands, both thin wrappers over the library:
 *   export <out-dir> [cards.json]  — write the Forge custom-set files
 *   boot-gate [cards.json]         — transpile, boot in Forge, play a game
 *
 * With no card file, the DSL's own fixture set is used, which is what the
 * spikes and a local smoke check want.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Card } from '@mtg/dsl';
import { EXAMPLE_SET, parseCardsDocumentJson } from '@mtg/dsl';
import { bootGate } from './boot-gate';
import { formatRejections } from './rejection';
import { transpileSet } from './transpile';
import { writeForgeSet } from './write-set';

/**
 * Either spelling of a card list on disk: a bare JSON array, or the set
 * document `@mtg/setgen` writes. This command read only the first and exited 1
 * on every `set.json` the rest of the workspace opens without comment.
 */
function loadCards(path: string | undefined): readonly Card[] {
  if (path === undefined) return EXAMPLE_SET;
  return parseCardsDocumentJson(readFileSync(path, 'utf8'));
}

function editionFor(cards: readonly Card[]): { name: string; date: string } {
  return {
    name: `${cards[0]?.set.code ?? 'SET'} export`,
    date: new Date().toISOString().slice(0, 10),
  };
}

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'export': {
      const outDir = rest[0];
      if (outDir === undefined) {
        console.error('usage: cli.ts export <out-dir> [cards.json]');
        return 2;
      }
      const cards = loadCards(rest[1]);
      const result = transpileSet(cards, editionFor(cards));
      if (!result.ok) {
        console.error(`transpile rejected: ${formatRejections(result.rejections)}`);
        return 1;
      }
      for (const path of writeForgeSet(outDir, result.value)) console.log(path);
      return 0;
    }
    case 'boot-gate': {
      const cards = loadCards(rest[0]);
      const result = await bootGate(cards);
      console.log(JSON.stringify(result, null, 2));
      return result.status === 'failed' ? 1 : 0;
    }
    default:
      console.error('usage: cli.ts export <out-dir> [cards.json] | boot-gate [cards.json]');
      return 2;
  }
}

const entry = process.argv[1];
const invokedDirectly = entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
