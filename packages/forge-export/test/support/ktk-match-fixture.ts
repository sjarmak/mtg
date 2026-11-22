/** Khans of Tarkir whole-game probe fixture: one basic, one audited one-drop, the seeds its receipts bind. */
import type { PrintedMatchFixture } from './printed-match-probes';

export const KTK_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'ktk',
  title: 'KTK',
  land: 'Mountain',
  creature: 'Monastery Swiftspear',
  creatureManaValue: 1,
  seeds: {
    engineStarts: 'ktk-local-pregame-v1',
    localToss: '1514',
    nativePriority: 'ktk-native-priority-v1',
  },
};
