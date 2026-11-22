/**
 * `mtg-43j03`: the live journey's Commander cast step passed a legal Sol Ring
 * cast every turn from turn 3 onward and never took it, then discarded Sol
 * Ring to hand size and lost with three lands stuck in hand. The chooser this
 * covers is what `live-journey.ts`'s `oneDecision` in-page script embeds by
 * regex source, so a change here is a change there too.
 */
import { describe, expect, it } from 'vitest';
import {
  chooseManaSourceName,
  isManaSourceDetail,
  MANA_ABILITY_LINE_SOURCE,
  parseCardDetail,
} from '../../tools/live-journey-mana-source';

const solRing = 'Sol Ring\nArtifact\n{T}: Add {C}{C}.';
const arcaneSignet =
  "Arcane Signet\nArtifact\n{T}: Add one mana of any color in your commander's color identity.";
const talisman =
  'Talisman of Indulgence\nArtifact\n{T}: Add {C}.\n{T}: Add {B} or {R}. Talisman of Indulgence deals 1 damage to you.';
const swamp = 'Swamp\nBasic Land — Swamp\n{T}: Add {B}.';
const guttersnipe =
  'Guttersnipe\nCreature — Goblin Shaman\nWhenever you cast an instant or sorcery spell, Guttersnipe deals 2 damage to each opponent.';
const lightningBolt = 'Lightning Bolt\nInstant\nLightning Bolt deals 3 damage to any target.';
const commander =
  "Kardur, Doomscourge\nLegendary Creature — Human Warlock\nWhenever a creature an opponent controls attacks you or a planeswalker you control, that creature's controller may have that creature deal damage to another target creature they control instead.";

describe('MANA_ABILITY_LINE_SOURCE', () => {
  it('matches Forge printed oracle text for a mana rock', () => {
    expect(new RegExp(MANA_ABILITY_LINE_SOURCE).test('{T}: Add {C}{C}.')).toBe(true);
  });
});

describe('parseCardDetail', () => {
  it('splits name, type line and rules text', () => {
    expect(parseCardDetail(solRing)).toEqual({
      name: 'Sol Ring',
      typeLine: 'Artifact',
      rulesText: '{T}: Add {C}{C}.',
    });
  });
});

describe('isManaSourceDetail', () => {
  it('matches an artifact mana rock', () => {
    expect(isManaSourceDetail(solRing)).toBe(true);
  });

  it('matches a mana rock with more than one ability line', () => {
    expect(isManaSourceDetail(talisman)).toBe(true);
  });

  it('matches a color-identity mana rock', () => {
    expect(isManaSourceDetail(arcaneSignet)).toBe(true);
  });

  it('does not match a basic land, even though it taps for mana', () => {
    expect(isManaSourceDetail(swamp)).toBe(false);
  });

  it('does not match a creature with no mana ability', () => {
    expect(isManaSourceDetail(guttersnipe)).toBe(false);
  });

  it('does not match a spell with no tap ability', () => {
    expect(isManaSourceDetail(lightningBolt)).toBe(false);
  });
});

describe('chooseManaSourceName', () => {
  const detail = (text: string): { name: string; detail: string } => ({
    name: parseCardDetail(text).name,
    detail: text,
  });

  it('picks the mana rock offered as a legal move', () => {
    const hand = [detail(commander), detail(swamp), detail(solRing), detail(guttersnipe)];
    const legal = new Set(['Sol Ring', 'Lightning Bolt']);
    expect(chooseManaSourceName(hand, legal)).toBe('Sol Ring');
  });

  it('returns null when no hand mana source is a legal move', () => {
    const hand = [detail(commander), detail(swamp), detail(guttersnipe)];
    const legal = new Set(['Lightning Bolt']);
    expect(chooseManaSourceName(hand, legal)).toBeNull();
  });

  it('returns null when the only mana source in hand is not offered as a move', () => {
    const hand = [detail(solRing)];
    const legal = new Set(['Pass priority']);
    expect(chooseManaSourceName(hand, legal)).toBeNull();
  });

  it('takes the first qualifying card in hand order', () => {
    const hand = [detail(arcaneSignet), detail(solRing)];
    const legal = new Set(['Sol Ring', 'Arcane Signet']);
    expect(chooseManaSourceName(hand, legal)).toBe('Arcane Signet');
  });
});
