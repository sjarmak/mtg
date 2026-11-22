/** Magic 2015 whole-game probe fixture: one basic, one audited one-drop, the seeds its receipts bind. */
import type { PrintedMatchFixture } from './printed-match-probes';

export const M15_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'm15',
  title: 'M15',
  land: 'Forest',
  creature: "Avacyn's Pilgrim",
  creatureManaValue: 1,
  seeds: {
    engineStarts: 'm15-local-pregame-v4',
    localToss: '1514',
    nativePriority: 'm15-native-priority-v1',
  },
};
