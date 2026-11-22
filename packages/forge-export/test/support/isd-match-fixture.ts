/** Innistrad whole-game probe fixture: one basic, one audited one-drop, the seeds its receipts bind. */
import type { PrintedMatchFixture } from './printed-match-probes';

export const ISD_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'isd',
  title: 'ISD',
  land: 'Forest',
  creature: "Avacyn's Pilgrim",
  creatureManaValue: 1,
  seeds: {
    engineStarts: 'isd-local-pregame-v1',
    localToss: '1514',
    nativePriority: 'isd-native-priority-v1',
  },
};
