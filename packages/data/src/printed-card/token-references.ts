/**
 * Which Forge token scripts a set of card scripts create.
 *
 * A Limited format's token sheet is one Scryfall token set, but a cube draws
 * its 600 cards from thirty sets and its tokens from as many, so the sheet a
 * cube needs is derived from what its scripts say rather than from a set code.
 * Forge names a token by its script (`TokenScript$ g_3_3_elephant`), one or
 * several per effect, and a keyword can create one without naming it: Living
 * Weapon makes a Phyrexian Germ. Those two are the whole vocabulary a card has
 * for creating a token, and they are the same two the decision inventory reads
 * as generated dependencies, so the token sheet and the qualification ledger
 * cannot disagree about which tokens a catalog makes. A token no script of the
 * catalog creates is a token no game of it makes.
 */

/** Exact generated token resources referenced directly or by a closed keyword implementation. */
export function generatedTokenScriptNames(bytes: Uint8Array): readonly string[] {
  const script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return [
    ...new Set([
      // One effect may name several scripts, comma-joined (Wurmcoil Engine's two Wurms).
      ...[...script.matchAll(/\bTokenScript\$\s*([^\s|]+)/gu)]
        .flatMap((match) => (match[1] ?? '').split(','))
        .filter((name) => name.length > 0),
      ...(/^K:Living Weapon$/mu.test(script) ? ['b_0_0_phyrexian_germ'] : []),
    ]),
  ].sort((left, right) => left.localeCompare(right));
}

/**
 * The token scripts a catalog's card scripts create, sorted, read from the
 * installed script archive. A catalog script the archive does not hold is a
 * refusal, not a silent gap: the sheet would then be short one card's tokens
 * and nothing would say so.
 */
export function catalogTokenScriptReferences(
  scriptPaths: readonly string[],
  archive: ReadonlyMap<string, Uint8Array>,
): readonly string[] {
  const references = new Set<string>();
  for (const path of scriptPaths) {
    const bytes = archive.get(path);
    if (bytes === undefined) throw new Error(`Forge script archive does not hold ${path}`);
    for (const name of generatedTokenScriptNames(bytes)) references.add(name);
  }
  return [...references].sort();
}
