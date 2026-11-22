export type ForgeScriptSyntaxKind =
  'line-kind' | 'ability-api' | 'parameter-key' | 'keyword' | 'semantic-marker';

export interface ForgeScriptSyntaxToken {
  readonly kind: ForgeScriptSyntaxKind;
  readonly token: string;
}

const ABILITY_FIELDS = new Set(['SP', 'AB', 'DB', 'Mode', 'ReplacementEffect']);

/** Enumerates syntax only. A separately reviewed inventory assigns meaning. */
export function inventoryForgeScriptSyntax(bytes: Uint8Array): readonly ForgeScriptSyntaxToken[] {
  let script: string;
  try {
    script = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new Error(
      cause instanceof Error ? `Forge script is not UTF-8: ${cause.message}` : 'Forge script is not UTF-8',
    );
  }
  const found = new Map<string, ForgeScriptSyntaxToken>();
  let unresolvedChangeZoneProduct = false;
  const triggeredAbilityNames = new Set<string>();
  const costedAbilityNames = new Set<string>();
  const add = (kind: ForgeScriptSyntaxKind, token: string): void => {
    if (token.length > 0) found.set(`${kind}\0${token}`, { kind, token });
  };
  for (const rawLine of script.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon < 1) {
      add('line-kind', line);
      continue;
    }
    const lineKind = line.slice(0, colon);
    add('line-kind', lineKind);
    if (lineKind === 'K') {
      add(
        'keyword',
        line
          .slice(colon + 1)
          .split(/[|:]/u, 1)[0]
          ?.trim() ?? '',
      );
    }
    const afterKind = line.slice(colon + 1);
    const svarSeparator = lineKind === 'SVar' ? afterKind.indexOf(':') : -1;
    const svarName = svarSeparator > 0 ? afterKind.slice(0, svarSeparator).trim() : null;
    const body = lineKind === 'SVar' && svarSeparator > 0 ? afterKind.slice(svarSeparator + 1) : afterKind;
    if (lineKind === 'T') {
      for (const match of body.matchAll(/(?:^|\|)\s*Execute\$\s*([^\s|]+)/gu)) {
        if (match[1] !== undefined) triggeredAbilityNames.add(match[1]);
      }
    }
    if (svarName !== null) {
      const cost = body
        .split('|')
        .map((part) =>
          part
            .trim()
            .match(/^Cost\$\s*(.+)$/u)?.[1]
            ?.trim(),
        )
        .find((value) => value !== undefined);
      if (cost !== undefined && cost !== '0') costedAbilityNames.add(svarName);
    }
    if (
      /(?:^|\|)\s*(?:SP|AB|DB|ReplacementEffect)\$\s*ChangeZone\b/u.test(body) &&
      !/(?:^|\|)\s*Defined\$/u.test(body) &&
      (!/(?:^|\|)\s*ValidTgts\$/u.test(body) ||
        /(?:^|\|)\s*ValidTgts\$\s*(?:Player|Opponent)\s*(?:\||$)/u.test(body)) &&
      /(?:^|\|)\s*(?:ChangeType|ChangeNum|Chooser|SelectPrompt|Hidden)\$/u.test(body)
    ) {
      unresolvedChangeZoneProduct = true;
    }
    for (const part of body.split('|')) {
      const field = part.trim().match(/^([^$]+)\$\s*(.*)$/u);
      if (field?.[1] === undefined || field[2] === undefined) continue;
      const key = field[1].trim();
      add('parameter-key', key);
      if (ABILITY_FIELDS.has(key)) add('ability-api', field[2].trim().split(/\s/u, 1)[0] ?? '');
    }
  }
  add('semantic-marker', 'priority-window');
  if (
    /^Types:[^\n]*\bCreature\b/mu.test(script) ||
    /^K:Crew\b/mu.test(script) ||
    /\bTokenScript\$|\b(?:SP|AB|DB)\$\s*(?:Token|Animate|AnimateAll)\b/mu.test(script)
  ) {
    add('semantic-marker', 'card-enters-combat');
  }
  if (
    /^ManaCost:[^\n]*(?:\bX\b|\b[WUBRGC]P\b)/mu.test(script) ||
    /\bCost\$[^|\n]*\bX\b|Count\$xPaid|PayX|XChoice|\bProduced\$\s*Any\b/mu.test(script)
  ) {
    add('semantic-marker', 'variable-payment');
  }
  if (/\bCost\$[^|\n]*(?:Discard|Sac<)/mu.test(script)) {
    add('semantic-marker', 'discard-or-sacrifice-cost');
  }
  if (/\bOptional\$\s*True|\bMandatory\$\s*False|\bMayChooseTarget\$\s*True/mu.test(script)) {
    add('semantic-marker', 'optional-trigger-or-replacement');
  }
  if (/^K:ETBReplacement:[^\r\n]*:Optional(?:[:|]|$)/mu.test(script)) {
    add('semantic-marker', 'optional-copy-replacement');
  }
  if ([...triggeredAbilityNames].some((name) => costedAbilityNames.has(name))) {
    add('semantic-marker', 'triggered-payment');
  }
  if (/\bChoices\$\s*(?:Color|Type|Number)\b|^K:Protection:Choice\b/mu.test(script)) {
    add('semantic-marker', 'typed-or-valued-choice');
  }
  if (/^AlternateMode:/mu.test(script)) add('semantic-marker', 'alternate-mode');
  if (unresolvedChangeZoneProduct) add('semantic-marker', 'zone-card-choice');
  return [...found.values()].sort((left, right) =>
    left.kind === right.kind ? left.token.localeCompare(right.token) : left.kind.localeCompare(right.kind),
  );
}
