/**
 * Parsing Forge's `sim` output.
 *
 * Every pattern here was read off real runs of Forge 2.0.14 rather than
 * guessed; the samples are quoted next to each one. Output crossing a
 * subprocess boundary is untrusted input, so parsing is line-by-line, total,
 * and never throws.
 */
import { assertNever } from '@mtg/dsl';

/** `Game Result: Game 1 ended in 1603 ms. Ai(1)-Deck has won!` */
const GAME_RESULT = /^Game Result: Game (\d+) ended in (\d+) ms\.\s*(.*?)\s*$/;

/** `Match Result: Ai(1)-Abzan Siege: 1 Ai(2)-Air Forces: 0` */
const MATCH_RESULT = /^Match Result:\s*(.+?)\s*$/;

/**
 * `Read cards: 836 files in 0 ms (8 parts) using thread pool`
 *
 * Forge prints one of these per card source it loads, so a run emits several:
 * a real 2.0.14 boot of a 90-card custom set printed `836` (Forge's own loose
 * scripts), `90` (ours) and `1` (the token file), plus a separate
 * `33617 archived files` line this pattern deliberately does not match — the
 * archived corpus is Forge's shipped database, not files it read for this set.
 */
const READ_CARDS = /^Read cards: (\d+) files/;

/**
 * Card-database complaints. Forge reports an unscripted or unreadable card by
 * name at load time; a deck referencing a card Forge does not know is
 * reported when the deck is read.
 */
const CARD_PROBLEM_PATTERNS: readonly RegExp[] = [
  // The decisive one. Forge prints this when a deck names a card its database
  // does not have — a card whose script failed to load, or was never written —
  // and then **plays the game anyway and exits 0**. Without this check a boot
  // gate that only looked at the exit code would report a false pass.
  /^An unsupported card was requested: "(.+?)" from ".*?"\.?$/,
  // A card script that parses as text but names something outside Forge's
  // enums throws at ability-construction time. Forge prints the trace, aborts
  // the game in milliseconds, and still exits 0.
  /crash in raw Ability, check card script of (.+?)\s*$/,
  /crash when trying to create ability\s+.*?of card:\s*(.+?)\s*$/,
  /^(?:.*\s)?Unsupported card found in deck: (.+?)\.?$/,
  /^(?:.*\s)?The card (.+?) was not assigned to any set/,
  /^Error parsing card:?\s*(.+?)$/,
  /^Card not found:?\s*(.+?)$/,
];

export interface SimGameResult {
  readonly game: number;
  readonly durationMs: number;
  /** Winner clause exactly as Forge printed it. */
  readonly outcome: string;
}

export interface SimOutput {
  readonly games: readonly SimGameResult[];
  readonly matchResults: readonly string[];
  /**
   * Loose card files Forge reported reading, totaled across every batch it
   * printed; `null` when it printed none. A boot of our 90-card set reads 927
   * (836 + 90 + 1), so this is "the set's files were among what Forge read",
   * never "the set has this many cards".
   */
  readonly cardFilesRead: number | null;
  /** Java stack traces surfaced in the output. */
  readonly exceptions: readonly string[];
}

/** Parses a full stdout+stderr capture of a `sim` run. */
export function parseSimOutput(text: string): SimOutput {
  const games: SimGameResult[] = [];
  const matchResults: string[] = [];
  const exceptions: string[] = [];
  let cardFilesRead: number | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const game = GAME_RESULT.exec(line);
    if (game !== null) {
      games.push({
        game: Number(game[1] ?? 0),
        durationMs: Number(game[2] ?? 0),
        outcome: game[3] ?? '',
      });
      continue;
    }
    const match = MATCH_RESULT.exec(line);
    if (match !== null && match[1] !== undefined) {
      matchResults.push(match[1]);
      continue;
    }
    const read = READ_CARDS.exec(line);
    if (read !== null && read[1] !== undefined) {
      cardFilesRead = (cardFilesRead ?? 0) + Number(read[1]);
      continue;
    }
    if (/^(?:Exception|java\.lang\.|.*Exception: )/.test(line)) exceptions.push(line);
  }
  return { games, matchResults, cardFilesRead, exceptions };
}

/**
 * Names Forge complained about while loading cards or decks. The gate treats
 * any of the set's own card names appearing here as a boot failure.
 */
export function problemCardNames(text: string): string[] {
  const names = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    for (const pattern of CARD_PROBLEM_PATTERNS) {
      const match = pattern.exec(line);
      if (match !== null && match[1] !== undefined) names.add(match[1].trim());
    }
  }
  return [...names];
}

/**
 * A Forge process that died before it could report anything about the cards.
 *
 * Three outcomes, and the difference between them is the whole point.
 * `no-display` is claimed only when Forge printed a signature that names the
 * cause, and it carries the line that proved it. `silent-without-display` is
 * claimed when Forge printed nothing *and* the environment has no `DISPLAY` at
 * all — still evidence rather than a guess, because the variable is a fact
 * about the run and not an inference from the silence, and because Forge's
 * desktop entry point cannot reach its first log line without a screen.
 * `unrecognised` is everything else that exited without a word: the gate says
 * so and quotes what it saw, because that same silence would follow a corrupt
 * jar, a JVM that could not start, or a sandbox kill, and naming one of those
 * without evidence is a guess.
 */
export type ForgeStartupFailure =
  | { readonly kind: 'no-display'; readonly evidence: string }
  | { readonly kind: 'silent-without-display'; readonly evidence: string }
  | { readonly kind: 'unrecognised'; readonly evidence: string };

/**
 * Signatures that positively identify a missing or unusable X server.
 *
 * Observed on this codebase, not guessed. Anything not listed here is reported
 * as unrecognised rather than folded into the nearest familiar diagnosis.
 */
const NO_DISPLAY_SIGNATURES: readonly RegExp[] = [
  /^.*Authorization required, but no authorization protocol specified.*$/m,
  /^.*HeadlessException.*$/m,
];

/**
 * Classifies a failed run that produced no game.
 *
 * `null` means this is not a start-up failure the gate can speak to: either
 * Forge exited 0, or it exited nonzero *and said something*, in which case the
 * caller reports the real exit code and output as a failure rather than
 * excusing it as an environment gap.
 */
export function diagnoseStartupFailure(
  result: {
    readonly exitCode: number | null;
    readonly stdout: string;
    readonly stderr: string;
  },
  display: string | undefined = process.env['DISPLAY'],
): ForgeStartupFailure | null {
  if (result.exitCode === 0) return null;
  const combined = `${result.stdout}\n${result.stderr}`;
  for (const signature of NO_DISPLAY_SIGNATURES) {
    const match = signature.exec(combined);
    if (match !== null) return { kind: 'no-display', evidence: match[0].trim() };
  }
  if (combined.trim().length > 0) return null;
  const silence = `Forge exited ${String(result.exitCode)} having printed nothing at all on stdout or stderr`;
  if (display === undefined || display.trim().length === 0) {
    return { kind: 'silent-without-display', evidence: silence };
  }
  return { kind: 'unrecognised', evidence: silence };
}

/** The reason string the gate reports for a start-up failure. */
export function describeStartupFailure(failure: ForgeStartupFailure): string {
  switch (failure.kind) {
    case 'no-display':
      return `Forge exited before playing because DISPLAY does not reach a usable X server: its desktop entry point builds a Swing GUI even in sim mode, so one is required (Xvfb is enough). Signature matched: ${failure.evidence}. This is an environment gap, not a verdict on the cards.`;
    case 'silent-without-display':
      return `Forge exited before playing and DISPLAY is not set in this environment. What it saw: ${failure.evidence}. Its desktop entry point builds a Swing GUI even in sim mode, and with no screen at all the JVM dies before its first log line, which is why there is nothing to quote. Re-run the command in this report under \`xvfb-run -a\`, which is how this gate's passing runs are made. This is an environment gap, not a verdict on the cards.`;
    case 'unrecognised':
      return `Forge exited before playing and the gate cannot say why. What it saw: ${failure.evidence}. No known start-up signature matched, so no cause is claimed here — re-run the command in this report by hand to see what Forge does. This is not a verdict on the cards.`;
    default:
      return assertNever(failure, 'describeStartupFailure');
  }
}
