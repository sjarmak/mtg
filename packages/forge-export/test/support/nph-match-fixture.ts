/** New Phyrexia whole-game probe fixture: one basic, one audited one-drop, the seeds its receipts bind. */
import type { PrintedMatchFixture } from './printed-match-probes';

export const NPH_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'nph',
  title: 'NPH',
  land: 'Forest',
  creature: "Avacyn's Pilgrim",
  creatureManaValue: 1,
  seeds: {
    engineStarts: 'nph-local-pregame-v2',
    localToss: '1514',
    nativePriority: 'nph-native-priority-v1',
  },
};
