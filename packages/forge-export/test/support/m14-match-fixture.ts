/** Magic 2014 whole-game probe fixture: one basic, one audited one-drop, the seeds its receipts bind. */
import type { PrintedMatchFixture } from './printed-match-probes';

export const M14_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'm14',
  title: 'M14',
  land: 'Forest',
  creature: "Avacyn's Pilgrim",
  creatureManaValue: 1,
  seeds: {
    engineStarts: 'm14-local-pregame-v3',
    localToss: '1514',
    nativePriority: 'm14-native-priority-v1',
  },
};
