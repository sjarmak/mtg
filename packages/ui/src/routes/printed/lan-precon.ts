import type { DeckRef, MatchRules } from '@mtg/engine';
import { startObservedTable } from '../../net/observed-table';
import type { LanForgeAvailability } from '../../net/observed-table';

export const LAN_PRECON_LABEL = 'Play LAN match';

export interface PreconLanPlay {
  readonly label: string;
  readonly refusal: string | null;
  readonly onPress: (hostDeckId: string, guestDeck: DeckRef) => Promise<string | null>;
}

export interface PreconLanPlayInput {
  readonly base: string;
  readonly format: string;
  readonly rules: MatchRules | undefined;
  readonly availability: LanForgeAvailability;
  readonly seat: (token: string, hostDeckId: string) => void;
  readonly start?: typeof startObservedTable;
}

export function preconLanPlay(input: PreconLanPlayInput): PreconLanPlay {
  const open = input.start ?? startObservedTable;
  return {
    label: LAN_PRECON_LABEL,
    refusal: input.availability.status === 'ready' ? null : input.availability.reason,
    onPress: async (hostDeckId, guestDeck): Promise<string | null> => {
      const started = await open(input.base, {
        format: input.format,
        content: { kind: 'printed', format: input.format },
        seed: null,
        maximumTurns: null,
        deck: guestDeck,
        ...(input.rules === undefined ? {} : { rules: input.rules }),
      });
      if (!started.ok) return started.message;
      input.seat(started.host, hostDeckId);
      return null;
    },
  };
}
