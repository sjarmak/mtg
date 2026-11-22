/** Source-attested Forge parity for Obstinate Baloth. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const BALOTH = parseCard({
  kind: 'creature',
  id: 'm11-188-obstinate-baloth-forge',
  name: 'Obstinate Baloth',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 188 },
  manaCost: { generic: 2, G: 2 },
  colors: ['G'],
  subtypes: ['Beast'],
  power: 4,
  toughness: 4,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'gainLife', amount: 4, target: { kind: 'noTarget' } }],
    },
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'discardedByOpponentEntersBattlefield' },
    },
  ],
});

describe('Obstinate Baloth Forge export', () => {
  it('emits Forge current card source exactly', () => {
    const result = transpileCard(BALOTH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.text).toBe(
      [
        'Name:Obstinate Baloth',
        'ManaCost:2 G G',
        'Types:Creature Beast',
        'PT:4/4',
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ Trig1Effect1 | TriggerDescription$ When CARDNAME enters the battlefield, you gain 4 life.',
        'SVar:Trig1Effect1:DB$ GainLife | Defined$ You | LifeAmount$ 4',
        'R:Event$ Moved | ActiveZones$ Hand | ValidCard$ Card.Self | ValidCause$ SpellAbility.OppCtrl | Discard$ True | EffectOnly$ True | ReplaceWith$ SurpriseETB | Description$ If a spell or ability an opponent controls causes you to discard CARDNAME, put it onto the battlefield instead of putting it into your graveyard.',
        'SVar:SurpriseETB:DB$ ChangeZone | Defined$ ReplacedCard | Origin$ Hand | Destination$ Battlefield',
        'SVar:DiscardMeByOpp:2',
        'DeckHas:Ability$LifeGain',
        'Oracle:When Obstinate Baloth enters the battlefield, you gain 4 life.\\nIf a spell or ability an opponent controls causes you to discard Obstinate Baloth, put it onto the battlefield instead of putting it into your graveyard.',
        '',
      ].join('\n'),
    );
  });
});
