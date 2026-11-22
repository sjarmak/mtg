/**
 * Which launcher owns `packages/ui/public/`, and what the next one is told.
 *
 * `mtg-mbkv`. `npm run play` and `npm run lab` stage into one directory under
 * one set of filenames, and both take a port, so two of them at once is a thing
 * somebody does the day the port flag lands. It was: a lab was serving a deck on
 * 5280, a play run on 5281 cleared `public/deck.json` and `public/art/`, and the
 * still-running 5280 page went on serving a Decks section with nothing in it. Vite
 * reads `public/` from disk per request, so the damage is immediate, and nobody
 * is told anything -- the page simply has less on it than it did.
 *
 * The clearing those launchers do is right and stays. `stage-deck.ts` and
 * `stage-art.ts` argue it: a deck of real printings under a staged DSL set, and
 * a previous set's flat manifest drawing its pictures over this set's cards,
 * were both real failures. What changed is that "an earlier launcher" and "a
 * launcher running right now" stopped being the same thing, and the clearing
 * cannot tell them apart. So the second launcher refuses to start rather than
 * refusing to clear: the two write the same filenames, `public/art/` included,
 * so there is no subset it could skip and still stage the page it promised.
 *
 * **Liveness is the truth and the file is a hint.** A launcher killed by Ctrl-C
 * dies with its whole process group and runs no exit handler, so a stale claim
 * on disk is the normal end state rather than the exceptional one. Every read
 * signals the recorded pid first and treats a claim nobody holds as no claim at
 * all, which is what keeps a killed run from bricking the next one. The file
 * carries what a person needs in the refusal and nothing else.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The file a launcher writes while it owns the staged directory. */
export const CLAIM_FILENAME = '.launcher.json';

/** A launcher that is serving the staged files right now. */
export interface LauncherClaim {
  /** What a person would type to start it: `npm run play`, `npm run lab`. */
  readonly command: string;
  readonly pid: number;
  /** Where its page is, resolved -- never the unstated `undefined`. */
  readonly port: number;
  /** When it claimed, ISO 8601. Printed so a claim can be recognized. */
  readonly at: string;
}

/** Whether a pid names a process this user could signal. */
export type Alive = (pid: number) => boolean;

/**
 * The real liveness test: signal 0, which checks and delivers nothing.
 *
 * `EPERM` counts as alive. A process this user may not signal is still a
 * process, and refusing to stage over one we cannot even see is the safe half
 * of the wrong answer.
 */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause: unknown) {
    return (cause as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function claimPath(publicDir: string): string {
  return join(publicDir, CLAIM_FILENAME);
}

function parse(text: string): LauncherClaim | null {
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null) return null;
  const claim = value as Partial<LauncherClaim>;
  if (typeof claim.command !== 'string' || claim.command === '') return null;
  if (typeof claim.pid !== 'number' || !Number.isInteger(claim.pid) || claim.pid <= 0) return null;
  if (typeof claim.port !== 'number' || !Number.isInteger(claim.port)) return null;
  if (typeof claim.at !== 'string') return null;
  return { command: claim.command, pid: claim.pid, port: claim.port, at: claim.at };
}

/**
 * The claim a running process holds on this directory, or `null`.
 *
 * A file that cannot be read, cannot be parsed, or does not say all four things
 * is `null` rather than an error: it was written by a launcher that died
 * mid-write or by a version that predates this format, and neither is a reason
 * to stop a person playing a game. The refusal is for a sibling that is
 * demonstrably alive, and nothing else earns one.
 */
export function readLauncherClaim(publicDir: string, alive: Alive = processAlive): LauncherClaim | null {
  let text: string;
  try {
    text = readFileSync(claimPath(publicDir), 'utf8');
  } catch {
    return null;
  }
  let claim: LauncherClaim | null;
  try {
    claim = parse(text);
  } catch {
    return null;
  }
  if (claim === null) return null;
  return alive(claim.pid) ? claim : null;
}

/** Records this run as the owner, replacing whatever was there. */
export function writeLauncherClaim(publicDir: string, claim: LauncherClaim): void {
  writeFileSync(claimPath(publicDir), `${JSON.stringify(claim, null, 2)}\n`, 'utf8');
}

/**
 * Drops this run's claim, and leaves anybody else's alone.
 *
 * The pid is checked because a launcher that refused to start would otherwise
 * delete the claim of the sibling it just refused to disturb, and the run after
 * that would find the directory unowned and clear the page for real.
 */
export function releaseLauncherClaim(publicDir: string, pid: number): void {
  const held = readLauncherClaim(publicDir, () => true);
  if (held === null || held.pid !== pid) return;
  rmSync(claimPath(publicDir), { force: true });
}

/**
 * What the second launcher says instead of staging.
 *
 * It names the port because that is the thing a person can act on: the page
 * whose files were about to be deleted is still open, and the sentence is
 * useless if it does not say where. The last line is the escape for the one
 * case liveness gets wrong, which is a recycled pid.
 */
export function claimRefusal(held: LauncherClaim, mine: string, publicDir: string): string {
  return (
    `\`${held.command}\` is already running on port ${String(held.port)} (pid ${String(held.pid)}, ` +
    `since ${held.at}),\n` +
    `and it stages into the same directory this run would:\n` +
    `  ${publicDir}\n` +
    `Starting \`${mine}\` here would delete the set, the deck and the art that page is\n` +
    `serving, while it kept serving them, and nothing on it would say so.\n\n` +
    `Stop that terminal with Ctrl-C and run this again. If no launcher is running,\n` +
    `remove ${claimPath(publicDir)} and try again.`
  );
}

/** Either this run owns the directory, or the sentence saying who does. */
export type Claimed = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * Takes the directory for this run, or refuses and says who holds it.
 *
 * Called before a launcher stages anything at all, because the clearing is the
 * damage: by the time a set is resolved the sibling's deck is already gone.
 */
export function claimPublicDir(
  publicDir: string,
  command: string,
  port: number,
  now: string,
  alive: Alive = processAlive,
): Claimed {
  const held = readLauncherClaim(publicDir, alive);
  if (held !== null && held.pid !== process.pid) {
    return { ok: false, message: claimRefusal(held, command, publicDir) };
  }
  writeLauncherClaim(publicDir, { command, pid: process.pid, port, at: now });
  return { ok: true };
}
