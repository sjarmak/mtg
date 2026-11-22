import type { PrintedFormatRow } from '../../lab/printed-format';

type PlayAvailability = PrintedFormatRow['availability']['play'];

export function printedPlayAvailabilityCopy(availability: PlayAvailability): string {
  if (availability.status === 'supported') return 'Plays against Forge.';
  if (availability.status === 'experimental') return 'You can try a Forge match, but it may stop.';
  return availability.reason;
}
