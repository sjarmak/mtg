/**
 * A brief that already exists, read back into the editor; and the draft that
 * survives a reload.
 *
 * `mtg-yddw.2`. Two directions over one shape, kept out of `./draft.ts` so that
 * file stays the one statement of what a draft *is*.
 *
 * # Reading a brief in
 *
 * A brief on disk is the file `npm run design` and the CLI both read, so opening
 * one has to work on a file this editor never wrote — the three shipped briefs
 * under `packages/setgen/briefs/` are the cases that matter. Every field is
 * taken defensively: this is JSON from outside, and the schema that judges it
 * lives on the server, so nothing here may assume a shape. A field that is
 * missing or the wrong type becomes the blank a person can then fill in, which
 * is the only reading that leaves the file openable at all. Nothing is refused
 * and nothing is repaired silently — an unreadable value shows as empty, and the
 * server's own refusal is what says so.
 *
 * # Keeping the draft
 *
 * `localStorage`, through `../deck/local-store.ts`, under one key. A brief is
 * work: a paragraph of theme and a list of named cards is an evening, and losing
 * it to a reload is the failure this costs fifteen lines to avoid. A write that
 * cannot be kept is reported to the caller rather than swallowed, because a
 * private window silently discarding an evening's work is worse than a sentence
 * saying it will.
 */
import { readStored, writeStored } from '../deck/local-store';
import { blankDraft, EMPTY_REQUIRED_CARD } from './draft';
import type { BriefDraft, MechanicDraft, RequiredCardDraft, SignatureDraft, SpellRolesDraft } from './draft';

/** One key, named for what it holds rather than for this route. */
export const DRAFT_STORAGE_KEY = 'mtg.design.draft.v1';

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function flag(value: unknown): boolean {
  return value === true;
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function textList(value: unknown): readonly string[] {
  return list(value)
    .map((entry) => text(entry))
    .filter((entry) => entry !== '');
}

function mechanicFrom(value: unknown): MechanicDraft {
  const source = record(value);
  return {
    name: text(source['name']),
    description: text(source['description']),
    keywords: textList(source['keywords']),
    effectKinds: textList(source['effectKinds']),
    abilityKinds: textList(source['abilityKinds']),
    triggerConditions: textList(source['triggerConditions']),
    colors: textList(source['colors']),
  };
}

function requiredCardFrom(value: unknown): RequiredCardDraft {
  const source = record(value);
  return {
    ...EMPTY_REQUIRED_CARD,
    name: text(source['name']),
    color: text(source['color']),
    cardKind: text(source['cardKind']),
    rarity: text(source['rarity']),
    seatCeiling: text(source['seatCeiling']),
    manaValue: text(source['manaValue']),
    flavorDirection: text(source['flavorDirection']),
    equipment: flag(source['equipment']),
    legendary: flag(source['legendary']),
    partCounter: text(source['partCounter']),
    sacrificeSubtype: text(source['sacrificeSubtype']),
    suppliesSubtype: text(source['suppliesSubtype']),
  };
}

function spellRolesFrom(value: unknown): SpellRolesDraft {
  const source = record(value);
  return {
    rarity: text(source['rarity']),
    pool: text(source['pool']),
    roles: textList(source['roles']),
    why: text(source['why']),
  };
}

function signatureFrom(value: unknown): SignatureDraft {
  const source = record(value);
  return { color: text(source['color']), absent: textList(source['absent']) };
}

/**
 * Any JSON value read as a draft.
 *
 * `authoredCards` is deliberately not read and not written. A finished DSL card
 * is a card, held to the same legality a generated one is, and an editor that
 * offered a text box for one would be offering to break a brief that already
 * carries ninety-six of them. The flagship's list is the case: opening it here
 * and saving it back must not be how those cards are lost. That is why this
 * function returns a draft and `../design/DesignRoute.ts` keeps the *opened
 * document* beside it, so what this editor does not model is carried through
 * rather than dropped.
 */
export function draftFrom(value: unknown): BriefDraft {
  const source = record(value);
  const mechanics = list(source['mechanics']).map(mechanicFrom);
  return {
    ...blankDraft(),
    setCode: text(source['setCode']),
    setName: text(source['setName']),
    theme: text(source['theme']),
    seed: text(source['seed']),
    targetSize: text(source['targetSize']),
    tertiaryBudget: text(source['tertiaryBudget']),
    // The floor is one and an empty list would give the mechanics panel nothing
    // to draw, so a file with none opens on the same single blank a new brief
    // opens on.
    mechanics: mechanics.length === 0 ? blankDraft().mechanics : mechanics,
    archetypeNotes: textList(source['archetypeNotes']),
    requiredCards: list(source['requiredCards']).map(requiredCardFrom),
    spellRoles: list(source['spellRoles']).map(spellRolesFrom),
    colorSignatures: list(source['colorSignatures']).map(signatureFrom),
  };
}

/** The parsed brief text, or the reason it is not JSON at all. */
export type BriefParse =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string };

export function parseBriefText(text: string): BriefParse {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (cause: unknown) {
    return {
      ok: false,
      message: `This is not JSON, so there is nothing to read yet (${cause instanceof Error ? cause.message : String(cause)}).`,
    };
  }
}

/** The kept draft, or null when nothing is kept or the store is unreachable. */
export function readDraft(): BriefDraft | null {
  const kept = readStored(DRAFT_STORAGE_KEY);
  if (kept === null) return null;
  const parsed = parseBriefText(kept);
  return parsed.ok ? draftFrom(parsed.value) : null;
}

/** Keeps the draft. False means it will not survive a reload. */
export function writeDraft(draft: BriefDraft): boolean {
  return writeStored(DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

/** The keys `../design/draft.ts` models, and so the keys that are not carried. */
const MODELED_KEYS: readonly string[] = [
  'setCode',
  'setName',
  'theme',
  'seed',
  'targetSize',
  'tertiaryBudget',
  'mechanics',
  'archetypeNotes',
  'requiredCards',
  'spellRoles',
  'colorSignatures',
];

/**
 * Everything in an opened brief this editor does not model, kept as it arrived.
 *
 * `authoredCards` is the case that matters: the flagship brief carries dozens of
 * finished DSL cards, and an editor that opened that file, showed the fields it
 * understands and wrote the file back would delete them. Nothing here reads or
 * offers those cards — a finished card is held to the same legality a generated
 * one is, and a text box for one is a way to break a brief. They are carried
 * through untouched, and the field list is derived from the modeled keys rather
 * than written out, so a key this editor stops modeling starts being carried
 * instead of starting to vanish.
 */
export function carriedFrom(value: unknown): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(record(value)).filter(([key]) => !MODELED_KEYS.includes(key)));
}
