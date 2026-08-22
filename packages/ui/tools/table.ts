/**
 * `npm run table` — sit two people down without remembering any flags.
 *
 * `npm run netplay` already starts a two-seat game, but it asks the person
 * starting it to know the deck ids, the seed and the name flags before anything
 * is on screen. That is fine for a launcher and wrong for a Saturday: the deck
 * list is a property of the set, the person starting the game is looking right
 * at it, and asking them to type an id they have to go find first is asking them
 * to do the computer's job.
 *
 * So this walks the same ground in questions. It resolves the set the way every
 * other launcher here does, prints the written decks with the sentence each one
 * states about its own plan, takes a pick per seat, takes two names and an
 * optional seed, and then hands all of it to `netplay` and gets out of the way.
 * It starts nothing itself: one process listens at the end of this, it is the
 * one `netplay` has always started, and its host policy is untouched by this
 * file existing. Everything printed about links and addresses comes from there.
 *
 * A pick can be a number or a deck id, because the ids are what `--decks` takes
 * and what every note about the set uses, and a launcher that accepted only one
 * of the two would be teaching a name it then refuses to hear.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { resolveSet } from './resolve-set';
import type { ResolvedSet } from './resolve-set';
import { flagshipOnly, SET_CANDIDATES } from './set-candidates';
import { choosePreconFile, preconCandidatesFor } from './stage-precons';
import { chooseDeck, chooseName, chooseSeed, deckMenu, netplayFlags } from './table/menu';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

function fail(message: string): never {
  process.stderr.write(`\nnpm run table: ${message}\n\n`);
  process.exit(1);
}

function cardsOf(document: ResolvedSet): readonly Card[] {
  const parsed: unknown = JSON.parse(document.json);
  if (typeof parsed !== 'object' || parsed === null || !('cards' in parsed)) {
    fail(`${document.path} has no "cards" array`);
  }
  const { cards } = parsed as { cards: unknown };
  if (!Array.isArray(cards)) fail(`${document.path} has no "cards" array`);
  return cards.map((card: unknown) => parseCard(card));
}

/**
 * The set to seat, resolved exactly as `netplay` resolves it, including the
 * flagship filter, so the two launchers can never disagree about which set is
 * the default one. A named path bypasses the filter there and here.
 */
function resolve_(named: string | undefined): ResolvedSet {
  const candidates = named === undefined ? flagshipOnly(SET_CANDIDATES) : SET_CANDIDATES;
  const result = resolveSet(candidates, named);
  if (!result.ok) fail(result.message);
  return result;
}

async function main(): Promise<void> {
  const named = process.argv[2];
  if (named !== undefined && named.startsWith('--')) {
    fail('this launcher takes a set path and then asks the rest; flags belong to `npm run netplay`');
  }
  // This launcher is questions, and questions need somebody there to answer
  // them. Said here rather than discovered at the first prompt, because a
  // readline question against a stream that has already ended never resolves,
  // so the alternative to this line is a launcher that hangs in a pipe or a CI
  // job instead of telling the caller what it needed.
  if (!process.stdin.isTTY) {
    fail('this launcher asks questions and nothing is here to answer them; use `npm run netplay` instead');
  }
  const document = resolve_(named);
  const cards = cardsOf(document);
  const search = choosePreconFile(
    preconCandidatesFor(document.path, REPO_ROOT),
    cards.map((card) => card.id),
  );
  if (search.chosen === null) {
    const looked = search.rejected.map((one) => `  ${one.candidate.path}: ${one.why}`).join('\n');
    fail(
      `${document.path} has no written decks to choose from.\n` +
        (looked.length > 0 ? `Looked at:\n${looked}\n` : '') +
        'Run `npm run netplay` instead; it builds sealed decks when a set has none.',
    );
  }
  const { decks } = search.chosen.file;
  const first = decks[0];
  const second = decks[1] ?? decks[0];
  if (first === undefined || second === undefined) fail('a table needs at least one written deck');

  const io = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write(`\n${document.what}: ${relative(REPO_ROOT, document.path)}\n`);
    process.stdout.write(`decks: ${relative(REPO_ROOT, search.chosen.candidate.path)}\n\n`);
    process.stdout.write(`${deckMenu(decks).join('\n')}\n\n`);

    const seatOne = chooseDeck(decks, await io.question(`Seat one deck [${first.name}]: `), first);
    const seatTwo = chooseDeck(decks, await io.question(`Seat two deck [${second.name}]: `), second);
    const nameOne = chooseName(await io.question('Seat one name [Seat one]: '), 'Seat one');
    const nameTwo = chooseName(await io.question('Seat two name [Seat two]: '), 'Seat two');
    const seed = chooseSeed(
      await io.question('Seed, so the same word deals the same game [blank for a fresh one]: '),
    );
    io.close();

    const flags = netplayFlags({
      setPath: named === undefined ? undefined : named,
      decks: [seatOne, seatTwo],
      names: [nameOne, nameTwo],
      seed,
    });
    process.stdout.write(
      `\n${nameOne} plays ${seatOne.name}, ${nameTwo} plays ${seatTwo.name}` +
        `${seed === undefined ? '' : `, seed ${seed}`}.\n` +
        // Truthful about which of the two it is. With a seed typed in, the
        // flags carry it and the command is the same table; blank, the flags
        // carry no seed and `netplay` draws a fresh one, so the same command is
        // the same two decks and a new shuffle. Saying "same table" for both
        // would make the seed field look ornamental.
        `${seed === undefined ? 'Same decks, new shuffle' : 'Same table again'}: ` +
        `npm run netplay -- ${flags.join(' ')}\n` +
        (seed === undefined
          ? 'The seed of the game it deals is printed below; pass it back with --seed to replay one.\n'
          : ''),
    );
    const child = spawn('npx', ['tsx', resolve(UI_ROOT, 'tools', 'netplay.ts'), ...flags], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    child.on('exit', (code) => process.exit(code ?? 0));
  } catch (cause: unknown) {
    io.close();
    fail(cause instanceof Error ? cause.message : String(cause));
  }
}

await main();
