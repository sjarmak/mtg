/**
 * The pins a brief's required cards can actually be seated at, for the size
 * being run.
 *
 * A required card states a pool, a card kind, a rarity and a mana value, and
 * three of those four are facts about what the card *is*: Moonblade is
 * colorless, it is an artifact, and it costs four. The fourth, rarity, is a fact
 * about the set it is printed in, and the set the brief describes is a different
 * set at every size — the skeleton derives its rare tier per set size, so a
 * 75-card build has no rare tier at all and a 250-card build has nineteen rares.
 * A brief whose rarity pins were hand-written against one size is therefore
 * wrong at every other one, and it is wrong *loudly*: `pinRequiredCards` refuses
 * the whole brief by name before a single model call.
 *
 * That is `mtg-mj5m`. The flagship brief allocated at 75 and threw at 100, 125,
 * 150, 200, 249, 250 and 261. The fix is not another hand-edit — the next size
 * would break the same way — so this file derives the pins instead.
 *
 * # What is derived and what is not
 *
 * The brief states the rarity the designer wants, and this is the only thing
 * that moves it: a stated rarity is a **ceiling**, and a card is seated at the
 * highest tier at or below it that the skeleton at this size can hold. Nothing
 * is ever promoted. A brief that says `rare` gets a rare wherever the set has
 * rares to give and an uncommon in a set that has none, which is the same
 * sentence read at two sizes rather than two sentences to keep in step.
 *
 * The pool and the card kind are never touched, because changing either would
 * make the card a different card. The mana value is touched last and only when
 * no rarity on the ladder seats the card with it, because a cost is a harder
 * design statement than a rarity: it decides what the card can be.
 *
 * # Why this is not a scorer (ZFC)
 *
 * Nothing here reads a card's name, its direction or its power. Which cards are
 * the set's rares is design judgment and it is written down in the brief, one
 * `rarity` field per card, by the person writing the set. This file only asks
 * the allocator whether the skeleton at this size has a seat for what the brief
 * asked for, and takes the next thing down the brief's own ladder when it does
 * not. The oracle it asks is `allocateSlots` itself, so a pin this file returns
 * is placeable by construction rather than by a second model of the allocator
 * that could drift from the first.
 */
import { SLICE_RARITIES } from '@mtg/design-data';
import type { SkeletonLiteProfile, SliceRarity } from '@mtg/design-data';
import { allocateSlots } from './allocate';
import type { RequiredCard, SetBrief } from './brief';
import { UnplaceableRequiredCardsError } from './required';

export interface PinDerivation {
  /** The brief with every required card pinned where this size can seat it. */
  readonly brief: SetBrief;
  /** One note per pin that moved, in the order the cards are named. */
  readonly notes: readonly string[];
}

/**
 * The rarities a stated rarity may be seated at, dearest first.
 *
 * A rarity outside `SLICE_RARITIES` — the schema takes the DSL's wider list, so
 * a brief may say `mythic` — names no tier the skeleton ever builds, so the
 * whole ladder is open to it. Below the stated tier and never above: see the
 * ceiling rule in the file docblock.
 */
function rarityLadder(stated: string): SliceRarity[] {
  const index = SLICE_RARITIES.findIndex((rarity) => rarity === stated);
  const reachable = index === -1 ? [...SLICE_RARITIES] : SLICE_RARITIES.slice(0, index + 1);
  return [...reachable].reverse();
}

/** The card with its rarity pin replaced, or removed when there is none to state. */
function atRarity(card: RequiredCard, rarity: SliceRarity | undefined): RequiredCard {
  if (rarity === undefined) {
    const { rarity: _dropped, ...rest } = card;
    return rest;
  }
  return { ...card, rarity };
}

/** The card with its mana-value pin removed. */
function withoutManaValue(card: RequiredCard): RequiredCard {
  const { manaValue: _dropped, ...rest } = card;
  return rest;
}

/**
 * Every pin this card may be seated at, in the order they are tried.
 *
 * The rarity ladder runs to the bottom before the mana value is given up,
 * because a card that has to move tier to keep its cost is still the card the
 * brief described and a card that keeps its tier and loses its cost may not be.
 */
function ladderFor(card: RequiredCard): RequiredCard[] {
  const rarities: (SliceRarity | undefined)[] =
    card.rarity === undefined ? [undefined] : rarityLadder(card.rarity);
  const byRarity = rarities.map((rarity) => atRarity(card, rarity));
  if (card.manaValue === undefined) return byRarity;
  return [...byRarity, ...byRarity.map(withoutManaValue)];
}

/** What changed between the brief's pin and the one that seats the card. */
function describeMove(before: RequiredCard, after: RequiredCard): string | undefined {
  const parts: string[] = [];
  if (before.rarity !== after.rarity) {
    parts.push(`rarity ${before.rarity ?? 'unstated'} -> ${after.rarity ?? 'unstated'}`);
  }
  if (before.manaValue !== after.manaValue) {
    parts.push(`mana value ${before.manaValue ?? 'unstated'} -> ${after.manaValue ?? 'unstated'}`);
  }
  return parts.length === 0 ? undefined : parts.join(', ');
}

/**
 * Pins the brief's required cards where the skeleton at this size can seat them.
 *
 * Deterministic and model-free, like the rest of the derivation: the same brief
 * at the same size gives the same pins on every run and every machine. A brief
 * every one of whose stated pins the skeleton can hold gets itself back,
 * unchanged and with no notes, which is what the flagship brief at 75 has to be
 * for its recorded run to keep replaying.
 *
 * The loop is repair rather than search. It allocates, and the one thing in the
 * pipeline that refuses a brief names the cards it could not seat; each of those
 * takes one step down its own ladder and the allocation is tried again. Every
 * round consumes at least one step from a finite ladder, so the loop ends either
 * at an allocation that holds or at a card with nothing left to give — which is
 * refused by `pinRequiredCards`, in its own words, exactly as a brief with no
 * derivation at all would be.
 */
export function derivePins(brief: SetBrief, profile?: SkeletonLiteProfile): PinDerivation {
  const ladders = brief.requiredCards.map(ladderFor);
  const steps = ladders.map(() => 0);
  const maxRounds = ladders.reduce((total, ladder) => total + ladder.length, 0);

  for (let round = 0; round <= maxRounds; round += 1) {
    const cards = ladders.map((ladder, index) => ladder[steps[index] ?? 0] ?? ladder[0]);
    const candidate: SetBrief = {
      ...brief,
      requiredCards: cards.filter((card): card is RequiredCard => card !== undefined),
    };
    try {
      if (profile === undefined) allocateSlots(candidate);
      else allocateSlots(candidate, profile);
      return { brief: candidate, notes: notesFor(brief, candidate) };
    } catch (error) {
      if (!(error instanceof UnplaceableRequiredCardsError)) throw error;
      let advanced = false;
      for (const name of error.cardNames) {
        const index = brief.requiredCards.findIndex((card) => card.name === name);
        const ladder = ladders[index];
        const step = steps[index];
        if (ladder === undefined || step === undefined || step + 1 >= ladder.length) continue;
        steps[index] = step + 1;
        advanced = true;
      }
      // Nothing left to relax: the brief is genuinely unplaceable at this size,
      // and the refusal that says so by name is the one the caller should read.
      if (!advanced) throw error;
    }
  }
  throw new Error(`derivePins: no assignment settled for ${brief.setCode} at ${brief.targetSize} cards`);
}

function notesFor(before: SetBrief, after: SetBrief): string[] {
  return before.requiredCards.flatMap((card, index) => {
    const seated = after.requiredCards[index];
    if (seated === undefined) return [];
    const move = describeMove(card, seated);
    if (move === undefined) return [];
    return [
      `required card "${card.name}": ${move}; the ${before.targetSize}-card skeleton has no slot for the pin the brief states.`,
    ];
  });
}
