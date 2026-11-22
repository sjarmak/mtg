/**
 * Forge's `.dck` deck file, read as data.
 *
 * The shape, measured over the 173 shipped Commander precons: a `[metadata]`
 * section of `key=value` lines, then `[Commander]`, `[Main]` and `[Sideboard]`
 * sections of `<count> <name>|<set code>|<art index>` lines. Older files write
 * the section names in lower case, some end lines with a carriage return, a
 * few put two headers on one line (`[Sideboard][metadata]`), 65 lines carry no
 * set code, and a `+` on the end of a name marks a foil printing. The art
 * index is Forge's own numbering of an edition's printings of one name, not a
 * collector number, and is dropped: a catalog resolves a name and a set code.
 */

export interface ForgeDeckEntry {
  readonly name: string;
  /** Absent when the file names no edition for the line. */
  readonly setCode?: string;
  readonly count: number;
}

export interface ForgeDeckFile {
  readonly name: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly commanders: readonly ForgeDeckEntry[];
  readonly main: readonly ForgeDeckEntry[];
  readonly sideboard: readonly ForgeDeckEntry[];
}

const SECTIONS = ['metadata', 'commander', 'main', 'sideboard'] as const;
type Section = (typeof SECTIONS)[number];
const HEADER = /^\[([A-Za-z]+)\]/u;
const CARD = /^(\d+)\s+(.+?)\s*$/u;

function sectionOf(header: string, line: number): Section {
  const name = header.toLowerCase();
  const section = SECTIONS.find((known) => known === name);
  if (section === undefined)
    throw new Error(`Forge deck file line ${String(line)}: unknown section [${header}]`);
  return section;
}

function entryOf(text: string, line: number): ForgeDeckEntry {
  const match = CARD.exec(text);
  if (match === null)
    throw new Error(`Forge deck file line ${String(line)}: expected "<count> <name>": ${text}`);
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error(`Forge deck file line ${String(line)}: a card line counts at least one`);
  }
  const [rawName, setCode] = match[2]!.split('|');
  const name = rawName!.replace(/\+$/u, '').trim();
  if (name.length === 0) throw new Error(`Forge deck file line ${String(line)}: empty card name`);
  return {
    name,
    ...(setCode === undefined || setCode.trim().length === 0 ? {} : { setCode: setCode.trim() }),
    count,
  };
}

export function parseForgeDeckFile(body: string): ForgeDeckFile {
  const metadata: Record<string, string> = {};
  const cards: Record<Exclude<Section, 'metadata'>, ForgeDeckEntry[]> = {
    commander: [],
    main: [],
    sideboard: [],
  };
  let section: Section | undefined;
  body.split(/\r?\n/u).forEach((raw, index) => {
    const line = index + 1;
    let text = raw.trim();
    if (text.length === 0) return;
    // `[Sideboard][metadata]` is two headers on one line; the last one wins.
    for (let header = HEADER.exec(text); header !== null; header = HEADER.exec(text)) {
      section = sectionOf(header[1]!, line);
      text = text.slice(header[0].length).trim();
    }
    if (text.length === 0) return;
    if (section === undefined)
      throw new Error(`Forge deck file line ${String(line)}: content before any section`);
    if (section === 'metadata') {
      const separator = text.indexOf('=');
      if (separator <= 0)
        throw new Error(`Forge deck file line ${String(line)}: expected "key=value": ${text}`);
      metadata[text.slice(0, separator).trim().toLowerCase()] = text.slice(separator + 1).trim();
      return;
    }
    cards[section].push(entryOf(text, line));
  });
  const name = metadata['name'];
  if (name === undefined || name.length === 0) throw new Error('Forge deck file names no deck');
  return { name, metadata, commanders: cards.commander, main: cards.main, sideboard: cards.sideboard };
}
