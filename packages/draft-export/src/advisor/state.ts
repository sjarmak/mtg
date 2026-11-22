/** The advisor accepts this projection, never a draft engine state or seed. */
export interface AdvisorCard {
  readonly physicalId: string;
  readonly correctedName: string;
  readonly name: string;
  readonly manaValue: number;
  readonly manaCost: string | null;
  readonly colors: readonly string[];
  readonly typeLine: string;
  readonly faces?: readonly {
    readonly typeLine: string;
    readonly manaCost: string | null;
    readonly colors: readonly string[] | null;
  }[];
}

/** Printed catalogs retain both faces; early mana/curve concerns the front face. */
function frontCard(card: AdvisorCard): AdvisorCard {
  const face = card.faces?.[0];
  return face === undefined
    ? card
    : { ...card, typeLine: face.typeLine, colors: face.colors ?? card.colors, manaCost: face.manaCost };
}

export interface SeenPack {
  readonly round: number;
  readonly pickNumber: number;
  readonly cards: readonly AdvisorCard[];
}

export interface ObservedDraft {
  readonly seats: number;
  readonly packSize: number;
  readonly rounds: number;
  readonly observations: readonly SeenPack[];
  readonly picks: readonly string[];
}

export interface DraftMemory {
  readonly pool: readonly AdvisorCard[];
  readonly current: SeenPack | null;
  readonly passed: readonly {
    readonly round: number;
    readonly pickNumber: number;
    readonly cards: readonly AdvisorCard[];
  }[];
}

/** Validate a chronological single-seat transcript at the trust boundary. */
export function readDraftMemory(state: ObservedDraft): DraftMemory {
  for (const [label, value] of Object.entries({
    seats: state.seats,
    packSize: state.packSize,
    rounds: state.rounds,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid draft ${label}`);
  }
  if (
    state.seats < 2 ||
    state.picks.length > state.rounds * state.packSize ||
    state.observations.length !== Math.min(state.picks.length + 1, state.rounds * state.packSize)
  ) {
    throw new Error('Advisor transcript is incomplete or contains future observations');
  }
  if (new Set(state.picks).size !== state.picks.length) throw new Error('Duplicate singleton pick');
  const pool = state.picks.map((id, index) => {
    const card = state.observations[index]?.cards.find((entry) => entry.physicalId === id);
    if (card === undefined) throw new Error(`Pick ${String(index + 1)} was not observed`);
    return frontCard(card);
  });
  state.observations.forEach((seen, index) => {
    if (
      seen.round !== Math.floor(index / state.packSize) + 1 ||
      seen.pickNumber !== (index % state.packSize) + 1 ||
      seen.cards.length !== state.packSize - (index % state.packSize) ||
      new Set(seen.cards.map((c) => c.physicalId)).size !== seen.cards.length ||
      seen.cards.some((c) => state.picks.slice(0, index).includes(c.physicalId))
    ) {
      throw new Error(`Invalid observed pack at decision ${String(index + 1)}`);
    }
    const earlier =
      index % state.packSize >= state.seats ? state.observations[index - state.seats] : undefined;
    if (
      earlier === undefined &&
      seen.cards.some((card) =>
        state.observations
          .slice(0, index)
          .some((old) => old.cards.some((c) => c.physicalId === card.physicalId)),
      )
    ) {
      throw new Error('A singleton appeared in unrelated packs');
    }
    if (
      earlier !== undefined &&
      seen.cards.some((c) => !earlier.cards.some((old) => old.physicalId === c.physicalId))
    ) {
      throw new Error('A wheeled pack contains an unobserved replacement');
    }
  });
  return {
    pool,
    current:
      state.observations[state.picks.length] === undefined
        ? null
        : {
            ...state.observations[state.picks.length]!,
            cards: state.observations[state.picks.length]!.cards.map(frontCard),
          },
    passed: state.observations.slice(0, state.picks.length).map((seen, i) => ({
      round: seen.round,
      pickNumber: seen.pickNumber,
      cards: seen.cards.filter((card) => card.physicalId !== state.picks[i]),
    })),
  };
}
