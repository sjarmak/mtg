/** Boundary validation for the URL-backed draft transcript. */
import { DEFAULT_PACKS_PER_SEAT } from '@mtg/draft-export';

export const MAX_DRAFT_SEED_LENGTH = 128;
export const MAX_PICK_LOG_LENGTH = 16_384;
export const MAX_HUMAN_PICKS = DEFAULT_PACKS_PER_SEAT * 20;
export const MAX_CARD_ID_LENGTH = 128;

export interface DraftRouteParams {
  readonly seed?: string;
  readonly picks?: string;
}

export type DraftInputs =
  | { readonly ok: true; readonly seed: string; readonly picks: readonly string[] }
  | { readonly ok: false; readonly message: string };

export function encodePickLog(picks: readonly string[]): string {
  return JSON.stringify(picks);
}

function readSeed(value: string | undefined, fallback: string): string | null {
  const seed = value ?? fallback;
  const control = [...seed].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (seed.length === 0 || seed.length > MAX_DRAFT_SEED_LENGTH || control) {
    return null;
  }
  return seed;
}

function readPicks(value: string | undefined): readonly string[] | string {
  if (value === undefined || value.length === 0) return [];
  if (value.length > MAX_PICK_LOG_LENGTH) return 'The pick log is longer than 16 KiB.';
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return 'The pick log is not valid JSON.';
  }
  if (!Array.isArray(raw)) return 'The pick log must be a JSON array of card ids.';
  if (raw.length > MAX_HUMAN_PICKS) {
    return `The pick log has ${String(raw.length)} entries; at most ${String(MAX_HUMAN_PICKS)} are accepted.`;
  }
  const picks: string[] = [];
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > MAX_CARD_ID_LENGTH) {
      return `Pick ${String(index + 1)} must be a card id from 1 to ${String(MAX_CARD_ID_LENGTH)} characters.`;
    }
    picks.push(entry);
  }
  return picks;
}

export function readDraftInputs(params: DraftRouteParams, fallbackSeed: string): DraftInputs {
  const seed = readSeed(params.seed, fallbackSeed);
  if (seed === null) {
    return {
      ok: false,
      message: `The seed must be 1 to ${String(MAX_DRAFT_SEED_LENGTH)} printable characters.`,
    };
  }
  const picks = readPicks(params.picks);
  return typeof picks === 'string' ? { ok: false, message: picks } : { ok: true, seed, picks };
}
