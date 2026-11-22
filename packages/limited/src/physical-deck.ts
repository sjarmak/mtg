/**
 * A Limited deck built from physical picks rather than card-name counts.
 *
 * The edit model keeps one `physicalId` per drafted copy all the way through
 * suggestion and manual edits. Only `toDeckRef` collapses those copies to the
 * named/counted vocabulary shared by rules backends, and it does so only after
 * checking ownership again and deck size. A caller supplies every card fact: this
 * layer owns deterministic arithmetic, not judgments about printed cards.
 */
import type { DeckRef, DeckSlot } from '@mtg/engine';

export const LIMITED_COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
export type LimitedColor = (typeof LIMITED_COLORS)[number];

export const CANONICAL_BASIC_NAMES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const;
export type CanonicalBasicName = (typeof CANONICAL_BASIC_NAMES)[number];

export const DEFAULT_LIMITED_MINIMUM_DECK_SIZE = 40;
export const DEFAULT_LIMITED_BASIC_LANDS = 17;

const BASIC_FOR_COLOR: Readonly<Record<LimitedColor, CanonicalBasicName>> = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
};

export type LimitedCardType = 'creature' | 'noncreature-spell' | 'nonbasic-land';
export type LimitedCardRole = 'interaction';

/** Facts the card source attests; none are inferred from rules text here. */
export interface LimitedCardFacts {
  readonly name: string;
  readonly colors: readonly LimitedColor[];
  readonly manaValue: number;
  readonly type: LimitedCardType;
  /** Caller-owned evaluation. Higher is selected first. */
  readonly score: number;
  /** Optional caller-attested functional roles. Absence means unknown, not empty. */
  readonly roles?: readonly LimitedCardRole[];
}

/** One drafted physical copy. The payload remains opaque to this package. */
export interface PhysicalPoolCard<Payload> {
  readonly physicalId: string;
  readonly payload: Payload;
}

export type LimitedFactsResolver<Payload> = (
  card: PhysicalPoolCard<Payload>,
) => LimitedCardFacts | null | undefined;

export interface PreparedPoolCard<Payload> extends PhysicalPoolCard<Payload> {
  readonly facts: LimitedCardFacts;
}

export interface LimitedDeckOptions {
  readonly minimumDeckSize?: number;
  readonly suggestedBasicLands?: number;
}

export interface LimitedDeck<Payload> {
  readonly pool: readonly PreparedPoolCard<Payload>[];
  readonly selectedPhysicalIds: readonly string[];
  readonly basics: Readonly<Record<CanonicalBasicName, number>>;
  readonly minimumDeckSize: number;
  readonly suggestedBasicLands: number;
}

export type LimitedDeckErrorCode =
  | 'duplicate-physical-id'
  | 'duplicate-selection'
  | 'insufficient-basic-count'
  | 'insufficient-pool'
  | 'invalid-basic-count'
  | 'invalid-card-facts'
  | 'invalid-deck-name'
  | 'invalid-deck-options'
  | 'invalid-physical-id'
  | 'invalid-selection-policy'
  | 'physical-card-not-selected'
  | 'short-deck'
  | 'unknown-physical-id'
  | 'unresolved-card-facts';

export class LimitedDeckError extends Error {
  readonly code: LimitedDeckErrorCode;
  readonly physicalId?: string;

  constructor(code: LimitedDeckErrorCode, message: string, physicalId?: string) {
    super(message);
    this.name = 'LimitedDeckError';
    this.code = code;
    if (physicalId !== undefined) this.physicalId = physicalId;
  }
}

export interface LimitedDeckReport {
  readonly legal: boolean;
  readonly cards: number;
  readonly minimumDeckSize: number;
  readonly draftedCards: number;
  readonly basicLands: number;
  readonly creatures: number;
  readonly noncreatureSpells: number;
  readonly nonbasicLands: number;
  readonly colors: Readonly<Record<LimitedColor, number>>;
  readonly manaValues: Readonly<Record<string, number>>;
  readonly missingCards: number;
}

function emptyBasics(): Record<CanonicalBasicName, number> {
  return { Plains: 0, Island: 0, Swamp: 0, Mountain: 0, Forest: 0 };
}

function assertNonnegativeInteger(value: number, code: LimitedDeckErrorCode, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new LimitedDeckError(code, `${label} must be a nonnegative safe integer, got ${String(value)}`);
  }
}

function assertOptions(options: LimitedDeckOptions): {
  readonly minimumDeckSize: number;
  readonly suggestedBasicLands: number;
} {
  const minimumDeckSize = options.minimumDeckSize ?? DEFAULT_LIMITED_MINIMUM_DECK_SIZE;
  const suggestedBasicLands = options.suggestedBasicLands ?? DEFAULT_LIMITED_BASIC_LANDS;
  if (!Number.isSafeInteger(minimumDeckSize) || minimumDeckSize <= 0) {
    throw new LimitedDeckError(
      'invalid-deck-options',
      `minimum deck size must be a positive safe integer, got ${String(minimumDeckSize)}`,
    );
  }
  assertNonnegativeInteger(suggestedBasicLands, 'invalid-deck-options', 'suggested basic-land count');
  if (suggestedBasicLands > minimumDeckSize) {
    throw new LimitedDeckError(
      'invalid-deck-options',
      `suggested basic-land count ${String(suggestedBasicLands)} exceeds minimum deck size ${String(minimumDeckSize)}`,
    );
  }
  return { minimumDeckSize, suggestedBasicLands };
}

function copyFacts(facts: LimitedCardFacts, physicalId: string): LimitedCardFacts {
  if (typeof facts.name !== 'string' || !Array.isArray(facts.colors)) {
    throw new LimitedDeckError(
      'invalid-card-facts',
      `printed-card facts for ${physicalId} are malformed`,
      physicalId,
    );
  }
  const name = facts.name.trim();
  const colors = [...facts.colors];
  const roles = facts.roles === undefined ? undefined : [...facts.roles];
  const validColors = new Set<string>(LIMITED_COLORS);
  const validRoles = new Set<string>(['interaction']);
  const validTypes = new Set<string>(['creature', 'noncreature-spell', 'nonbasic-land']);
  if (
    name.length === 0 ||
    !Number.isFinite(facts.score) ||
    !Number.isFinite(facts.manaValue) ||
    !Number.isInteger(facts.manaValue) ||
    facts.manaValue < 0 ||
    colors.some((color) => !validColors.has(color)) ||
    new Set(colors).size !== colors.length ||
    (roles !== undefined &&
      (roles.some((role) => !validRoles.has(role)) || new Set(roles).size !== roles.length)) ||
    !validTypes.has(facts.type)
  ) {
    throw new LimitedDeckError(
      'invalid-card-facts',
      `printed-card facts for ${physicalId} are malformed`,
      physicalId,
    );
  }
  return roles === undefined ? { ...facts, name, colors } : { ...facts, name, colors, roles };
}

/** Resolve and pin every fact before an edit can begin. */
export function prepareLimitedDeck<Payload>(
  cards: readonly PhysicalPoolCard<Payload>[],
  factsFor: LimitedFactsResolver<Payload>,
  options: LimitedDeckOptions = {},
): LimitedDeck<Payload> {
  const resolvedOptions = assertOptions(options);
  const seen = new Set<string>();
  const pool = cards.map((card): PreparedPoolCard<Payload> => {
    if (card.physicalId.trim().length === 0) {
      throw new LimitedDeckError('invalid-physical-id', 'a physical id must not be empty', card.physicalId);
    }
    if (seen.has(card.physicalId)) {
      throw new LimitedDeckError(
        'duplicate-physical-id',
        `physical id ${card.physicalId} appears twice in the drafted pool`,
        card.physicalId,
      );
    }
    seen.add(card.physicalId);
    const facts = factsFor(card);
    if (facts === null || facts === undefined) {
      throw new LimitedDeckError(
        'unresolved-card-facts',
        `printed-card facts for ${card.physicalId} are unresolved`,
        card.physicalId,
      );
    }
    return { physicalId: card.physicalId, payload: card.payload, facts: copyFacts(facts, card.physicalId) };
  });
  return {
    pool,
    selectedPhysicalIds: [],
    basics: emptyBasics(),
    ...resolvedOptions,
  };
}

function poolById<Payload>(deck: LimitedDeck<Payload>): ReadonlyMap<string, PreparedPoolCard<Payload>> {
  const pool = new Map<string, PreparedPoolCard<Payload>>();
  for (const card of deck.pool) {
    if (card.physicalId.trim().length === 0) {
      throw new LimitedDeckError('invalid-physical-id', 'a physical id must not be empty', card.physicalId);
    }
    if (pool.has(card.physicalId)) {
      throw new LimitedDeckError(
        'duplicate-physical-id',
        `physical id ${card.physicalId} appears twice in the drafted pool`,
        card.physicalId,
      );
    }
    copyFacts(card.facts, card.physicalId);
    pool.set(card.physicalId, card);
  }
  return pool;
}

function selectedCards<Payload>(deck: LimitedDeck<Payload>): readonly PreparedPoolCard<Payload>[] {
  const pool = poolById(deck);
  const seen = new Set<string>();
  return deck.selectedPhysicalIds.map((physicalId) => {
    if (seen.has(physicalId)) {
      throw new LimitedDeckError(
        'duplicate-selection',
        `physical id ${physicalId} is selected more than once`,
        physicalId,
      );
    }
    seen.add(physicalId);
    const card = pool.get(physicalId);
    if (card === undefined) {
      throw new LimitedDeckError(
        'unknown-physical-id',
        `physical id ${physicalId} is not in this drafted pool`,
        physicalId,
      );
    }
    return card;
  });
}

function checkedBasics<Payload>(deck: LimitedDeck<Payload>): Readonly<Record<CanonicalBasicName, number>> {
  const basics = emptyBasics();
  for (const name of CANONICAL_BASIC_NAMES) {
    const count = deck.basics[name];
    assertNonnegativeInteger(count, 'invalid-basic-count', `${name} count`);
    basics[name] = count;
  }
  return basics;
}

function basicTotal(basics: Readonly<Record<CanonicalBasicName, number>>): number {
  return CANONICAL_BASIC_NAMES.reduce((sum, name) => sum + basics[name], 0);
}

/** Hamilton apportionment over selected cards' caller-attested colors. */
function suggestedBasics<Payload>(
  selected: readonly PreparedPoolCard<Payload>[],
  total: number,
): Readonly<Record<CanonicalBasicName, number>> {
  const weights: Record<LimitedColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const card of selected) for (const color of card.facts.colors) weights[color] += 1;
  let denominator = LIMITED_COLORS.reduce((sum, color) => sum + weights[color], 0);
  if (denominator === 0) {
    for (const color of LIMITED_COLORS) weights[color] = 1;
    denominator = LIMITED_COLORS.length;
  }

  const basics = emptyBasics();
  const shares = LIMITED_COLORS.map((color, order) => {
    const exact = (weights[color] * total) / denominator;
    const floor = Math.floor(exact);
    basics[BASIC_FOR_COLOR[color]] = floor;
    return { color, order, remainder: exact - floor };
  });
  let left = total - basicTotal(basics);
  shares.sort((leftShare, rightShare) =>
    rightShare.remainder === leftShare.remainder
      ? leftShare.order - rightShare.order
      : rightShare.remainder - leftShare.remainder,
  );
  for (const share of shares) {
    if (left === 0) break;
    basics[BASIC_FOR_COLOR[share.color]] += 1;
    left -= 1;
  }
  return basics;
}

/** Re-apportion the configured basic-land count over the cards currently selected. */
export function suggestLimitedBasics<Payload>(deck: LimitedDeck<Payload>): LimitedDeck<Payload> {
  assertOptions(deck);
  const selected = selectedCards(deck);
  return { ...deck, basics: suggestedBasics(selected, deck.suggestedBasicLands) };
}

/** Replace the current edit with the deterministic score-ranked suggestion. */
export function suggestLimitedDeck<Payload>(deck: LimitedDeck<Payload>): LimitedDeck<Payload> {
  assertOptions(deck);
  const pool = [...poolById(deck).values()];
  const draftedTarget = deck.minimumDeckSize - deck.suggestedBasicLands;
  if (pool.length < draftedTarget) {
    throw new LimitedDeckError(
      'insufficient-pool',
      `the drafted pool holds ${String(pool.length)} cards but suggestion needs ${String(draftedTarget)}`,
    );
  }
  const ranked = pool
    .map((card, order) => ({ card, order }))
    .sort((left, right) => right.card.facts.score - left.card.facts.score || left.order - right.order)
    .slice(0, draftedTarget)
    .map(({ card }) => card);
  return {
    ...deck,
    selectedPhysicalIds: ranked.map((card) => card.physicalId),
    basics: suggestedBasics(ranked, deck.suggestedBasicLands),
  };
}

export function addPhysicalCard<Payload>(
  deck: LimitedDeck<Payload>,
  physicalId: string,
): LimitedDeck<Payload> {
  const pool = poolById(deck);
  selectedCards(deck);
  if (!pool.has(physicalId)) {
    throw new LimitedDeckError(
      'unknown-physical-id',
      `physical id ${physicalId} is not in this drafted pool`,
      physicalId,
    );
  }
  if (deck.selectedPhysicalIds.includes(physicalId)) {
    throw new LimitedDeckError(
      'duplicate-selection',
      `physical id ${physicalId} is already selected`,
      physicalId,
    );
  }
  return { ...deck, selectedPhysicalIds: [...deck.selectedPhysicalIds, physicalId] };
}

export function cutPhysicalCard<Payload>(
  deck: LimitedDeck<Payload>,
  physicalId: string,
): LimitedDeck<Payload> {
  const pool = poolById(deck);
  selectedCards(deck);
  if (!pool.has(physicalId)) {
    throw new LimitedDeckError(
      'unknown-physical-id',
      `physical id ${physicalId} is not in this drafted pool`,
      physicalId,
    );
  }
  if (!deck.selectedPhysicalIds.includes(physicalId)) {
    throw new LimitedDeckError(
      'physical-card-not-selected',
      `physical id ${physicalId} is not selected`,
      physicalId,
    );
  }
  return { ...deck, selectedPhysicalIds: deck.selectedPhysicalIds.filter((id) => id !== physicalId) };
}

export function setBasicCount<Payload>(
  deck: LimitedDeck<Payload>,
  name: CanonicalBasicName,
  count: number,
): LimitedDeck<Payload> {
  selectedCards(deck);
  checkedBasics(deck);
  assertNonnegativeInteger(count, 'invalid-basic-count', `${name} count`);
  return { ...deck, basics: { ...deck.basics, [name]: count } };
}

export function addBasic<Payload>(
  deck: LimitedDeck<Payload>,
  name: CanonicalBasicName,
  count = 1,
): LimitedDeck<Payload> {
  assertNonnegativeInteger(count, 'invalid-basic-count', `${name} addition`);
  return setBasicCount(deck, name, deck.basics[name] + count);
}

export function cutBasic<Payload>(
  deck: LimitedDeck<Payload>,
  name: CanonicalBasicName,
  count = 1,
): LimitedDeck<Payload> {
  assertNonnegativeInteger(count, 'invalid-basic-count', `${name} cut`);
  const remaining = deck.basics[name] - count;
  if (remaining < 0) {
    throw new LimitedDeckError(
      'insufficient-basic-count',
      `cannot cut ${String(count)} ${name}; the deck contains ${String(deck.basics[name])}`,
    );
  }
  return setBasicCount(deck, name, remaining);
}

export function validateLimitedDeck<Payload>(deck: LimitedDeck<Payload>): LimitedDeckReport {
  assertOptions(deck);
  const selected = selectedCards(deck);
  const basics = checkedBasics(deck);
  const colors: Record<LimitedColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const manaValues: Record<string, number> = {};
  let creatures = 0;
  let noncreatureSpells = 0;
  let nonbasicLands = 0;
  for (const card of selected) {
    if (card.facts.type === 'creature') creatures += 1;
    else if (card.facts.type === 'noncreature-spell') noncreatureSpells += 1;
    else nonbasicLands += 1;
    for (const color of card.facts.colors) colors[color] += 1;
    const manaValue = String(card.facts.manaValue);
    manaValues[manaValue] = (manaValues[manaValue] ?? 0) + 1;
  }
  const basicLands = basicTotal(basics);
  const cards = selected.length + basicLands;
  return {
    legal: cards >= deck.minimumDeckSize,
    cards,
    minimumDeckSize: deck.minimumDeckSize,
    draftedCards: selected.length,
    basicLands,
    creatures,
    noncreatureSpells,
    nonbasicLands,
    colors,
    manaValues,
    missingCards: Math.max(0, deck.minimumDeckSize - cards),
  };
}

function countedSlots(
  entries: readonly { readonly name: string; readonly count: number }[],
): readonly DeckSlot[] {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.name, (counts.get(entry.name) ?? 0) + entry.count);
  return [...counts].map(([name, count]) => ({ name, count }));
}

/** The only operation that intentionally forgets physical-copy identity. */
export function toDeckRef<Payload>(deck: LimitedDeck<Payload>, name: string): DeckRef {
  const report = validateLimitedDeck(deck);
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    throw new LimitedDeckError('invalid-deck-name', 'a backend deck name must not be empty');
  }
  if (!report.legal) {
    throw new LimitedDeckError(
      'short-deck',
      `deck has ${String(report.cards)} cards; Limited requires at least ${String(report.minimumDeckSize)}`,
    );
  }
  const selected = selectedCards(deck).map((card) => ({ name: card.facts.name, count: 1 }));
  const basics = CANONICAL_BASIC_NAMES.flatMap((basicName) => {
    const count = deck.basics[basicName];
    return count === 0 ? [] : [{ name: basicName, count }];
  });
  return { name: trimmedName, cards: countedSlots([...selected, ...basics]) };
}
