/**
 * The `@mtg/engine` table values as they arrive off a wire, or the reason they
 * do not.
 *
 * `backend-gateway.ts` read a browser's `SessionSpec` this way from the start;
 * `observed-protocol.ts` reads the same content reference, rules and decks
 * one seat at a time, so the readers live here and both import them rather
 * than one copying the other. Each returns the value or a plain sentence, and
 * the caller turns the sentence into whatever refusal its own wire carries.
 */
import type { CardOrigin, ContentRef, DeckRef, DeckSlot, MatchRules } from '@mtg/engine';
import { MIN_SEATS } from '@mtg/engine';

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function readOrigin(value: unknown): string | CardOrigin | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return 'every card origin must be printed or custom';
  if (value['kind'] === 'printed') return { kind: 'printed' };
  if (value['kind'] === 'custom' && nonempty(value['setCode']) && nonempty(value['cardId'])) {
    return { kind: 'custom', setCode: value['setCode'], cardId: value['cardId'] };
  }
  return 'every card origin must be printed or name a custom set code and card id';
}

function readSlots(value: unknown, requireOrigin: boolean): string | DeckSlot[] {
  if (!Array.isArray(value)) return 'a deck section is a list of slots';
  const slots: DeckSlot[] = [];
  for (const slot of value) {
    if (
      !isRecord(slot) ||
      !nonempty(slot['name']) ||
      !Number.isSafeInteger(slot['count']) ||
      (slot['count'] as number) <= 0
    ) {
      return 'every deck slot needs a name and a positive safe-integer count';
    }
    const origin = readOrigin(slot['origin']);
    if (typeof origin === 'string') return origin;
    if (requireOrigin && origin === undefined) {
      return 'every mixed-content deck slot needs an explicit printed or custom origin';
    }
    slots.push({
      name: slot['name'],
      count: slot['count'] as number,
      ...(origin === undefined ? {} : { origin }),
    });
  }
  return slots;
}

/** A deck off the wire; `requireOrigin` is true when the content is mixed. */
export function readDeck(value: unknown, requireOrigin: boolean): string | DeckRef {
  if (!isRecord(value) || !nonempty(value['name']) || !Array.isArray(value['cards'])) {
    return 'each seat needs a named deck and a card list';
  }
  const cards = readSlots(value['cards'], requireOrigin);
  if (typeof cards === 'string') return cards;
  // The command zone's cards ride beside the main deck rather than in it, so
  // a reader that rebuilt the deck from `cards` alone would hand the backend a
  // commander table with no commander and let the backend refuse a deck the
  // browser had filled in.
  if (value['commanders'] === undefined) return { name: value['name'], cards };
  const commanders = readSlots(value['commanders'], requireOrigin);
  if (typeof commanders === 'string') return commanders;
  return { name: value['name'], cards, commanders };
}

export function readRules(value: unknown): string | MatchRules | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    (value['variant'] !== 'standard' && value['variant'] !== 'commander' && value['variant'] !== 'momir') ||
    !Number.isSafeInteger(value['startingLife']) ||
    (value['startingLife'] as number) <= 0
  ) {
    return 'match rules name a standard, commander, or momir variant and a positive starting life';
  }
  return { variant: value['variant'], startingLife: value['startingLife'] as number };
}

export function readContent(value: unknown): string | ContentRef {
  if (!isRecord(value)) return 'the request has no content reference';
  if (value['kind'] === 'dsl-set' && nonempty(value['setCode'])) {
    return { kind: 'dsl-set', setCode: value['setCode'] };
  }
  if (value['kind'] === 'printed' && nonempty(value['format'])) {
    return { kind: 'printed', format: value['format'] };
  }
  if (
    value['kind'] === 'mixed' &&
    nonempty(value['format']) &&
    Array.isArray(value['customSetCodes']) &&
    value['customSetCodes'].length > 0 &&
    value['customSetCodes'].every(nonempty)
  ) {
    return { kind: 'mixed', format: value['format'], customSetCodes: [...value['customSetCodes']] };
  }
  return 'the request has no supported content reference';
}

/** The seed field: a string, or null to let the backend pick. */
export function readSeed(value: unknown): string | { readonly seed: string | null } {
  if (value !== null && typeof value !== 'string') return 'the seed must be a string or null';
  return { seed: value };
}

/** The turn limit: a positive safe integer, or null for the backend's own. */
export function readMaximumTurns(value: unknown): string | { readonly maximumTurns: number | null } {
  if (value !== null && (!Number.isSafeInteger(value) || (value as number) <= 0)) {
    return 'the turn limit must be a positive safe integer or null';
  }
  return { maximumTurns: value as number | null };
}

/**
 * The seat count of a table: absent for the two-seat game, otherwise a whole
 * number from `MIN_SEATS` to `most`. Wrapped like `readSeed`, because a count
 * is a number and so is nothing a refusal could be confused with.
 */
export function readSeatCount(value: unknown, most: number): string | { readonly seats?: number } {
  if (value === undefined) return {};
  if (!Number.isSafeInteger(value) || (value as number) < MIN_SEATS || (value as number) > most) {
    return `a table seats a whole number of players from ${String(MIN_SEATS)} to ${String(most)}`;
  }
  return { seats: value as number };
}
