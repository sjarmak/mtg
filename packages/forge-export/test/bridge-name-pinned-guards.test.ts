/**
 * Blast-radius sweep for the Convoke guard (mtg-uz0mz): a printed card carrying Convoke must not
 * reach a card-name pin in the bridge's Convoke predicate that does not name it. Convoke is a
 * payment callback Forge consults while building the priority menu, so a refusal there ends the
 * match with the card merely in hand.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');
const dataRoot = new URL('../../data/data/', import.meta.url);

interface CatalogCard {
  readonly name: string;
  readonly oracleText: string;
}

function methodBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`bridge no longer declares ${signature}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`unterminated body for ${signature}`);
}

function stagedCatalogs(): ReadonlyMap<string, readonly CatalogCard[]> {
  const catalogs = new Map<string, readonly CatalogCard[]>();
  for (const format of readdirSync(dataRoot, { withFileTypes: true })) {
    if (!format.isDirectory()) continue;
    const dir = new URL(`${format.name}/`, dataRoot);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('-printed-catalog-v1.json')) continue;
      const parsed = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as {
        cards: readonly CatalogCard[];
      };
      catalogs.set(format.name, parsed.cards);
    }
  }
  return catalogs;
}

/**
 * A card admission actually stakes: `review: "reviewed"` in a format's own `admission.json`,
 * cross-referenced by id against that same directory's printed catalogs. A card that merely
 * appears in a reprint/reference catalog staged alongside a format (e.g. an `rtr` reference
 * file sitting in `dgm/`) but was never built into that format's own admission is not reviewed
 * there, so it is excluded here the same way the bridge itself never sees it for that format.
 */
interface ReviewedCard {
  readonly format: string;
  readonly name: string;
  readonly oracleText: string;
}

function reviewedCards(): readonly ReviewedCard[] {
  const reviewed: ReviewedCard[] = [];
  for (const format of readdirSync(dataRoot, { withFileTypes: true })) {
    if (!format.isDirectory()) continue;
    const dir = new URL(`${format.name}/`, dataRoot);
    const byId = new Map<string, CatalogCard>();
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('-printed-catalog-v1.json')) continue;
      const parsed = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as {
        cards: readonly (CatalogCard & { physicalId?: string; id?: string })[];
      };
      for (const card of parsed.cards) {
        const id = card.physicalId ?? card.id;
        if (id !== undefined) byId.set(id, card);
      }
    }
    const admissionDir = readdirSync(dir, { withFileTypes: true }).find(
      (entry) => entry.isDirectory() && entry.name === 'play-admission',
    );
    if (admissionDir === undefined) continue;
    const admissionFile = new URL(`${admissionDir.name}/admission.json`, dir);
    const admission = JSON.parse(readFileSync(admissionFile, 'utf8')) as {
      cards: readonly { id: string; review: string }[];
    };
    for (const entry of admission.cards) {
      if (entry.review !== 'reviewed') continue;
      const card = byId.get(entry.id);
      if (card === undefined) continue;
      reviewed.push({ format: format.name, name: card.name, oracleText: card.oracleText });
    }
  }
  return reviewed;
}

/** Slices one brace-matched block out of a method body, anchored at its opening marker text. */
function subBlock(body: string, marker: string): string {
  const start = body.indexOf(marker);
  if (start < 0) throw new Error(`marker not found: ${marker}`);
  const open = body.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < body.length; i++) {
    if (body[i] === '{') depth++;
    if (body[i] === '}' && --depth === 0) return body.slice(open, i + 1);
  }
  throw new Error(`unterminated block for marker: ${marker}`);
}

/** A reviewed card whose text matches a guard's reachability marker but is absent from its pins. */
interface GuardViolation {
  readonly format: string;
  readonly name: string;
}

function findUnpinnedReachable(
  cards: readonly ReviewedCard[],
  pinnedNames: readonly string[],
  reachable: RegExp,
): readonly GuardViolation[] {
  return cards
    .filter((card) => reachable.test(card.oracleText) && !pinnedNames.includes(card.name))
    .map((card) => ({ format: card.format, name: card.name }));
}

function describeViolations(guard: string, violations: readonly GuardViolation[]): string {
  const named = violations.map((v) => `${v.name} (${v.format})`).join(', ');
  return `${guard} is missing a name pin for reviewed card(s) reachable through it: ${named}`;
}

const convokeGuard = methodBody(bridge, 'private boolean isReviewedConvokeAbility(');
const pinnedNames = [...convokeGuard.matchAll(/"([^"]+)"\.equals\(source\.getName\(\)\)/gu)].flatMap(
  (m) => m[1] ?? [],
);
const companionKeyword = /\b(?:Delve|Improvise|Assist)\b/u;

describe('the Convoke guard against every staged printed catalog', () => {
  const catalogs = stagedCatalogs();
  const convokeCards = [...catalogs].flatMap(([format, cards]) =>
    cards
      .filter((card) => /\bConvoke\b/u.test(card.oracleText))
      .map((card) => ({ format, name: card.name, oracleText: card.oracleText })),
  );

  it('sees the cards the Commander failure named, so the sweep cannot pass vacuously', () => {
    const scd = convokeCards.filter((card) => card.format === 'scd').map((card) => card.name);
    expect(scd).toEqual(
      expect.arrayContaining([
        'Devouring Light',
        'Hour of Reckoning',
        'March of the Multitudes',
        "Nissa's Expedition",
        'Scatter the Seeds',
        'Conclave Tribunal',
      ]),
    );
    expect(convokeCards.filter((card) => card.format === 'm15').length).toBeGreaterThanOrEqual(20);
  });

  it('pins a card name only where the card carries a second payment keyword', () => {
    expect(pinnedNames.length).toBeGreaterThan(0);
    for (const name of pinnedNames) {
      const printed = convokeCards.find((card) => card.name === name);
      if (printed === undefined) continue;
      expect(printed.oracleText, `${name} is name-pinned but pays through plain Convoke`).toMatch(
        companionKeyword,
      );
    }
  });

  it('reaches at least twenty distinct plain-Convoke cards through the structural branch', () => {
    const plain = convokeCards.filter((card) => !companionKeyword.test(card.oracleText));
    expect(plain.filter((card) => pinnedNames.includes(card.name))).toEqual([]);
    expect(new Set(plain.map((card) => card.name)).size).toBeGreaterThanOrEqual(20);
  });
});

/**
 * Generalized sweep (mtg-uz0mz.1): every other Forge-facing entry point whose body dispatches
 * over more than one literal card name AND whose fallback for an unmatched name is itself an
 * unconditional "outside ... reviewed ..." throw, rather than a working generic default. Most
 * `@Override` dispatchers in the bridge are NOT this shape — `getCostDecisionMaker`,
 * `chooseTargetsFor`, `confirmTrigger`, `chooseCardsPile`, `chooseCardsForEffect` and
 * `chooseEntitiesForEffect` all fall through to a safe, non-throwing default for any card not
 * named in their per-card special cases, so an unrecognized admitted card degrades to ordinary
 * handling rather than crashing the match. Only a genuine multi-name whitelist-with-throwing-
 * fallback belongs in this sweep; see the closing note on mtg-6su7e for the read that narrowed
 * the candidate list down to these two.
 */
describe('generalized name-pinned guards beyond Convoke', () => {
  const cards = reviewedCards();

  describe('the specifyManaCombo guard (mana split across colors) against every reviewed card', () => {
    const guardBody = methodBody(bridge, 'public Map<Byte, Integer> specifyManaCombo(');
    const pinnedNames = [...guardBody.matchAll(/"([^"]+)"\.equals\(source\.getName\(\)\)/gu)].flatMap(
      (m) => m[1] ?? [],
    );
    // Forge's real templating for this exact split-mana mechanic: "Add X mana in any
    // combination of {colors}" / "...in any combination of colors". Verified against every
    // card the phrase currently matches in the staged catalogs before trusting it as a signal.
    const reachable = /\bin any combination of\b/iu;

    it('pins every reviewed split-mana source', () => {
      expect(pinnedNames).toEqual(
        expect.arrayContaining([
          'Xenagos, the Reveler',
          'Coalition Relic',
          'Altar of the Lost',
          'Cascading Cataracts',
          'Molten Slagheap',
          'Plasm Capture',
          'Axebane Guardian',
          'Market Festival',
          'Terrarion',
          'Smokebraider',
        ]),
      );
    });

    it('has no reviewed split-mana source outside the guard', () => {
      expect(findUnpinnedReachable(cards, pinnedNames, reachable)).toEqual([]);
    });
  });

  describe('the chooseModeForAbility repeatable-mode guard (Confluence charms) against every reviewed card', () => {
    const dispatcherBody = methodBody(bridge, 'public List<AbilitySub> chooseModeForAbility(');
    const repeatableModeBlock = subBlock(dispatcherBody, 'if (allowRepeat) {');
    const literalPins = [...repeatableModeBlock.matchAll(/"([^"]+)"\.equals\(source\)/gu)].flatMap(
      (m) => m[1] ?? [],
    );
    // Mystic Confluence is admitted through session.isReviewedMysticConfluenceCharm(...) rather
    // than a literal name check inlined in this block; that helper pins it by name at
    // ForgeBridge.java:2966. Listed here so the sweep does not read it as unpinned.
    const pinnedNames = [...literalPins, 'Mystic Confluence'];
    const reachable = /you may choose the same mode more than once/iu;

    it('pins the Confluence cycle it hand-checks', () => {
      expect(pinnedNames).toEqual(
        expect.arrayContaining(['Wretched Confluence', 'Fiery Confluence', 'Mystic Confluence']),
      );
    });

    it('reaches no unpinned reviewed repeatable-mode card', () => {
      expect(findUnpinnedReachable(cards, pinnedNames, reachable)).toEqual([]);
    });
  });

  describe('negative control: the sweep actually fires on a fabricated gap', () => {
    it('reports a synthetic reviewed card that a guard does not pin', () => {
      const fabricated: readonly ReviewedCard[] = [
        {
          format: 'synthetic-test-format',
          name: 'Fabricated Confluence of Nothing',
          oracleText: 'Choose three. You may choose the same mode more than once.',
        },
      ];
      const violations = findUnpinnedReachable(
        fabricated,
        ['Wretched Confluence', 'Fiery Confluence', 'Mystic Confluence'],
        /you may choose the same mode more than once/iu,
      );
      expect(violations).toEqual([
        { format: 'synthetic-test-format', name: 'Fabricated Confluence of Nothing' },
      ]);
      const message = describeViolations('chooseModeForAbility', violations);
      expect(message).toContain('chooseModeForAbility');
      expect(message).toContain('Fabricated Confluence of Nothing');
      expect(message).toContain('synthetic-test-format');
    });
  });
});
