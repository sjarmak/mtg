/** Mirrodin Besieged whole-game probe fixture: one basic, one audited one-drop, the seeds its receipts bind. */
import type { PrintedMatchFixture } from './printed-match-probes';

export const MBS_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'mbs',
  title: 'MBS',
  land: 'Forest',
  creature: "Avacyn's Pilgrim",
  creatureManaValue: 1,
  seeds: {
    engineStarts: 'mbs-local-pregame-v1',
    localToss: '1514',
    nativePriority: 'mbs-native-priority-v1',
  },
};
