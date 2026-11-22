import type { PrintedConstructedDeck, PrintedConstructedFormat } from '@mtg/printed-card';

type FormatSource = PrintedConstructedFormat['sources'][number];
type FormatSlot = PrintedConstructedDeck['cards'][number];

function sourceCodeOf(sources: readonly FormatSource[], physicalId: string): string {
  const catalogFormat = physicalId.split(':')[0];
  const source = sources.find((candidate) => candidate.catalogFormat === catalogFormat);
  if (source === undefined) {
    throw new Error(`no source in this format declares catalog "${catalogFormat ?? ''}" for ${physicalId}`);
  }
  return source.code;
}

function slotLine(slot: FormatSlot, sources: readonly FormatSource[]): string {
  return `${String(slot.count)} ${slot.name}|${sourceCodeOf(sources, slot.physicalId)}`;
}

export function forgeDeckName(deck: PrintedConstructedDeck): string {
  return deck.id;
}

export function forgeDeckFileName(deck: PrintedConstructedDeck): string {
  return `${deck.id}.dck`;
}

export function renderCommanderDeckFile(
  deck: PrintedConstructedDeck,
  sources: readonly FormatSource[],
): string {
  const lines: string[] = ['[metadata]', `Name=${forgeDeckName(deck)}`, '[Commander]'];
  for (const slot of deck.commanders) lines.push(slotLine(slot, sources));
  lines.push('[Main]');
  for (const slot of deck.cards) lines.push(slotLine(slot, sources));
  return `${lines.join('\n')}\n`;
}
