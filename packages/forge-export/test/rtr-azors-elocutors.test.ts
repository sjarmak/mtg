/** Installed Forge parity for RTR Azor's Elocutors. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const ELOCUTORS = parseCard({
  kind: 'creature',
  id: 'rtr-210-azors-elocutors-forge',
  name: "Azor's Elocutors",
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 210 },
  manaCost: { generic: 3, hybrid: { 'W/U': 2 } },
  colors: ['W', 'U'],
  subtypes: ['Human', 'Advisor'],
  power: 3,
  toughness: 5,
  keywords: [],
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      effects: [{ kind: 'putCounters', counter: 'filibuster', count: 1, target: { kind: 'selfPermanent' } }],
      putCounterThenWinAtThreshold: { counter: 'filibuster', atLeast: 5 },
      printedSourceReference: 'thisCreature',
    },
    {
      kind: 'triggered',
      condition: 'selfIsDealtDamage',
      effects: [],
      controllerDamageRemovesSourceCounter: { counter: 'filibuster' },
      printedSourceReference: 'thisCreature',
    },
  ],
});

describe("Azor's Elocutors Forge export", () => {
  it('emits the installed linked counter-race script without generic duplicate triggers', () => {
    expect(mustTranspile(ELOCUTORS).split('\n')).toEqual([
      "Name:Azor's Elocutors",
      'ManaCost:3 WU WU',
      'Types:Creature Human Advisor',
      'PT:3/5',
      'T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ PutCounter | TriggerDescription$ At the beginning of your upkeep, put a filibuster counter on CARDNAME. Then if CARDNAME has five or more filibuster counters on it, you win the game.',
      'SVar:PutCounter:DB$ PutCounter | Defined$ Self | CounterType$ FILIBUSTER | CounterNum$ 1 | SubAbility$ WinGame',
      'SVar:WinGame:DB$ WinsGame | Defined$ You | ConditionCheckSVar$ TalkedEnough | ConditionSVarCompare$ GE5',
      'SVar:TalkedEnough:Count$CardCounters.FILIBUSTER',
      'T:Mode$ DamageDone | ValidTarget$ You | TriggerZones$ Battlefield | Execute$ RemoveCounter | TriggerDescription$ Whenever a source deals damage to you, remove a filibuster counter from CARDNAME.',
      'SVar:RemoveCounter:DB$ RemoveCounter | Defined$ Self | CounterType$ FILIBUSTER | CounterNum$ 1',
      'SVar:AIEvaluationModifier:30',
      "Oracle:At the beginning of your upkeep, put a filibuster counter on Azor's Elocutors. Then if Azor's Elocutors has five or more filibuster counters on it, you win the game.\\nWhenever a source deals damage to you, remove a filibuster counter from Azor's Elocutors.",
      '',
    ]);
  });
});
