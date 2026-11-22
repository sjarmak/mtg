/** Rise of the Eldrazi whole-game probe fixture: one basic, one audited one-drop, the seeds its receipts bind. */
import type { PrintedMatchFixture } from './printed-match-probes';

export const ROE_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'roe',
  title: 'ROE',
  land: 'Forest',
  creature: "Avacyn's Pilgrim",
  creatureManaValue: 1,
  seeds: {
    engineStarts: 'roe-local-pregame-v1',
    localToss: '1514',
    nativePriority: 'roe-native-priority-v1',
  },
};
