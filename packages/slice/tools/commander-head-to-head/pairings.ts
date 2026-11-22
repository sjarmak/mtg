export interface Pairing {
  readonly a: string;
  readonly b: string;
}

export function allPairings(deckIds: readonly string[]): readonly Pairing[] {
  const pairings: Pairing[] = [];
  for (let i = 0; i < deckIds.length; i += 1) {
    for (let j = i + 1; j < deckIds.length; j += 1) {
      pairings.push({ a: deckIds[i]!, b: deckIds[j]! });
    }
  }
  return pairings;
}

export function parsePairArg(arg: string): Pairing {
  const [a, b, ...rest] = arg.split(':');
  if (a === undefined || b === undefined || a.length === 0 || b.length === 0 || rest.length > 0) {
    throw new Error(`--pair expects "a:b", got "${arg}"`);
  }
  return { a, b };
}

export function resolvePairings(
  deckIds: readonly string[],
  explicit: readonly Pairing[],
): readonly Pairing[] {
  if (explicit.length === 0) return allPairings(deckIds);
  const known = new Set(deckIds);
  for (const pairing of explicit) {
    if (!known.has(pairing.a)) throw new Error(`--pair names an unknown deck: ${pairing.a}`);
    if (!known.has(pairing.b)) throw new Error(`--pair names an unknown deck: ${pairing.b}`);
    if (pairing.a === pairing.b) throw new Error(`--pair names a deck against itself: ${pairing.a}`);
  }
  return explicit;
}

function pairingKey(pairing: Pairing): string {
  return `${pairing.a}\u0000${pairing.b}`;
}

export function remainingPairings(all: readonly Pairing[], done: readonly Pairing[]): readonly Pairing[] {
  const finished = new Set(done.map(pairingKey));
  return all.filter((pairing) => !finished.has(pairingKey(pairing)));
}
