/** The three public graveyard singleton routes reviewed in the human bridge. */
export type LegacyCubePublicGraveyardSelectionShape =
  'targeted-own-exile' | 'replacement-pooled-imprint' | 'each-player-return';

export const LEGACY_CUBE_PUBLIC_GRAVEYARD_SELECTION_SHAPES: Readonly<
  Record<number, LegacyCubePublicGraveyardSelectionShape | undefined>
> = {
  201: 'replacement-pooled-imprint',
  212: 'each-player-return',
  472: 'targeted-own-exile',
};

interface ScriptRecord {
  readonly kind: string;
  readonly name: string | null;
  readonly fields: ReadonlyMap<string, string>;
}

const COMMON_FIELDS = {
  Origin: 'Graveyard',
  ChangeNum: '1',
  Hidden: 'True',
  Mandatory: 'True',
} as const;

const SHAPE_FIELDS: Readonly<
  Record<LegacyCubePublicGraveyardSelectionShape, Readonly<Record<string, string>>>
> = {
  'targeted-own-exile': {
    ...COMMON_FIELDS,
    AB: 'ChangeZone',
    Cost: 'T',
    Destination: 'Exile',
    ValidTgts: 'Player',
    DefinedPlayer: 'Targeted',
    ChangeType: 'Card',
    IsCurse: 'True',
    Chooser: 'Targeted',
  },
  'replacement-pooled-imprint': {
    ...COMMON_FIELDS,
    DB: 'ChangeZone',
    Imprint: 'True',
    ChangeType: 'Creature.NotDefinedReplacedSimultaneousETB',
    Destination: 'Exile',
    Chooser: 'You',
  },
  'each-player-return': {
    ...COMMON_FIELDS,
    SP: 'ChangeZone',
    Destination: 'Battlefield',
    ChangeType: 'Creature',
    DefinedPlayer: 'Player',
  },
};

function parseRecords(text: string): {
  readonly records: readonly ScriptRecord[];
  readonly keywords: readonly string[];
  readonly refusals: readonly string[];
} {
  const records: ScriptRecord[] = [];
  const keywords: string[] = [];
  const refusals: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('K:')) keywords.push(line.slice(2));
    const match = /^(A|T|R|S|SVar):(.*)$/.exec(line);
    if (match === null) continue;
    const kind = match[1]!;
    let body = match[2]!;
    let name: string | null = null;
    if (kind === 'SVar') {
      const separator = body.indexOf(':');
      if (separator < 1) {
        refusals.push('malformed SVar declaration');
        continue;
      }
      name = body.slice(0, separator);
      body = body.slice(separator + 1);
    }
    const fields = new Map<string, string>();
    if (body.includes('$')) {
      for (const field of body.split('|')) {
        const parsed = /^\s*([A-Za-z][A-Za-z0-9]*)\$\s*(.*?)\s*$/.exec(field);
        if (parsed === null || parsed[2] === '') {
          refusals.push('malformed script field');
          continue;
        }
        const key = parsed[1]!;
        if (fields.has(key)) refusals.push(`duplicate script field ${key}`);
        fields.set(key, parsed[2]!);
      }
    }
    records.push({ kind, name, fields });
  }
  return { records, keywords, refusals };
}

function rootRefusals(
  callback: ScriptRecord,
  records: readonly ScriptRecord[],
  keywords: readonly string[],
  shape: LegacyCubePublicGraveyardSelectionShape,
): readonly string[] {
  if (shape !== 'replacement-pooled-imprint') {
    return callback.kind === 'A' ? [] : ['selection must be a direct ability root'];
  }
  const name = callback.name;
  if (callback.kind !== 'SVar' || name === null) return ['imprint must be an entry replacement SVar'];
  if (records.filter((record) => record.name === name).length !== 1) {
    return ['replacement SVar must have one declaration'];
  }
  const links = keywords.filter((keyword) => keyword.split(':').includes(name));
  if (links.length !== 1 || links[0] !== `ETBReplacement:Other:${name}`) {
    return ['imprint must have one exact entry replacement link'];
  }
  if (
    records.some((record) =>
      [...record.fields.entries()].some(
        ([key, value]) => key !== 'SpellDescription' && value.split(/[\s,]+/).includes(name),
      ),
    )
  ) {
    return ['replacement selection also has an unreviewed parent link'];
  }
  return [];
}

/** Checks callback authority and reachability independently of script hashes and other profiles. */
export function legacyCubePublicGraveyardSelectionRefusals(
  bytes: Uint8Array,
  shape: LegacyCubePublicGraveyardSelectionShape,
): readonly string[] {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return ['public graveyard script is not valid UTF-8'];
  }
  const { records, keywords, refusals } = parseRecords(text);
  const callbacks = records.filter((record) =>
    ['AB', 'SP', 'DB'].some((api) => record.fields.get(api) === 'ChangeZone'),
  );
  const callback = callbacks[0];
  if (callbacks.length !== 1 || callback === undefined) {
    return [...refusals, 'public graveyard route requires exactly one ChangeZone record'];
  }
  const expected = SHAPE_FIELDS[shape];
  const fieldRefusals = Object.entries(expected).flatMap(([key, value]) =>
    callback.fields.get(key) === value ? [] : [`public graveyard ${shape} requires ${key}$ ${value}`],
  );
  const extraFields = [...callback.fields.keys()].filter(
    (key) => !Object.hasOwn(expected, key) && key !== 'SpellDescription',
  );
  return [
    ...refusals,
    ...fieldRefusals,
    ...extraFields.map((key) => `unreviewed public graveyard field ${key}`),
    ...rootRefusals(callback, records, keywords, shape),
  ];
}
