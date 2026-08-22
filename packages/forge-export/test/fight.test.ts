/**
 * A fight as Forge writes it, and the `may` that has to travel with it.
 *
 * Forge's `Fight` API takes two combatants and only one of them is the target,
 * so the row carries a `Defined$` naming the other. `TriggeredCardLKICopy` is
 * the corpus's spelling for "the permanent that triggered this, last known
 * information included", and Affectionate Indrik — a 5G 4/4 whose enters
 * trigger is verbatim the sentence this vocabulary prints — is the card the
 * mapping is read off. Both halves are asserted against that card rather than
 * against a guess.
 *
 * The optional form is asserted for a reason that outlived this lane: until
 * `OptionalDecider$ You` went on the `T:` line, an optional trigger exported
 * with "you may" in its description and no way for the player to decline, so
 * the parity oracle would have fought on our behalf and then disagreed with us
 * about a card we exported wrong. No set in the repo prints an optional trigger
 * yet, which is why nothing caught it; the second case below is the general
 * claim rather than a fight-shaped one.
 *
 * Everything here is read off `res/cardsfolder` rather than off a booted Forge,
 * which is the standing limit on the whole package (`mtg-17a`).
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { FORGE_EFFECTS } from '../src/effect-script';
import { FORGE_VALID_TARGETS } from '../src/vocabulary-map';
import { mustTranspile, slugId } from './helpers';

/** A green creature whose enters trigger fights, optionally or not. */
function brambler(name: string, optional: boolean): Card {
  return parseCard({
    kind: 'creature',
    id: slugId(name),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    colors: ['G'],
    power: 3,
    toughness: 3,
    manaCost: { generic: 2, W: 0, U: 0, B: 0, R: 0, G: 1 },
    keywords: [],
    effects: [],
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfEnters',
        ...(optional ? { optional: true } : {}),
        effects: [{ kind: 'fight', target: { kind: 'targetCreatureYouDontControl' } }],
      },
    ],
  } as CardInput);
}

/** The one line of a script that starts with the given prefix. */
function lineStartingWith(card: Card, prefix: string): string {
  const line = mustTranspile(card)
    .split('\n')
    .find((text) => text.startsWith(prefix));
  if (line === undefined) throw new Error(`no ${prefix} line`);
  return line;
}

describe('the fight row', () => {
  it('names both combatants, because only one of them is the target', () => {
    expect(lineStartingWith(brambler('Grasping Bramble', false), 'SVar:')).toBe(
      'SVar:Trig1Effect1:DB$ Fight | Defined$ TriggeredCardLKICopy | ValidTgts$ Creature.YouDontCtrl',
    );
  });

  it('spells the target the way the 158 shipped cards spell it', () => {
    expect(FORGE_VALID_TARGETS.targetCreatureYouDontControl).toBe('Creature.YouDontCtrl');
  });

  it('is confined to the one target kind the DSL admits it under', () => {
    expect(FORGE_EFFECTS.fight.api).toBe('Fight');
    expect(FORGE_EFFECTS.fight.targets).toEqual(['targetCreatureYouDontControl']);
    // A fight makes no token and asks nothing of the deck, so the two fields
    // that would otherwise add a `[Tokens]` entry or a `DeckHas$` hint stay
    // empty rather than carrying a value nothing reads.
    expect(FORGE_EFFECTS.fight.deckHas).toBeNull();
  });

  it('prints the mandatory sentence as its own trigger description', () => {
    expect(lineStartingWith(brambler('Grasping Bramble', false), 'T:')).toBe(
      'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self |' +
        ' Execute$ Trig1Effect1 | TriggerDescription$ When CARDNAME enters the battlefield,' +
        " it fights target creature you don't control.",
    );
  });
});

describe('an optional trigger', () => {
  it('carries the decider that lets the player decline', () => {
    expect(lineStartingWith(brambler('Wary Bramble', true), 'T:')).toBe(
      'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self |' +
        ' Execute$ Trig1Effect1 | OptionalDecider$ You | TriggerDescription$ When CARDNAME enters' +
        " the battlefield, you may have it fight target creature you don't control.",
    );
  });

  it('carries it whatever the effect is, and a mandatory one carries nothing', () => {
    const drawer = (optional: boolean): Card =>
      parseCard({
        kind: 'creature',
        id: slugId(optional ? 'Hopeful Scout' : 'Dutiful Scout'),
        name: optional ? 'Hopeful Scout' : 'Dutiful Scout',
        rarity: 'common',
        set: { code: 'TST', collectorNumber: 2 },
        colors: ['W'],
        power: 2,
        toughness: 2,
        manaCost: { generic: 1, W: 1, U: 0, B: 0, R: 0, G: 0 },
        keywords: [],
        effects: [],
        abilities: [
          {
            kind: 'triggered',
            condition: 'selfEnters',
            ...(optional ? { optional: true } : {}),
            effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
          },
        ],
      } as CardInput);

    expect(lineStartingWith(drawer(true), 'T:')).toContain('OptionalDecider$ You');
    expect(lineStartingWith(drawer(false), 'T:')).not.toContain('OptionalDecider');
  });
});
