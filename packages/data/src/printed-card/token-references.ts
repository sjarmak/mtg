/**
 * Which Forge token scripts a set of card scripts create.
 *
 * A Limited format's token sheet is one Scryfall token set, but a cube draws
 * its 600 cards from thirty sets and its tokens from as many, so the sheet a
 * cube needs is derived from what its scripts say rather than from a set code.
 * Forge names a token by its script (`TokenScript$ g_3_3_elephant`), one or
 * several per effect, and a keyword can create one without naming it: Living
 * Weapon makes a Phyrexian Germ. Those two are what the decision inventory
 * reads as generated dependencies. The token sheet reads a wider vocabulary,
 * because Forge also creates tokens for keywords and effects such as Amass,
 * Afterlife and Investigate whose card scripts name no token at all
 * (`implicitTokenScriptNames`). A token no script of the catalog creates is a
 * token no game of it makes.
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
 * The token scripts Forge 2.0.14 creates for a keyword or effect whose card
 * script names none (read from `CardFactoryUtil` and the effect classes in
 * the installed jar), beyond the Living Weapon Germ above. Amass names its
 * script from the type it amasses: `amass Slivers` makes `b_0_0_sliver_army`.
 *
 * Only the token sheet reads these. The decision inventory's generated
 * dependencies stay on `generatedTokenScriptNames`, because widening those
 * moves every affected candidate profile and so the play-admission hashes;
 * a sheet that witnesses more tokens than the ledger names costs nothing,
 * and the reverse draws a pending frame (#311: the precons' Zombie Army).
 */
function implicitTokenScriptNames(script: string): readonly string[] {
  const keyword = (name: string): boolean => new RegExp(`^K:${name}(?![A-Za-z])`, 'mu').test(script);
  const effect = (name: string): boolean => new RegExp(`\\b(?:AB|SP|DB)\\$\\s*${name}\\b`, 'u').test(script);
  return [
    ...(keyword('Afterlife') ? ['wb_1_1_spirit_flying'] : []),
    ...(keyword('Fabricate') ? ['c_1_1_a_servo'] : []),
    ...(keyword('Mobilize') ? ['r_1_1_warrior'] : []),
    ...(keyword('For Mirrodin') ? ['r_2_2_rebel'] : []),
    ...(keyword('Job select') ? ['c_1_1_hero'] : []),
    ...(effect('Investigate') ? ['c_a_clue_draw'] : []),
    ...(effect('Recruit') ? ['w_1_1_human_soldier'] : []),
    ...(effect('Endure') ? ['w_x_x_spirit'] : []),
    ...[...script.matchAll(/\b(?:AB|SP|DB)\$\s*Amass\b[^\n]*?\bType\$\s*([A-Za-z]+)/gu)].map(
      (match) => `b_0_0_${(match[1] ?? '').toLowerCase()}_army`,
    ),
  ];
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
    for (const name of implicitTokenScriptNames(new TextDecoder().decode(bytes))) references.add(name);
  }
  return [...references].sort();
}
