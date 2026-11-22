/** Installed Forge parity for RTR Deathrite Shaman. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const DEATHRITE = parseCard({
  kind: 'creature',
  id: 'rtr-213-deathrite-shaman-forge',
  name: 'Deathrite Shaman',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 213 },
  manaCost: { hybrid: { 'B/G': 1 } },
  colors: ['B', 'G'],
  subtypes: ['Elf', 'Shaman'],
  power: 1,
  toughness: 2,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      activateOnlyAsInstantReminder: true,
      effects: [
        {
          kind: 'exileTarget',
          target: { kind: 'targetCardInAGraveyard', filter: { cardTypes: ['land'] } },
        },
        { kind: 'addMana', amount: 1, produces: ['W', 'U', 'B', 'R', 'G'] },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: { B: 1 }, tapSelf: true },
      effects: [
        {
          kind: 'exileTarget',
          target: {
            kind: 'targetCardInAGraveyard',
            filter: { cardTypes: ['instant', 'sorcery'] },
          },
        },
        { kind: 'loseLife', amount: 2, players: 'eachOpponent', target: { kind: 'noTarget' } },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: { G: 1 }, tapSelf: true },
      effects: [
        {
          kind: 'exileTarget',
          target: { kind: 'targetCardInAGraveyard', filter: { cardTypes: ['creature'] } },
        },
        { kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } },
      ],
    },
  ],
});

describe('Deathrite Shaman Forge export', () => {
  it('emits the installed graveyard targets and linked mana/life subabilities', () => {
    const script = mustTranspile(DEATHRITE);
    expect(script).toContain(
      'A:AB$ ChangeZone | Cost$ T | ValidTgts$ Land | Origin$ Graveyard | Destination$ Exile',
    );
    expect(script).toContain('DB$ Mana | Produced$ Any | Amount$ 1');
    expect(script).toContain(
      'A:AB$ ChangeZone | Cost$ B T | ValidTgts$ Instant,Sorcery | Origin$ Graveyard | Destination$ Exile',
    );
    expect(script).toContain('DB$ LoseLife | Defined$ Player.Opponent | LifeAmount$ 2');
    expect(script).toContain(
      'A:AB$ ChangeZone | Cost$ G T | ValidTgts$ Creature | Origin$ Graveyard | Destination$ Exile',
    );
    expect(script).toContain('DB$ GainLife | Defined$ You | LifeAmount$ 2');
    expect(script).toContain(
      'Oracle:{T}: Exile target land card from a graveyard. Add one mana of any color.\\n{B}, {T}: Exile target instant or sorcery card from a graveyard. Each opponent loses 2 life.\\n{G}, {T}: Exile target creature card from a graveyard. You gain 2 life.',
    );
  });
});
