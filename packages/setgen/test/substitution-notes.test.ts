import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_EFFECT_KINDS, parseCard, triggerChoosesTargets, validateCard } from '@mtg/dsl';
import type { AnyEffectKind, CardInput } from '@mtg/dsl';
import { allowedEffectKinds, ROLE_PROFILES } from '@mtg/setgen';

/**
 * The guard on `roles.ts`'s substitution notes.
 *
 * A substitution note says "the DSL cannot do X, so this slot prints Y
 * instead". That sentence is a claim about the vocabulary, and the vocabulary
 * grows. Between `mtg-q5yg` and `mtg-fv5s` the engine gained an exile zone,
 * Auras, planeswalkers and `scry`, and three notes went on asserting those
 * absences for months while the generator went on substituting away from
 * effects it could by then print. Nothing failed, because nothing was watching.
 *
 * This file watches, along two axes that fail in different ways.
 *
 * **A new primitive is a compile error.** `CLOSES_NOTE` is a total
 * `Record<AnyEffectKind, ...>`, so a kind added to `ALL_EFFECT_KINDS` does not
 * typecheck until somebody has said which substitution note it makes false —
 * which is the moment to say it, rather than six months later. This is
 * `packages/dsl/test/exhaustiveness.test.ts`'s device pointed at a different
 * question.
 *
 * **A correction that has become free is a test failure.** The reason the stale
 * notes survived being noticed is real and is not laziness: `slotSection`
 * prints `substitution` verbatim into the fill prompt and `fixtureKey()`
 * sha256-hashes the prompt, so editing one of these strings orphans every
 * recorded fixture whose batch held that role and a paid live run is the only
 * way to get them back. So the rule this file enforces is not "no note may be
 * false"; it is "a false note is tolerated exactly while a recorded prompt
 * holds it". The moment a re-record drops that prompt, or a new role stops
 * being seated at the sizes the corpora were recorded at, the correction costs
 * nothing and this fails until it is made.
 *
 * That second half reads the recorded corpora rather than a list, so it is a
 * function of committed state and answers on its own after somebody re-records.
 */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_ROOT = join(PACKAGE_ROOT, 'fixtures');

/**
 * Which substitution note each engine effect primitive makes false.
 *
 * Total over `AnyEffectKind` on purpose. Most rows are empty and that is the
 * useful state: an empty row is a primitive somebody looked at and classified,
 * not one nobody has read yet, because an unclassified one does not compile.
 *
 * The two judgment calls worth writing down:
 *
 * `exileTarget` closes `removalExile` and does not close `cardDrawImpulsive`.
 * It exiles a permanent on the battlefield; impulsive draw exiles the top card
 * of a library and lets you play it this turn, which needs a zone this
 * primitive never touches and a permission the DSL has no field for.
 *
 * `scry` closes nothing now, and it used to close `libraryTopBottom`.
 * `mtg-vl7k` deleted that note and made the slot print `scry`, which is what
 * paying a row off looks like: the row empties. The history is in `roles.ts`'s
 * header, which is where a reader asking "why is this empty" should end up.
 */
const CLOSES_NOTE: Readonly<Record<AnyEffectKind, readonly string[]>> = {
  dealDamage: [],
  destroyPermanent: [],
  pumpUntilEndOfTurn: [],
  drawCards: [],
  gainLife: [],
  counterSpell: [],
  createToken: [],
  tapPermanent: [],
  returnToHand: [],
  millCards: [],
  putCounters: [],
  exileTarget: ['removalExile'],
  scry: [],
  returnFromGraveyard: [],
  revealHand: [],
  // Closes nothing, and the two roles it looks like it should close stay in
  // `NOT_AN_EFFECT_PRIMITIVE` with corrected text. A fight reads the power of
  // the body it is printed on, so it is legal only on a creature's own
  // `selfEnters` trigger; `fight` and `bite` are both instant slots, and a
  // spell has no body. The primitive existing does not make an instant fight
  // sayable, which is the distinction this table is for.
  fight: [],
  // Closes nothing, for `fight`'s reason in a different shape. The
  // `manaAcceleration` note used to say the DSL has no way to produce mana at
  // all, and that sentence is now false — `addMana` is the primitive and
  // `mana-ability.ts` is what makes a permanent tap for it. What is still true
  // is that no role can emit it: `addMana` is an unpriced kind, so it is not in
  // `EffectKind`, so `RoleProfile.effectKinds` cannot name it. The corrected
  // sentence is in `NOT_AN_EFFECT_PRIMITIVE` below, which is where a note whose
  // gap is not "the primitive is missing" belongs.
  addMana: [],
  // The library and graveyard block, and every row is empty on purpose. Two are
  // worth stating: `putOnLibrary` looks like it should close `libraryTopBottom`
  // and cannot, because `mtg-vl7k` already deleted that note when the slot
  // started printing `scry` — there is no note left to pay off. And
  // `searchLibrary` finding a basic land does not close `manaAcceleration`
  // either, and the reason moved out from under it while both lanes were open:
  // that note is now about reach rather than about a missing primitive.
  // `addMana` exists and is hand-authored only, so no role can name it, and
  // fetching a land onto the battlefield ramps without changing which kinds a
  // role may emit.
  shuffleLibrary: [],
  revealTopCards: [],
  putOnLibrary: [],
  exileGraveyard: [],
  shuffleGraveyardIntoLibrary: [],
  searchLibrary: [],
  // The hand block, empty for `addMana`'s reason exactly. The `discard` note
  // used to say the DSL has no discard primitive at all, and that sentence is
  // now false: `discardCards` and `chooseDiscard` are primitives the kernel
  // runs. What is still true is that no role can emit either, because both are
  // unpriced and `RoleProfile.effectKinds` is typed over `EffectKind`. So this
  // pays off no note; the corrected sentence is in `NOT_AN_EFFECT_PRIMITIVE`
  // below, where a gap that is not a missing primitive belongs.
  discardCards: [],
  chooseDiscard: [],
  // The life block, empty for the reason `addMana`'s row is empty: all three
  // are hand-authored only (absent from `EFFECT_KINDS`), so no role slot can
  // name one and no `substitution:` note can be paid off by one existing.
  loseLife: [],
  setLife: [],
  preventCombatDamage: [],
  // Empty for the same reason `searchLibrary`'s row above is empty, and it is
  // worth saying because this one looks closer than it is. Nothing in the note
  // corpus asks for recursion by name, and even if it did, this kind is
  // unpriced and hand-authored only, so no `RoleProfile.effectKinds` can name
  // it. A note is paid off by a slot printing the thing, not by the kernel
  // being able to run it.
  chooseFromGraveyard: [],
  // Dawn Charm's first mode, `preventCombatDamage`'s row above with the same
  // three words: hand-authored only, so no role slot can name it and no
  // `substitution:` note can be paid off by one existing. It lands here
  // rather than beside its sibling because `ALL_EFFECT_KINDS` is appended to,
  // never inserted into, and this kind joined at the very end of the tuple.
  preventAllDamageToTarget: [],
  untapPermanent: [],
  grantKeywordUntilEndOfTurn: [],
  // Both close nothing. The notes in this file name gaps in what a *generated*
  // set can print, and neither of these is generatable: they are hand-authored
  // primitives added for `mtg-nhyv.29`'s M11/M13 reference cards, off
  // `EFFECT_KINDS` and therefore off every role's `effectKinds`, so no
  // substitution note was ever written against the absence of one.
  cantBeBlockedThisTurn: [],
  attacksYouThisTurnIfAble: [],
  sacrificeSelf: [],
  // Closes nothing for the same reason: the edict (CR 701.17a) is off
  // `EFFECT_KINDS` and therefore off every role's `effectKinds`
  // (`mtg-4g77`'s containment cut), so no substitution note was ever written
  // against its absence and none closes now that it exists.
  sacrificePermanent: [],
  // Closes nothing, third verse: a base P/T set is off `EFFECT_KINDS`
  // (`mtg-nhyv.72` shipped it hand-authored-only), so no role's `effectKinds`
  // names it and no substitution note was written against its absence.
  setBasePtUntilEndOfTurn: [],
};

/**
 * The notes whose gap is not an effect primitive at all, and what each is
 * actually missing.
 *
 * Every line here was checked against the vocabulary rather than inherited, and
 * four of them are the audit's uncomfortable half: the note is wrong about
 * *what* is missing, but a recorded prompt holds the wrong sentence, so the
 * accurate one lives here and in `roles.ts`'s header instead of on the card
 * slot. `removalExpensive` was the fifth until `mtg-lr0z` re-keyed the ten
 * recordings that held its sentence, so its note now says what this row says
 * and the row is a restatement rather than the only copy.
 * `is tolerated only while a recorded prompt holds it` below does not
 * police this table, because "is this English sentence accurate" is not a thing
 * a test can decide. What it polices is the other table, which is the one a
 * vocabulary change moves.
 */
const NOT_AN_EFFECT_PRIMITIVE: Readonly<Record<string, string>> = {
  removalCombatConditional:
    'TargetFilter.combat exists (mtg-6y4g) and is hand-authored only; ModelTargetSpec is { kind } and carries no filter',
  removalArtifactEnchantment:
    'targetArtifactOrEnchantment exists and is hand-authored only; MODEL_TARGET_KINDS is the frozen four',
  protectiveInstant: 'KEYWORDS carries neither protection nor hexproof',
  auraOverwrite: 'the Aura shape exists (mtg-fv5s); this role is not one of the five roles that reach it',
  modalSpell: 'Card.modes exists and the kernel resolves it; no fill answer schema offers the field',
  removalSmallConditional: 'TargetRestriction.maxPower exists; ModelTargetSpec is { kind } and carries none',
  cardDrawAtCost:
    'no life payment anywhere: not ActivationCost, not UnlessClause, and LIMITS.life starts at 1',
  discard:
    'the discardCards and chooseDiscard primitives exist and are hand-authored only: both are unpriced, so EffectKind does not carry them and RoleProfile.effectKinds cannot name either',
  cardDrawImpulsive:
    'no exile-from-library primitive and no field granting permission to play an exiled card',
  artifactDestructionModal: 'removalArtifactEnchantment’s gap, reached from red',
  fight:
    'the fight primitive exists and is hand-authored only: it is legal on a creature’s selfEnters trigger and this role is an instant',
  bite: 'fight’s gap on an instant, plus no primitive deals a creature’s power in one direction only',
  manaAcceleration:
    'the addMana primitive exists and is hand-authored only: it is unpriced, so EffectKind does not carry it and RoleProfile.effectKinds cannot name it',
  removalExpensive:
    'RoleProfile.cardKind has no artifact arm, and a permanent cannot carry a spell effect list at all (EFFECT_ILLEGAL_ON_CARD_TYPE)',
};

/** Role names carrying a substitution note, in table order. */
function notedRoles(): readonly string[] {
  return Object.keys(ROLE_PROFILES).filter((role) => ROLE_PROFILES[role]?.substitution !== undefined);
}

/** Every recorded request/response file, whichever run wrote it. */
function recordedFixtures(): readonly string[] {
  return readdirSync(FIXTURES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('llm'))
    .flatMap((entry) => {
      const dir = join(FIXTURES_ROOT, entry.name);
      return readdirSync(dir)
        .filter((file) => file.endsWith('.json'))
        .map((file) => readFileSync(join(dir, file), 'utf8'));
    });
}

describe('the substitution notes in ROLE_PROFILES', () => {
  it('classifies every note, and classifies none twice', () => {
    const byPrimitive = Object.values(CLOSES_NOTE).flat();
    const byOtherGap = Object.keys(NOT_AN_EFFECT_PRIMITIVE);

    // Every classified name is a role that still carries a note. A role that
    // was corrected has to leave both tables, or the tables become a record of
    // what used to be true, which is the failure this file exists to stop.
    for (const role of [...byPrimitive, ...byOtherGap]) {
      expect(notedRoles(), `${role} is classified here but carries no substitution note`).toContain(role);
    }
    // And every note is classified. A role added with a note nobody read is a
    // note nobody will read again.
    for (const role of notedRoles()) {
      expect(
        [...byPrimitive, ...byOtherGap],
        `${role} carries a substitution note that neither CLOSES_NOTE nor NOT_AN_EFFECT_PRIMITIVE accounts for`,
      ).toContain(role);
    }
    expect(byPrimitive.filter((role) => byOtherGap.includes(role))).toStrictEqual([]);
    expect(new Set(byPrimitive).size).toBe(byPrimitive.length);
  });

  it('holds a note the DSL can now print only while a recorded prompt holds it', () => {
    const corpus = recordedFixtures();
    expect(corpus.length, `no recorded fixtures under ${FIXTURES_ROOT}`).toBeGreaterThan(0);

    for (const [kind, roles] of Object.entries(CLOSES_NOTE)) {
      for (const role of roles) {
        const note = ROLE_PROFILES[role]?.substitution;
        if (note === undefined) continue; // reported by the classification test above.
        const pinned = corpus.filter((blob) => blob.includes(note)).length;
        expect(
          pinned,
          `ROLE_PROFILES.${role} still says the DSL cannot ${kind}, and no recorded prompt holds that ` +
            `sentence any more. Correcting it is free: delete the note and make the role emit ${kind}. ` +
            'See the audit in the header of packages/setgen/src/roles.ts.',
        ).toBeGreaterThan(0);
      }
    }
  });

  it('leaves the DSL nothing it can print that no role and no note accounts for', () => {
    // The reverse read of CLOSES_NOTE, and the one that catches a *silent*
    // promotion: a primitive that closes no note and that no role emits is a
    // primitive the generator cannot reach from any slot. That is a legitimate
    // state — `revealHand` is deliberately in it — so this asserts the list
    // rather than that the list is empty.
    //
    // `fight` is in it for the strongest of the three reasons. `putCounters` is
    // expressible by hand and merely unreached; `revealHand` is unreached and
    // nobody has argued for it; `fight` must stay unreached, because it is only
    // legal on a creature's `selfEnters` trigger and no role's shape can promise
    // that. It is not in `EffectKind` at all, so `RoleProfile.effectKinds` could
    // not name it even if a role wanted to.
    //
    // The library and graveyard block joins the list for `fight`'s structural
    // half without `fight`'s rules half: all six are unpriced, so no role can
    // name them, and the reason each is unpriced is written on the tuple in
    // `vocabulary.ts` rather than restated here. They are hand-authored
    // vocabulary the engine runs and the generator does not reach, which is the
    // state this assertion exists to make visible rather than to forbid. The
    // sixth, `chooseFromGraveyard`, reads at the far end of the list rather
    // than beside its five siblings because the expected array is in
    // `ALL_EFFECT_KINDS` order and that tuple is appended to, never inserted
    // into: it landed after the life block, so it prints after the life block.
    //
    // The life block (`loseLife`, `setLife`, `preventCombatDamage`) joins it for
    // the same structural reason and one of its own: all three are unpriced, and
    // two of them are also unmodeled on purpose. `setLife` and
    // `preventCombatDamage` are hand-authored answers to M11/M13 positions, and a
    // role that could name either would let the generator print a Fog or a
    // Worldfire it has no way to price.
    //
    // `preventAllDamageToTarget` joins at the very end, after `chooseFromGraveyard`
    // rather than beside its `preventCombatDamage` sibling, for the same ordering
    // reason: it is the newest member of `ALL_EFFECT_KINDS`, appended rather than
    // inserted. It is unpriced for `preventCombatDamage`'s reason sharpened — a
    // targeted, uncapped prevention answers one specific removal spell or combat
    // step, a fact about the game the model is never shown.
    //
    // `untapPermanent` follows it at the tail, appended by `mtg-2qyk`, and it is
    // unpriced for a reason no research would settle: an untap is worth whatever
    // the board makes it worth. The same sentence is a ritual on a mana source,
    // a Fog on a blocker, and nothing at all on a permanent that was not tapped,
    // and no role would know which it was printing.
    //
    // `grantKeywordUntilEndOfTurn` is last, and its reason is the pump's
    // inverted. Two points of power is a magnitude a pie row can carry; a
    // keyword is not one. Trample is worth nothing on a 1/1 and the game on a
    // 7/7, deathtouch is a removal spell on a creature that must be blocked and
    // nothing on one that will not be, and a role would have to pick one of
    // those readings without seeing the body it was printing on.
    const emitted = new Set<AnyEffectKind>(
      Object.values(ROLE_PROFILES).flatMap((profile) => profile.effectKinds),
    );
    const unreachable = ALL_EFFECT_KINDS.filter(
      (kind) => !emitted.has(kind) && CLOSES_NOTE[kind].length === 0,
    );
    expect(unreachable).toStrictEqual([
      'putCounters',
      'revealHand',
      'fight',
      'addMana',
      'shuffleLibrary',
      'revealTopCards',
      'putOnLibrary',
      'exileGraveyard',
      'shuffleGraveyardIntoLibrary',
      'searchLibrary',
      'discardCards',
      'chooseDiscard',
      'loseLife',
      'setLife',
      'preventCombatDamage',
      'chooseFromGraveyard',
      'preventAllDamageToTarget',
      'untapPermanent',
      'grantKeywordUntilEndOfTurn',
      // The two `mtg-nhyv.29` added, and they are unpriced for a reason that
      // needs no research at all: neither is a magnitude. "Can't be blocked" is
      // worth the combat it wins and a lure is worth the blocker it moves, and
      // a role picking either would be printing a fact about a board it has not
      // seen — `untapPermanent`'s reason two entries up, said about combat
      // instead of about mana.
      'cantBeBlockedThisTurn',
      'attacksYouThisTurnIfAble',
      // `mtg-nhyv.30`'s, and it is unreachable for a stronger reason than any
      // above: the others are prices no research would settle, and this one is
      // a sentence the generator must never be offered at all. "Sacrifice this
      // creature" is a drawback, so a role that could name it could print a
      // card whose whole text is killing itself.
      'sacrificeSelf',
      // `mtg-4g77`'s edict, unreachable for the same containment reason as
      // `sacrificeSelf` just above: it is off `generatableEffects` entirely
      // (`EFFECT_RULES`'s own entry says so), so no role's `effectKinds` will
      // ever name it and no substitution note was ever written against its
      // absence.
      'sacrificePermanent',
      // `mtg-nhyv.72`'s layer-7b set, unreachable for the identical containment
      // reason: it is hand-authored only, so no role's `effectKinds` names it.
      'setBasePtUntilEndOfTurn',
    ]);
  });
});

describe('libraryTopBottom, the note mtg-vl7k paid off', () => {
  it('emits scry rather than the mill it used to substitute', () => {
    const profile = ROLE_PROFILES['libraryTopBottom'];
    expect(profile?.substitution).toBeUndefined();
    expect(profile?.effectKinds).toStrictEqual(['scry', 'drawCards']);
    // Blue is the only color the published skeleton seats this role in, and the
    // pie has to agree or `allowedEffectKinds` throws on the way to the prompt.
    expect(allowedEffectKinds('libraryTopBottom', 'U')).toContain('scry');
  });

  it('prints a card the DSL accepts', () => {
    // One card per primitive the role offers, because "the role emits scry" is
    // a claim about the prompt and "the DSL runs it" is a claim about the
    // engine, and the substitution notes went stale by nobody checking the
    // second against the first.
    const effects: Readonly<Record<string, CardInput['effects']>> = {
      scry: [{ kind: 'scry', count: 2 }],
      drawCards: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    };

    for (const kind of allowedEffectKinds('libraryTopBottom', 'U')) {
      const effect = effects[kind];
      expect(effect, `libraryTopBottom emits ${kind}, which this test has no card for`).toBeDefined();
      const card = parseCard({
        kind: 'instant',
        id: `tst-library-top-bottom-${kind.toLowerCase()}`,
        name: `Test ${kind}`,
        rarity: 'common',
        set: { code: 'TST', collectorNumber: 1 },
        manaCost: { U: 1 },
        colors: ['U'],
        effects: effect,
      });
      expect(validateCard(card), `${kind} does not validate on this role's card`).toStrictEqual([]);
    }
  });
});

/**
 * The note `mtg-lr0z` corrected, and the two halves it now claims.
 *
 * This one is not a note that became free. Ten recorded prompts held the old
 * sentence and `tools/rekey-fixtures.ts` moved all ten, which is what buying a
 * correction looks like when the alternative is regenerating a committed set.
 * So the guard has to be different from `libraryTopBottom`'s above: nothing was
 * paid off, the slot prints exactly what it printed before, and what changed is
 * that the sentence is true. Both halves are read off the engine here, because
 * "the sentence is true" is the only thing this change bought and the only
 * thing that can go stale again.
 */
describe('removalExpensive, the note mtg-lr0z re-keyed', () => {
  it('prints the arrival trigger the old note said was unsayable', () => {
    // The old sentence: "a triggered ability cannot choose its targets in DSL
    // v1". `triggerChoosesTargets` landed in 10c72ed and the kernel asks it
    // three times over, so this card is the counterexample the note denied.
    const card = parseCard({
      kind: 'artifact',
      id: 'tst-removal-expensive-arrival',
      name: 'Test Arrival Answer',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: { generic: 5 },
      colors: [],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
        },
      ],
    });
    expect(validateCard(card)).toStrictEqual([]);
    const ability = card.abilities?.[0];
    expect(ability?.kind).toBe('triggered');
    if (ability?.kind !== 'triggered') return;
    expect(triggerChoosesTargets(ability)).toBe(true);
  });

  it('has no role that could declare that card, which is what the corrected note says', () => {
    // Half one of the corrected sentence. `RoleProfile.cardKind` is a union of
    // four kinds and none of them is `'artifact'`, so this is a compile-time
    // fact read at run time: the day somebody adds the arm, this fails and the
    // note is due another look rather than another six months.
    expect(Object.values(ROLE_PROFILES).map((profile) => profile.cardKind)).not.toContain('artifact');
    expect(ROLE_PROFILES['removalExpensive']?.cardKind).toBe('sorcery');
  });

  it('refuses the role vocabulary on a permanent, which is half two', () => {
    // `effectKinds` is what this role states, and it is a spell's field: an
    // artifact carrying the same list is refused by name. So even an artifact
    // arm on the profile would not print this role's card as written; the
    // effects would have to move inside an ability.
    const effectKinds = ROLE_PROFILES['removalExpensive']?.effectKinds ?? [];
    expect(effectKinds).toStrictEqual(['destroyPermanent']);
    expect(() =>
      parseCard({
        kind: 'artifact',
        id: 'tst-removal-expensive-effect-list',
        name: 'Test Effect List',
        rarity: 'common',
        set: { code: 'TST', collectorNumber: 2 },
        manaCost: { generic: 5 },
        colors: [],
        effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
      }),
    ).toThrow(/EFFECT_ILLEGAL_ON_CARD_TYPE/);
  });
});
