/** Ixalan whole-game probe fixture: one basic, one audited creature, the seeds its receipts bind. */
import type { PrintedMatchFixture } from './printed-match-probes';

export const XLN_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'xln',
  title: 'XLN',
  land: 'Mountain',
  creature: 'Rampaging Ferocidon',
  creatureManaValue: 3,
  seeds: {
    engineStarts: 'xln-local-pregame-v3',
    localToss: '1514',
    nativePriority: 'xln-native-priority-v1',
  },
};
