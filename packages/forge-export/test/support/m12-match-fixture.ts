/** Magic 2012 whole-game probe fixture: one basic, one audited one-drop, the seeds its receipts bind. */
import type { PrintedMatchFixture } from './printed-match-probes';

export const M12_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'm12',
  title: 'M12',
  land: 'Forest',
  creature: "Avacyn's Pilgrim",
  creatureManaValue: 1,
  seeds: {
    engineStarts: 'm12-local-pregame-v4',
    localToss: '1514',
    nativePriority: 'm12-native-priority-v1',
  },
};
