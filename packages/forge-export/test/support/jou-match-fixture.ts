/** Journey into Nyx whole-game probe fixture: one basic, one audited one-drop, the seeds its receipts bind. */
import type { PrintedMatchFixture } from './printed-match-probes';

export const JOU_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'jou',
  title: 'JOU',
  land: 'Forest',
  creature: "Avacyn's Pilgrim",
  creatureManaValue: 1,
  seeds: {
    engineStarts: 'jou-local-pregame-v2',
    localToss: '1514',
    nativePriority: 'jou-native-priority-v1',
  },
};
