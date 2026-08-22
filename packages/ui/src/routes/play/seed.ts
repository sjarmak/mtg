/**
 * Where randomness enters the lab.
 *
 * Everything downstream of this file is deterministic and deliberately so: the
 * kernel bans `Math.random` outright (`kernel/src/rng.ts`) because a game has to
 * replay from a seed plus a list of integers, and the balance gates measure
 * 10,035 games that must come out byte-identical twice. None of that is in
 * tension with dealing a different game each time you sit down — it just means
 * the randomness belongs at the edge, once, in a value you can write down.
 *
 * So this is the only unseeded call in the play route, and the seed it returns
 * is meant to be *shown*. A lab that reshuffles invisibly has traded one bug
 * for a worse one: `deal.ts` used to pin `'lab/play/v0'`, so every session dealt
 * the identical opening hand, and the fix for that must not become "every
 * session deals something nobody can ever get back".
 *
 * The pure dealers keep their deterministic defaults. `dealMirrorGame` and
 * `openSealed` take a seed and are total functions of it; a caller who wants a
 * fresh game asks for one here and passes it in. That keeps the tests, which
 * pass explicit seeds, reading as the fixed games they are.
 *
 * The alphabet omits the characters that are read back wrong from a screen —
 * `0`/`O`, `1`/`l`/`I` — because the whole point of the token is that a person
 * can copy it into a URL or a bug report and get the same game.
 */

/**
 * Unambiguous when transcribed by hand: a-z without `i`, `l`, `o`, and 2-9.
 * That is 31 characters, not a power of two, so `% ALPHABET.length` is very
 * slightly biased toward the first character. Stated rather than fixed — this
 * picks a label for a game, and a seed drawn from 31^12 possibilities does not
 * become less unique for it.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Long enough that two lab sessions colliding is not a thing that happens. */
const TOKEN_LENGTH = 12;

/**
 * A fresh seed, prefixed so a log or a URL says where it came from.
 *
 * `crypto.getRandomValues` rather than `Math.random`: not for cryptographic
 * strength, which nothing here needs, but because the kernel's ban on
 * `Math.random` is easier to keep honest when the one permitted source of
 * randomness in the package does not look like the banned one.
 */
export function newSeed(prefix = 'lab'): string {
  const source = globalThis.crypto;
  if (source === undefined || typeof source.getRandomValues !== 'function') {
    throw new Error('newSeed: this host has no crypto.getRandomValues to draw a seed from');
  }
  const bytes = source.getRandomValues(new Uint8Array(TOKEN_LENGTH));
  let token = '';
  for (const byte of bytes) token += ALPHABET[byte % ALPHABET.length];
  return `${prefix}/${token}`;
}
