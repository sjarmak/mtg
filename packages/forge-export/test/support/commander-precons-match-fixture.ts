import { COMMANDER_RULES } from '@mtg/engine';
import type { PrintedMatchFixture } from './printed-match-probes';

export const COMMANDER_PRECONS_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'commander-precons',
  title: 'Commander precons',
  land: 'Forest',
  creature: "Avacyn's Pilgrim",
  creatureManaValue: 1,
  rules: COMMANDER_RULES,
  commanders: [['Trostani Discordant'], ['Trostani Discordant']],
  seeds: {
    engineStarts: 'commander-precons-local-pregame-v1',
    localToss: '1514',
    nativePriority: 'commander-precons-native-priority-v1',
  },
};
