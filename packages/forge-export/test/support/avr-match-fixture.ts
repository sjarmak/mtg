/** Avacyn Restored whole-game probe fixture: one basic, one audited one-drop, the seeds its receipts bind. */
import type { PrintedMatchFixture } from './printed-match-probes';

export const AVR_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'avr',
  title: 'AVR',
  land: 'Forest',
  creature: "Avacyn's Pilgrim",
  creatureManaValue: 1,
  seeds: {
    engineStarts: 'avr-local-pregame-v3',
    localToss: '1514',
    nativePriority: 'avr-native-priority-v1',
  },
};
