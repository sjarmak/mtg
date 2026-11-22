/**
 * Token printings from Scryfall, each bound to the Forge token script that
 * witnesses its engine name.
 *
 * The binding is the point. `@mtg/printed-card`'s token schema refuses an
 * entry with no observed name, because a surface matches an object to a
 * printing by the engine's exact name and a name nobody witnessed matches
 * nothing. Forge's `tokenscripts/` directory is where those names are stated
 * (`Name:Pegasus Token`), one script per token, each with its types, colors
 * and P/T; a Scryfall token is bound to every script that says the same
 * token, and a token no script says is left out and reported rather than
 * guessed at. Two Forge scripts may say one printing (the blue and the
 * colorless Thopter are two scripts and two printings, but a set with one
 * Thopter printing would take both names); one script may also say two
 * printings, which is why the surface disambiguates by color and token-ness
 * before it gives up.
 */
import { z } from 'zod';
import { PrintedTokenPrintingSchema } from '@mtg/printed-card';
import type { PrintedTokenPrinting } from '@mtg/printed-card';
import type { ScryfallCard } from '../scryfall/schemas';

export interface ForgeTokenScript {
  readonly file: string;
  readonly name: string;
  /** Forge's `Types:` line, one word per type or subtype, in Forge's order. */
  readonly types: readonly string[];
  readonly colors: readonly ('W' | 'U' | 'B' | 'R' | 'G')[];
  readonly power: string | null;
  readonly toughness: string | null;
}

const FORGE_COLORS = new Map<string, 'W' | 'U' | 'B' | 'R' | 'G'>([
  ['white', 'W'],
  ['blue', 'U'],
  ['black', 'B'],
  ['red', 'R'],
  ['green', 'G'],
]);
const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'] as const;

function line(body: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:(.*)$`, 'mu').exec(body);
  return match?.[1]?.trim();
}

/** One Forge token script, or undefined when the file does not state a token. */
export function parseForgeTokenScript(file: string, body: string): ForgeTokenScript | undefined {
  const name = line(body, 'Name');
  const types = line(body, 'Types');
  if (name === undefined || name.length === 0 || types === undefined || types.length === 0) return undefined;
  const colors: ('W' | 'U' | 'B' | 'R' | 'G')[] = [];
  // Forge's five color words, plus `colorless` (no color) and `all` (every
  // color); the seven scripts saying `all` are the five-color tokens.
  for (const word of (line(body, 'Colors') ?? '').split(/[\s,]+/u).filter((part) => part.length > 0)) {
    const named = word.toLowerCase();
    const stated =
      named === 'all' ? [...COLOR_ORDER] : named === 'colorless' ? [] : [FORGE_COLORS.get(named)];
    for (const color of stated) {
      if (color === undefined) throw new Error(`Forge token script ${file} states an unknown color: ${word}`);
      if (!colors.includes(color)) colors.push(color);
    }
  }
  const pt = (line(body, 'PT') ?? '').split('/', 2).map((part) => part.trim());
  const power = pt[0] ?? '';
  const toughness = pt[1] ?? '';
  return {
    file,
    name,
    types: types.split(/\s+/u).filter((part) => part.length > 0),
    colors: [...colors].sort((left, right) => COLOR_ORDER.indexOf(left) - COLOR_ORDER.indexOf(right)),
    power: power.length === 0 ? null : power,
    toughness: toughness.length === 0 ? null : toughness,
  };
}

/** Scryfall's `Token Creature — Pegasus` as Forge writes it: `Creature Pegasus`. */
function forgeTypesOf(typeLine: string): readonly string[] {
  return typeLine
    .replace(/^Token\s+/u, '')
    .split(/\s+—\s+|\s+/u)
    .filter((part) => part.length > 0 && part !== '—');
}

/** Whether one Scryfall token states the token a Forge script states: types, colors and P/T. */
export function scriptSaysToken(card: ScryfallCard, script: ForgeTokenScript): boolean {
  const colors = [...(card.colors ?? [])].sort(
    (left, right) => COLOR_ORDER.indexOf(left) - COLOR_ORDER.indexOf(right),
  );
  return (
    forgeTypesOf(card.type_line).join(' ') === script.types.join(' ') &&
    colors.join('') === script.colors.join('') &&
    (card.power ?? null) === script.power &&
    (card.toughness ?? null) === script.toughness
  );
}

export interface TokenCollectorKey {
  /** A positive integer: the collector number's own value, or the first number inside it. */
  readonly position: number;
  /** The collector number as it appears in a `physicalId`. */
  readonly idSegment: string;
}

/**
 * How a token row's collector number becomes its position and its `physicalId`
 * segment. A plain integer (`7`) keeps the form every installed file was written
 * with: position 7, segment `0007`. A number with letters in it (`1a`, `T3`, the
 * suffixes Scryfall gives a token sheet's variants and a promo run) takes its first
 * digit run as its position and the number itself, lowercased with runs of anything
 * else folded to `-`, as its segment (`1a`, `t3`). Several rows can share a position
 * (`1a`, `1b`, `1c`); the row's Scryfall id, which ends every `physicalId`, keeps
 * each one distinct. A collector number with no digit at all has nowhere to sit on
 * the sheet and yields nothing.
 */
export function tokenCollectorKey(collectorNumber: string): TokenCollectorKey | undefined {
  const position = Number.parseInt(/\d+/u.exec(collectorNumber)?.[0] ?? '', 10);
  if (!Number.isSafeInteger(position) || position <= 0) return undefined;
  if (/^[1-9]\d*$/u.test(collectorNumber)) {
    return { position, idSegment: collectorNumber.padStart(4, '0') };
  }
  const idSegment = collectorNumber
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-|-$/gu, '');
  return { position, idSegment };
}

/**
 * Statements the automatic name-and-type match cannot reach: a Forge script
 * naming and typing a token differently from how Scryfall names and types the
 * printing it witnesses. Each entry says outright which printing a script
 * binds to; the binder still checks colors and power/toughness agree, only
 * the name and type-line comparison is skipped for these pairs.
 *
 * Wurmcoil Engine's two Wurm tokens (mtg-bn1ah): Scryfall prints them as
 * TSOM 8 and 9, named "Wurm", typed "Token Artifact Creature — Wurm"; both
 * Forge scripts say "Phyrexian Wurm Token", typed "Artifact Creature Phyrexian
 * Wurm", and differ only in deathtouch (TSOM 8) and lifelink (TSOM 9). Keep this
 * consistent with `STATED_ALIAS_TYPE_MISMATCH` in
 * packages/data/test/token-printings.test.ts, which exempts the same two
 * physical ids from the type-line check over the installed file.
 *
 * Living Weapon's Germ (mtg-9ggmy): its oldest printing is TMBS 1, named
 * "Germ", typed "Token Creature — Germ", and Forge's Living Weapon creates
 * "Phyrexian Germ Token", typed "Creature Phyrexian Germ". The printing also
 * matches Forge's plain "Germ Token" by name, so a stated alias adds its
 * script to the automatic witnesses rather than standing in for none.
 */
const STATED_ALIASES: readonly StatedTokenAlias[] = [
  {
    forgeName: 'Phyrexian Wurm Token',
    forgeTypes: ['Artifact', 'Creature', 'Phyrexian', 'Wurm'],
    forgeScript: 'c_3_3_a_phyrexian_wurm_deathtouch.txt',
    setCode: 'TSOM',
    collectorNumber: '8',
  },
  {
    forgeName: 'Phyrexian Wurm Token',
    forgeTypes: ['Artifact', 'Creature', 'Phyrexian', 'Wurm'],
    forgeScript: 'c_3_3_a_phyrexian_wurm_lifelink.txt',
    setCode: 'TSOM',
    collectorNumber: '9',
  },
  {
    forgeName: 'Phyrexian Germ Token',
    forgeTypes: ['Creature', 'Phyrexian', 'Germ'],
    setCode: 'TMBS',
    collectorNumber: '1',
  },
];

export interface StatedTokenAlias {
  readonly forgeName: string;
  readonly forgeTypes: readonly string[];
  /** The one script file meant, where two scripts share a name and types and differ only in keywords. */
  readonly forgeScript?: string;
  readonly setCode: string;
  readonly collectorNumber: string;
}

/** The printings stated outright for a script, which a name lookup cannot find. */
export function statedAliasesFor(script: ForgeTokenScript): readonly StatedTokenAlias[] {
  return STATED_ALIASES.filter(
    (alias) =>
      alias.forgeName === script.name &&
      alias.forgeTypes.join(' ') === script.types.join(' ') &&
      (alias.forgeScript === undefined || alias.forgeScript === script.file),
  );
}

/** Whether a stated alias binds this script to this printing: the facts other than name and type still agree. */
export function aliasSaysToken(setCode: string, card: ScryfallCard, script: ForgeTokenScript): boolean {
  return (
    statedAliasesFor(script).some(
      (alias) => alias.setCode === setCode.toUpperCase() && alias.collectorNumber === card.collector_number,
    ) && scriptAgreesOnColorsAndPt(card, script)
  );
}

/** Whether a script states the same colors and power/toughness as the card, ignoring name and type. */
function scriptAgreesOnColorsAndPt(card: ScryfallCard, script: ForgeTokenScript): boolean {
  const colors = [...(card.colors ?? [])].sort(
    (left, right) => COLOR_ORDER.indexOf(left) - COLOR_ORDER.indexOf(right),
  );
  return (
    colors.join('') === script.colors.join('') &&
    (card.power ?? null) === script.power &&
    (card.toughness ?? null) === script.toughness
  );
}

export interface TokenPrintingOutcome {
  readonly tokens: readonly PrintedTokenPrinting[];
  /** Scryfall rows left out, each with why: not a token layout, or no Forge script says it. */
  readonly omitted: readonly {
    readonly name: string;
    readonly collectorNumber: string;
    readonly reason: string;
  }[];
}

const ScryfallImageUris = z.record(z.string().min(1), z.url());

/**
 * Binds one set's Scryfall rows to Forge's token scripts. A row is kept when
 * its layout is `token` and at least one script names the same token; the
 * names of every such script are its observed names.
 */
export function bindTokenPrintings(
  setCode: string,
  cards: readonly ScryfallCard[],
  scripts: readonly ForgeTokenScript[],
): TokenPrintingOutcome {
  const tokens: PrintedTokenPrinting[] = [];
  const omitted: { name: string; collectorNumber: string; reason: string }[] = [];
  for (const card of cards) {
    if (card.layout !== 'token') {
      omitted.push({
        name: card.name,
        collectorNumber: card.collector_number,
        reason: `layout ${card.layout}`,
      });
      continue;
    }
    const witnesses = scripts.filter(
      (script) =>
        ((script.name === card.name || script.name === `${card.name} Token`) &&
          scriptSaysToken(card, script)) ||
        aliasSaysToken(setCode, card, script),
    );
    if (witnesses.length === 0) {
      omitted.push({
        name: card.name,
        collectorNumber: card.collector_number,
        reason: 'no Forge token script',
      });
      continue;
    }
    const key = tokenCollectorKey(card.collector_number);
    if (key === undefined) {
      omitted.push({
        name: card.name,
        collectorNumber: card.collector_number,
        reason: 'no position in the collector number',
      });
      continue;
    }
    const artCrop = ScryfallImageUris.parse(card.image_uris ?? {})['art_crop'];
    const colors = [...(card.colors ?? [])].sort(
      (left, right) => COLOR_ORDER.indexOf(left) - COLOR_ORDER.indexOf(right),
    );
    const face = {
      name: card.name,
      manaCost: null,
      typeLine: card.type_line,
      oracleText: card.oracle_text ?? null,
      power: card.power ?? null,
      toughness: card.toughness ?? null,
      loyalty: card.loyalty ?? null,
      colors,
    };
    tokens.push(
      PrintedTokenPrintingSchema.parse({
        physicalId: `${setCode.toLowerCase()}-token:${key.idSegment}:${card.id}`,
        position: key.position,
        setCode,
        name: card.name,
        observedNames: [...new Set(witnesses.map((script) => script.name))].sort(),
        oracleId: card.oracle_id,
        scryfallId: card.id,
        typeLine: card.type_line,
        power: face.power,
        toughness: face.toughness,
        loyalty: face.loyalty,
        colors,
        faces: [face],
        art:
          artCrop === undefined
            ? {
                status: 'missing',
                source: 'scryfall',
                scryfallId: card.id,
                reason: 'Scryfall lists no art crop',
              }
            : {
                status: 'available',
                source: 'scryfall',
                scryfallId: card.id,
                images: [{ face: null, uris: { art_crop: artCrop } }],
              },
      }),
    );
  }
  tokens.sort(
    (left, right) => left.position - right.position || (left.physicalId < right.physicalId ? -1 : 1),
  );
  return { tokens, omitted };
}
