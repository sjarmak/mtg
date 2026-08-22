/**
 * One-shot effect scopes: the vocabulary's word for "more than one object".
 *
 * `scope` is a second optional field beside `target`, and the schema cannot say
 * that the two are one statement — that a scoped effect targets a *player* and
 * an unscoped one targets what it moves. So the pairing is a validator rule, and
 * these are the assertions that it holds in both directions, because only one
 * direction is obvious. A scope on a creature slot is the visible mistake; a
 * player slot with no scope is the quiet one, and it is quiet precisely because
 * the kernel would resolve it into nothing at all.
 *
 * The rest is the printed sentence. "Exile all creatures target opponent
 * controls" has no "target creature" in it, which is the whole of CR 115.1 as a
 * reader sees it, and a renderer that reached for `targetPhrase` alone would
 * print a card that lies about what can be protected from it.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput, Effect } from '../src/index';
import {
  EFFECT_SCOPES,
  isSpaceScope,
  legalTargetsFor,
  MODEL_EFFECT_KINDS,
  PLAYER_SCOPES,
  renderOracleText,
  targetKindNamesAPlayer,
  TARGET_KINDS,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

function sorceryInput(effects: readonly Effect[]): CardInput {
  return {
    kind: 'sorcery',
    id: 'tst-void-reckoning',
    name: 'Void Reckoning',
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 5, B: 2, R: 1 },
    colors: ['B', 'R'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  } as unknown as CardInput;
}

const SWEEP: Effect = {
  kind: 'exileTarget',
  scope: 'creaturesThatPlayerControls',
  target: { kind: 'targetOpponent' },
};

function codesFor(effects: readonly Effect[]): readonly string[] {
  const card = sorceryInput(effects) as unknown as Parameters<typeof validateCard>[0];
  return validateCard(card).map((found) => found.code);
}

describe('the one-shot scope vocabulary', () => {
  /**
   * Separate from `STATIC_SCOPES` on purpose, and the disjointness is the check
   * that nobody quietly merged them: a static scope is re-evaluated by the layer
   * walk on every query, a one-shot scope is read once at resolution and fixed
   * (CR 609.2). Sharing a tuple would mean one of the two exhaustive switches
   * carrying a member it has no rule for.
   *
   * The tuple has two halves inside it and the split is `isSpaceScope`'s, read
   * off `EFFECT_SCOPE_SUBJECT` rather than off how a member is spelled. The
   * order is pinned because it is append-only by construction: a scope inserted
   * in the middle would renumber nothing in the schema but would quietly change
   * which half a reader keyed by position lands in.
   */
  it('sorts every member into the player it reads its group off', () => {
    expect(EFFECT_SCOPES).toEqual([
      'creaturesThatPlayerControls',
      'creatureCardsInPlayerHand',
      'creatureCardsInPlayerGraveyard',
      'allPermanents',
      'permanentsYouControl',
      'permanentsOpponentsControl',
    ]);
    expect(EFFECT_SCOPES.filter((scope) => !isSpaceScope(scope))).toEqual([
      'creaturesThatPlayerControls',
      'creatureCardsInPlayerHand',
      'creatureCardsInPlayerGraveyard',
    ]);
    expect(EFFECT_SCOPES.filter(isSpaceScope)).toEqual([
      'allPermanents',
      'permanentsYouControl',
      'permanentsOpponentsControl',
    ]);
  });

  /**
   * `PLAYER_SCOPES` is beside `EFFECT_SCOPES` rather than inside it for the
   * reason the two scope tuples are separate from each other: "each player
   * draws a card" names no objects at all, so every reader that asks a scope
   * which zone and which bodies has nothing to ask it.
   *
   * Two members, and the second is what makes this a vocabulary rather than a
   * flag: `eachOpponent` reads the same seat list through one filter, so
   * Liliana's Specter's "each opponent discards a card" is a sweep the kernel
   * already knows how to walk rather than a target spelled loosely.
   */
  it('keeps the sweep over players out of the sweep over objects', () => {
    expect(PLAYER_SCOPES).toEqual(['eachPlayer', 'eachOpponent']);
    const objectScopes: readonly string[] = EFFECT_SCOPES;
    expect(objectScopes).not.toContain('eachPlayer');
    expect(objectScopes).not.toContain('eachOpponent');
  });

  /**
   * More than one member is why this is a vocabulary and not a boolean. A scope
   * says *where* as well as *which*, and each member reads a different zone
   * through different machinery: the battlefield through the layer system, a
   * hand or a graveyard through the printed card type, because CR 613 does not
   * reach a card off the battlefield and asking the layer walk about one
   * returns nothing at all.
   */
  it('prints a whole phrase per scope rather than a shared template', () => {
    const board = parseCard(sorceryInput([SWEEP]));
    const hand = parseCard(
      sorceryInput([
        {
          kind: 'exileTarget',
          scope: 'creatureCardsInPlayerHand',
          target: { kind: 'targetOpponent' },
        },
      ]),
    );
    const graveyard = parseCard(
      sorceryInput([
        {
          kind: 'exileTarget',
          scope: 'creatureCardsInPlayerGraveyard',
          target: { kind: 'targetOpponent' },
        },
      ]),
    );
    expect(renderOracleText(board)).toBe('Exile all creatures target opponent controls.');
    expect(renderOracleText(hand)).toBe("Exile all creature cards from target opponent's hand.");
    expect(renderOracleText(graveyard)).toBe("Exile all creature cards from target opponent's graveyard.");
  });

  it('is not generatable, because the only effect that carries it is not', () => {
    const generatable: readonly string[] = MODEL_EFFECT_KINDS;
    expect(generatable).not.toContain('exileTarget');
  });

  /**
   * `anyTarget` draws from both spaces, so it is deliberately not a slot a scope
   * may hang on: half the time it names a creature and the group has no player
   * to read.
   */
  it('asks whether a slot names a player, and answers no for the mixed one', () => {
    const namesAPlayer = TARGET_KINDS.filter(targetKindNamesAPlayer);
    expect([...namesAPlayer].sort()).toEqual(['targetOpponent', 'targetPlayer']);
    expect(targetKindNamesAPlayer('anyTarget')).toBe(false);
  });
});

describe('scope and target as one statement', () => {
  it('validates the scoped sweep and prints it without the word target on a creature', () => {
    const card = parseCard(sorceryInput([SWEEP]));
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('Exile all creatures target opponent controls.');
  });

  it('refuses a scope hung on a creature slot', () => {
    expect(
      codesFor([
        { kind: 'exileTarget', scope: 'creaturesThatPlayerControls', target: { kind: 'targetCreature' } },
      ]),
    ).toContain('ILLEGAL_EFFECT_SCOPE');
  });

  /**
   * The quiet half. This parses, the target kind is on the effect's legal row,
   * and the kernel would look for a permanent, find a player and exile nothing.
   * A card that resolves into no game action is worse than one that fails to
   * load, so it is refused here.
   */
  it('refuses a player slot with no scope, which would exile nothing', () => {
    expect(codesFor([{ kind: 'exileTarget', target: { kind: 'targetOpponent' } }])).toContain(
      'ILLEGAL_EFFECT_SCOPE',
    );
  });

  it('leaves the unscoped single-target exile exactly as it was', () => {
    const card = parseCard(sorceryInput([{ kind: 'exileTarget', target: { kind: 'targetCreature' } }]));
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('Exile target creature.');
  });

  /**
   * Both halves of the row are reachable, which is what makes the scope check
   * load-bearing rather than decorative: the target table alone admits either
   * kind and only the pairing rule tells them apart. The last two kinds belong
   * to the unscoped half — Altar's Light names an artifact or an enchantment,
   * and `targetPermanent` is the filtered space M11's exile spells draw from
   * (`mtg-6y4g`) — and they are here so that a widening of this row has to be
   * stated rather than absorbed.
   */
  it('keeps both target kinds on the row the pairing rule sorts out', () => {
    expect([...legalTargetsFor('exileTarget')]).toEqual([
      'targetCreature',
      'targetOpponent',
      'targetArtifactOrEnchantment',
      'targetPermanent',
    ]);
  });
});
