/**
 * `npm run netplay` — one game, two machines, one server.
 *
 * Resolves a set the way `npm run play` does, deals selected preconstructed
 * decks when the set has them (otherwise sealed decks), starts the game server,
 * hands staging and the web server to `play.ts`, and prints one link per seat.
 * Whoever is at the keyboard opens theirs; the other person opens theirs on
 * their own device, on the same network.
 *
 * # What listens where, said plainly
 *
 * The game server binds **127.0.0.1** and is reachable from this machine only.
 * Vite binds every interface, which it already did and argues for in
 * `../vite.config.ts`, and proxies `/api` to the game server. So exactly one
 * process is reachable from the other machine, it is the one that was designed
 * to be, and its host policy is unchanged by this file. `--api-port` moves the
 * loopback listener and `--web-port` moves the one the other machine reaches;
 * `--host`, deliberately, is not a flag here, because the thing a person would
 * reach for it to do is already done by Vite.
 *
 * # The link is the seat
 *
 * Each seat gets a `randomUUID`, and the URL that carries it is the whole of
 * that player's identity. This is a capability, not an account: there is nothing
 * to log into, and whoever holds a link is that seat. The bead states no
 * accounts and no matchmaking as non-goals and this is what that costs — one
 * line of randomness, and the property that one player cannot open the other
 * player's board by editing a digit in a query string.
 *
 * # The address is printed, and so is every other one
 *
 * This file used to print the literal string `http://<this machine>`, which was
 * true and useless. `netplay-links.ts` now resolves the real ones and prints all
 * of them, labeled, because this machine carries a tailnet interface beside the
 * LAN one and a launcher that guessed would be wrong about half the time.
 * Nothing about what is exposed changes: the game server still binds loopback
 * and Vite still binds every interface, exactly as it did when the address was a
 * placeholder. The line stopped being a lie, which is the whole of it.
 *
 * # Two people, two written decks
 *
 * A matching precon file seats its first two decks unless `--decks` names a
 * different pair. Sets without one keep the existing independently built
 * sealed decks. Interactive sealed construction for two remote people still
 * needs a ready state and remains a separate phase.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { createTable, dealPreconTable, dealSealedTable, serveTable } from '@mtg/netplay';
import { linkBlock } from './netplay-links';
import { readNetplayArgs } from './netplay-args';
import { selectPreconPair } from './netplay-decks';
import { resolveSet } from './resolve-set';
import type { ResolvedSet } from './resolve-set';
import { flagshipOnly, SET_CANDIDATES } from './set-candidates';
import { choosePreconFile, preconCandidatesFor } from './stage-precons';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(UI_ROOT, '..', '..');

function fail(message: string): never {
  process.stderr.write(`\nnpm run netplay: ${message}\n\n`);
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

async function main(): Promise<void> {
  const args = readNetplayArgs(process.argv.slice(2));
  // The same resolution `npm run play` uses, including the rule that a slice of
  // some other set is skipped rather than opened.
  const candidates = args.set === undefined ? flagshipOnly(SET_CANDIDATES) : SET_CANDIDATES;
  const document = resolveSet(candidates, args.set);
  if (!document.ok) fail(document.message);

  const set = cardsOf(document);
  const tokens: readonly [string, string] = [randomUUID(), randomUUID()];
  const plan = [
    { name: args.names[0], token: tokens[0] },
    { name: args.names[1], token: tokens[1] },
  ] as const;
  const precons = choosePreconFile(
    preconCandidatesFor(document.path, REPO_ROOT),
    set.map((card) => card.id),
  );
  if (precons.chosen === null && args.decks !== undefined) {
    fail(`--decks was given, but no preconstructed deck file matches ${document.path}`);
  }
  const dealt =
    precons.chosen === null
      ? dealSealedTable({
          id: randomUUID(),
          set,
          seed: args.seed,
          plan,
        })
      : dealPreconTable({
          id: randomUUID(),
          set,
          decks: selectPreconPair(precons.chosen.file, args.decks),
          seed: args.seed,
          plan,
        });
  const table = createTable(dealt.spec);
  const server = await serveTable({ table, port: args.apiPort, host: '127.0.0.1' });

  process.stdout.write(
    `\nPrepared ${precons.chosen === null ? 'sealed decks' : 'preconstructed decks'} from ${document.what}.\n` +
      `  ${document.path}\n` +
      // Printed with the flag that brings it back, because a seed nobody can
      // act on is decoration: without `--seed` every run of this launcher deals
      // a different table, which is the point, and this line is the only way
      // back to the one that just happened.
      `  seed ${args.seed} (deal this game again with --seed ${args.seed})\n` +
      `  ${args.names[0]}: ${dealt.decks[0].name}, ${String(dealt.decks[0].cards.length)} cards\n` +
      `  ${args.names[1]}: ${dealt.decks[1].name}, ${String(dealt.decks[1].cards.length)} cards\n\n` +
      `The game server is on 127.0.0.1:${String(server.port)} and is reachable from this machine only.\n` +
      'Vite serves the page on every interface and proxies /api to it, so the other\n' +
      'player reaches the game through one of the addresses below and nothing else\n' +
      'is exposed.\n\n' +
      linkBlock({
        names: args.names,
        tokens,
        port: args.webPort,
        interfaces: networkInterfaces(),
      }) +
      '\nThe tab Vite opens by itself is the hot-seat lab; the links above are this table.\n\n',
  );

  // The staging and the web server, unchanged. `play.ts` resolves the same
  // document again because it was given the path, so the two agree by
  // construction rather than by a shared mutable step.
  const playArgs = ['tsx', join(UI_ROOT, 'tools', 'play.ts'), document.path];
  if (args.artManifest !== undefined) playArgs.push('--art-manifest', args.artManifest);
  const lab = spawn('npx', playArgs, {
    cwd: UI_ROOT,
    stdio: 'inherit',
    // The web port is stated to Vite rather than left to it. Vite's own answer
    // to a taken port is to move to the next free one, which would leave the two
    // links above pointing at whatever else was already listening; `play.ts`
    // turns a stated port into `--strictPort`, so the run refuses instead.
    env: {
      ...process.env,
      MTG_NETPLAY_PORT: String(server.port),
      MTG_WEB_PORT: String(args.webPort),
    },
  });
  lab.on('error', (cause: Error) => {
    fail(`could not start the lab (${cause.message})`);
  });
  lab.on('exit', (code) => {
    void server.close().then(() => {
      process.exit(code ?? 0);
    });
  });
}

main().catch((cause: unknown) => {
  fail(cause instanceof Error ? cause.message : String(cause));
});
