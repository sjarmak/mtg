/**
 * The two checks that read a brief's claims back off the finished cards.
 *
 * Both are arithmetic. A mechanic names a vocabulary and the set either prints
 * those words or it does not; a token is either spendable or it is decoration.
 * Nothing here asks a model anything, which is the point: the check that stops a
 * paid run from buying a set with a hole in it has to be free to run.
 *
 * The regression that motivated the pair — the flagship generated at 249 cards,
 * every deterministic gate reporting it clean, and it minting Keys that no card
 * in it could ever spend — is proven against the real fixture in a private
 * sibling test beside this one, which reads the flagship set and brief by path
 * and so cannot export. These tests are the generic arithmetic itself, checked
 * against synthetic cards and mechanics built by hand.
 */
import { describe, expect, it } from 'vitest';
import type { Card, TokenSpecInput } from '@mtg/dsl';
import { mana, parseCard } from '@mtg/dsl';
import { checkMechanicsPrinted, checkTokenDemand, unprintedMechanics, unspentTokens } from '@mtg/setgen';
import type { DesiredMechanic, Entry, Slot } from '@mtg/setgen';

function slot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: 'CB01',
    index: 0,
    collectorNumber: 1,
    rarity: 'common',
    color: 'B',
    cardKind: 'creature',
    role: 'creature',
    manaValueMin: 2,
    manaValueMax: 2,
    keywords: [],
    effectKinds: [],
    abilityKinds: [],
    auraModifications: [],
    triggerConditions: [],
    mechanics: [],
    archetypes: [],
    signpost: false,
    ...overrides,
  };
}

function card(input: Record<string, unknown>): Card {
  return parseCard({
    id: 'xmp-test-card',
    name: 'Test Card',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 1 },
    colors: ['B'],
    manaCost: mana({ generic: 1, B: 1 }),
    ...input,
  });
}

/** A creature, unless the caller says otherwise. */
function body(input: Record<string, unknown>): Card {
  return card({ kind: 'creature', power: 2, toughness: 2, ...input });
}

/** A small Monster that drops one token when it dies. */
function minter(token: TokenSpecInput, overrides: Record<string, unknown> = {}): Card {
  return body({
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfDies',
        effects: [{ kind: 'createToken', count: 1, token }],
      },
    ],
    ...overrides,
  });
}

const KEY: TokenSpecInput = { name: 'Key', power: 0, toughness: 1, subtypes: ['Key'] };

/** A Chest: it opens by eating Keys. */
function chest(count = 2): Card {
  return card({
    id: 'xmp-rusted-chest',
    name: 'Rusted Chest',
    kind: 'artifact',
    colors: [],
    manaCost: mana({ generic: 3 }),
    abilities: [
      {
        kind: 'activated',
        cost: { mana: mana({ generic: 1 }), sacrificeOther: { subtype: 'Key', count } },
        effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      },
    ],
  });
}

function mechanic(overrides: Partial<DesiredMechanic> = {}): DesiredMechanic {
  return {
    name: 'Fuse',
    description: 'A Monster dies and leaves a part; the part fuses onto a creature.',
    keywords: [],
    effectKinds: [],
    abilityKinds: [],
    triggerConditions: [],
    colors: [],
    ...overrides,
  };
}

describe('a mechanic the brief names and the set never prints', () => {
  it('fails a set that prints no word of a stated mechanic', () => {
    const fuse = mechanic({ effectKinds: ['putCounters'], abilityKinds: ['activated'] });
    const entries: Entry[] = [{ slot: slot({ mechanics: ['Fuse'] }), card: minter(KEY) }];

    expect(unprintedMechanics([entries[0]?.card as Card], [fuse])).toStrictEqual([
      { mechanic: fuse, unprinted: ['putCounters', 'activated'], printed: [] },
    ]);

    const findings = checkMechanicsPrinted(entries, [fuse]);
    expect(findings.map((item) => item.code)).toStrictEqual(['MECHANIC_UNPRINTED']);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('putCounters');
    // The slots the allocator told to carry it are the slots a retry can fix.
    expect(findings[0]?.slotIds).toStrictEqual(['CB01']);
  });

  /**
   * The other side of the line, and Tideglass Reach is the set that draws it:
   * its Undertow states `millCards, drawCards` and the finished ninety cards
   * draw without ever milling. The mechanic is in the set; it is narrower than
   * the brief wrote it, and no retry round can widen a word the allocator
   * already asked for and the model already declined.
   */
  it('warns, rather than fails, when the set prints part of the vocabulary', () => {
    const fuse = mechanic({ effectKinds: ['createToken', 'putCounters'], abilityKinds: ['triggered'] });
    const entries: Entry[] = [{ slot: slot({ mechanics: ['Fuse'] }), card: minter(KEY) }];

    expect(unprintedMechanics([entries[0]?.card as Card], [fuse])).toStrictEqual([
      { mechanic: fuse, unprinted: ['putCounters'], printed: ['createToken', 'triggered'] },
    ]);

    const findings = checkMechanicsPrinted(entries, [fuse]);
    expect(findings.map((item) => item.code)).toStrictEqual(['MECHANIC_PARTLY_PRINTED']);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('putCounters');
    expect(findings[0]?.slotIds).toStrictEqual(['CB01']);
  });

  it('says nothing when every word the mechanic names is printed', () => {
    const skywake = mechanic({ name: 'Skywake', keywords: ['flying'], effectKinds: ['createToken'] });
    const flier = minter(KEY, { keywords: ['flying'] });
    expect(unprintedMechanics([flier], [skywake])).toStrictEqual([]);
    expect(checkMechanicsPrinted([{ slot: slot(), card: flier }], [skywake])).toStrictEqual([]);
  });

  /**
   * Fuse lives on the part, not on the card that drops it: `FuseAbilitySchema`
   * is a *token* ability. A check that walked cards only would report the one
   * shape the DSL pins for this mechanic as never printed, which is the strict
   * direction failing a set that did exactly what it was asked.
   */
  it('counts an effect a created token prints as printed by the set', () => {
    const fuse = mechanic({ effectKinds: ['putCounters'] });
    const direhorn = minter({
      name: 'Trophy Horn',
      subtypes: ['Part'],
      abilities: [
        {
          kind: 'activated',
          cost: { mana: mana({ generic: 1 }), sacrificeSelf: true },
          effects: [
            {
              kind: 'putCounters',
              counter: 'horn',
              count: 1,
              target: { kind: 'targetCreatureYouControl' },
            },
          ],
        },
      ],
    });
    expect(unprintedMechanics([direhorn], [fuse])).toStrictEqual([]);
  });

  it('blames nothing when no slot was allocated to the mechanic', () => {
    const fuse = mechanic({ keywords: ['lifelink'] });
    const findings = checkMechanicsPrinted([{ slot: slot(), card: minter(KEY) }], [fuse]);
    expect(findings[0]?.code).toBe('MECHANIC_UNPRINTED');
    expect(findings[0]?.slotIds).toStrictEqual([]);
  });
});

describe('a token the set mints and nothing spends', () => {
  it('fails a set whose Keys no cost in it can name', () => {
    const entries: Entry[] = [
      { slot: slot({ id: 'CB01' }), card: minter(KEY) },
      { slot: slot({ id: 'CB02' }), card: minter(KEY, { id: 'xmp-second-minter', name: 'Second Minter' }) },
    ];
    const unspent = unspentTokens(entries.map((entry) => entry.card));
    expect(unspent).toHaveLength(1);
    expect(unspent[0]?.token.name).toBe('Key');
    expect(unspent[0]?.mintedBy).toStrictEqual(['xmp-test-card', 'xmp-second-minter']);

    const findings = checkTokenDemand(entries);
    expect(findings.map((item) => item.code)).toStrictEqual(['TOKEN_MINTED_UNSPENT']);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('Key');
    expect(findings[0]?.slotIds).toStrictEqual(['CB01', 'CB02']);
  });

  it('says nothing once a Chest opens on them', () => {
    const entries: Entry[] = [
      { slot: slot({ id: 'CB01' }), card: minter(KEY) },
      { slot: slot({ id: 'CA01', color: null, cardKind: 'artifact' }), card: chest() },
    ];
    expect(unspentTokens(entries.map((entry) => entry.card))).toStrictEqual([]);
    expect(checkTokenDemand(entries)).toStrictEqual([]);
  });

  /**
   * The line the check draws, and the reason it is drawn on the body rather
   * than on the name: a token that can deal damage is doing something on the
   * board whether or not anything ever eats it.
   */
  it('says nothing about a token that can fight', () => {
    const brigand = minter({ name: 'Brigand', power: 1, toughness: 1, subtypes: ['Goblin'] });
    expect(unspentTokens([brigand])).toStrictEqual([]);
  });

  it('says nothing about a bodiless token that spends itself', () => {
    const part = minter({
      name: 'Trophy Horn',
      subtypes: ['Part'],
      abilities: [
        {
          kind: 'activated',
          cost: { mana: mana({ generic: 1 }), sacrificeSelf: true },
          effects: [
            {
              kind: 'putCounters',
              counter: 'horn',
              count: 1,
              target: { kind: 'targetCreatureYouControl' },
            },
          ],
        },
      ],
    });
    expect(unspentTokens([part])).toStrictEqual([]);
  });

  it('says nothing about a token a static ability makes bigger', () => {
    const lord = body({
      id: 'xmp-keyward',
      name: 'Keyward',
      abilities: [
        {
          kind: 'static',
          scope: 'otherCreaturesYouControl',
          subtype: 'Key',
          modification: { kind: 'statBonus', power: 2, toughness: 2 },
        },
      ],
    });
    expect(unspentTokens([minter(KEY), lord])).toStrictEqual([]);
  });

  it('names a token that carries no subtype, because nothing could ever name it', () => {
    const nameless = minter({ name: 'Scrap', power: 0, toughness: 1 });
    const unspent = unspentTokens([nameless]);
    expect(unspent).toHaveLength(1);
    const findings = checkTokenDemand([{ slot: slot(), card: nameless }]);
    expect(findings[0]?.message).toContain('carries no subtype');
  });

  /**
   * The blame half, and it mirrors `checkSacrificeSupply`: regenerating the
   * card that mints a Key cannot produce the Chest that spends one, so when the
   * brief named the consumer the finding goes to the slot reserved for it.
   */
  it('blames the slot reserved for the consumer the brief named', () => {
    const entries: Entry[] = [
      { slot: slot({ id: 'CB01' }), card: minter(KEY) },
      {
        slot: slot({
          id: 'CA01',
          color: null,
          cardKind: 'artifact',
          requiredCard: {
            name: 'Rusted Chest',
            cardKind: 'artifact',
            sacrificeSubtype: 'Key',
            equipment: false,
            legendary: false,
          },
        }),
        // The slot was reserved for a Chest and printed something else.
        card: body({ id: 'xmp-not-a-chest', name: 'Not A Chest' }),
      },
    ];
    const findings = checkTokenDemand(entries);
    expect(findings[0]?.code).toBe('TOKEN_MINTED_UNSPENT');
    expect(findings[0]?.slotIds).toStrictEqual(['CA01']);
  });
});
