/** Forge's shipped precon deck files to a constructed-format recipe; writes nothing else and admits nothing. */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PrintedFormatRecipeSchema } from '../src/printed-card/format-build';
import { parseForgeDeckFile } from '../src/printed-card/forge-deck-file';
import { preconRecipe } from '../src/printed-card/precon-recipe';

const usage =
  'Usage: import-forge-precons [--precons <directory of .dck files> --set <edition code>] [--deck <path to .dck file> ...] --id <format id> --name <format name> [--starting-life 40] --out <new recipe.json>';
const { values } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h' },
    precons: { type: 'string' },
    set: { type: 'string' },
    deck: { type: 'string', multiple: true },
    id: { type: 'string' },
    name: { type: 'string' },
    'starting-life': { type: 'string', default: '40' },
    out: { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
});
if (values.help) {
  process.stdout.write(
    `${usage}\nEvery precon whose [metadata] Set is the edition becomes one deck; each --deck names one more precon directly, by path, across any edition.\n`,
  );
  process.exit(0);
}
if (!values.id || !values.name || !values.out) throw new Error(usage);
if ((values.precons === undefined) !== (values.set === undefined)) throw new Error(usage);
const namedDecks = values.deck ?? [];
if (values.precons === undefined && namedDecks.length === 0) throw new Error(usage);
const startingLife = Number(values['starting-life']);
if (!Number.isSafeInteger(startingLife) || startingLife <= 0)
  throw new Error('--starting-life is a positive whole number');
const byEdition: { file: string; deck: ReturnType<typeof parseForgeDeckFile> }[] = [];
if (values.precons !== undefined && values.set !== undefined) {
  const edition = values.set.toUpperCase();
  const files = readdirSync(values.precons)
    .filter((file) => file.endsWith('.dck'))
    .sort();
  for (const file of files) {
    const deck = parseForgeDeckFile(readFileSync(join(values.precons, file), 'utf8'));
    if (deck.metadata['set']?.toUpperCase() === edition) byEdition.push({ file, deck });
  }
}
const byPath = namedDecks.map((file) => ({ file, deck: parseForgeDeckFile(readFileSync(file, 'utf8')) }));
const decks = [...byEdition, ...byPath];
if (decks.length === 0) {
  throw new Error(
    `No precon under ${values.precons ?? '(no --precons)'} names Set=${values.set ?? '(no --set)'}, and no --deck named one`,
  );
}
const recipe = PrintedFormatRecipeSchema.parse(
  preconRecipe(
    decks.map(({ deck }) => deck),
    { id: values.id, name: values.name, rules: { variant: 'commander', startingLife } },
  ),
);
writeFileSync(values.out, `${JSON.stringify(recipe, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(
  `${JSON.stringify({ recipe: values.out, decks: decks.map(({ file }) => file), sourceCodes: recipe.sourceCodes })}\n`,
);
