/** Theros whole-game probe fixture: one basic, one audited one-drop, the seeds its receipts bind. */
import type { PrintedMatchFixture } from './printed-match-probes';

export const THS_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'ths',
  title: 'THS',
  land: 'Forest',
  creature: "Avacyn's Pilgrim",
  creatureManaValue: 1,
  seeds: {
    engineStarts: 'ths-local-pregame-v1',
    localToss: '1514',
    nativePriority: 'ths-native-priority-v1',
  },
};
